/**
 * db.js — per-project directory store for context-mcp
 *
 * Layout:
 *   ~/.context-mcp/
 *   ├── projects.json          ← master index
 *   └── projects/
 *       └── <slug>/
 *           ├── context.json   ← decision, bug, note, code, config, error
 *           ├── graph.json     ← { build: {...}, entries: [...architecture...] }
 *           ├── summary.json   ← summary type + archived entries
 *           └── discussions.json
 */

import {
  readFileSync, writeFileSync, mkdirSync, existsSync,
  openSync, closeSync, unlinkSync, renameSync, chmodSync, rmdirSync,
} from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { runMigration } from './migrator.js';

const DATA_DIR     = process.env.CONTEXT_MCP_DIR || join(homedir(), '.context-mcp');
const PROJECTS_DIR = join(DATA_DIR, 'projects');
const PROJECTS_PATH = join(DATA_DIR, 'projects.json');


const MAX_CONTENT_LENGTH = 5000;
const PREVIEW_LENGTH     = 200;
const WRITE_DEBOUNCE_MS  = 500;
const LOCK_WAIT_TIMEOUT_MS = 2000;

const _isWin = platform() === 'win32';

function normPath(p) {
  return p ? p.toLowerCase().replace(/\\/g, '/').replace(/\/$/, '') : '';
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
}

function projectDataDir(name)    { return join(PROJECTS_DIR, slugify(name)); }
function contextFilePath(name)   { return join(projectDataDir(name), 'context.json'); }
function graphFilePath(name)     { return join(projectDataDir(name), 'graph.json'); }
function summaryFilePath(name)   { return join(projectDataDir(name), 'summary.json'); }
function discussFilePath(name)   { return join(projectDataDir(name), 'discussions.json'); }

function treeFor(entry) {
  if (entry.type === 'compaction') return 'summary';
  return 'context';
}

function _secureFile(p) {
  if (_isWin) return;
  try { chmodSync(p, 0o600); } catch {}
}

if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
  if (!_isWin) { try { chmodSync(DATA_DIR, 0o700); } catch {} }
}
if (!existsSync(PROJECTS_DIR)) {
  mkdirSync(PROJECTS_DIR, { recursive: true });
}

// ── In-memory cache ──────────────────────────────────────────────────────────

let _projectsIndex = null;     // array of { id, name, rootPath, createdAt, dataDir }
let _projectsIndexDirty = false;
let _projectData = new Map();  // name -> { context: [], graph: { build, entries: [] }, summary: [], discussions: [] }
let _dirtyProjects = new Set();
let _dirty = false;
let _writeTimer = null;
let _generation = 0;
let _migrated = false;

// ── File I/O helpers ─────────────────────────────────────────────────────────

function _flushFile(filePath, content) {
  const lockPath = `${filePath}.lock`;
  const tmpPath  = `${filePath}.tmp`;
  let lockFd;
  let renamed = false;
  try {
    const started = Date.now();
    for (;;) {
      try { lockFd = openSync(lockPath, 'wx'); break; }
      catch (err) {
        if (err && err.code !== 'EEXIST') throw err;
        if (Date.now() - started > LOCK_WAIT_TIMEOUT_MS)
          throw new Error(`Timed out waiting for lock: ${lockPath}`);
        const t = Date.now(); while (Date.now() - t < 10) {}
      }
    }
    writeFileSync(tmpPath, JSON.stringify(content, null, 2), 'utf8');
    _secureFile(tmpPath);
    renameSync(tmpPath, filePath);
    renamed = true;
  } finally {
    if (lockFd !== undefined) { closeSync(lockFd); try { unlinkSync(lockPath); } catch {} }
    try { if (!renamed && existsSync(tmpPath)) unlinkSync(tmpPath); } catch {}
  }
}

function _readArr(filePath, key) {
  if (!existsSync(filePath)) return [];
  try {
    const d = JSON.parse(readFileSync(filePath, 'utf8'));
    return Array.isArray(d[key]) ? d[key] : (Array.isArray(d) ? d : []);
  } catch { return []; }
}

function _readObj(filePath, defaults) {
  if (!existsSync(filePath)) return { ...defaults };
  try { return { ...defaults, ...JSON.parse(readFileSync(filePath, 'utf8')) }; }
  catch { return { ...defaults }; }
}

// ── Projects index ───────────────────────────────────────────────────────────

function loadProjectsIndex() {
  if (_projectsIndex) return _projectsIndex;
  if (!existsSync(PROJECTS_PATH)) { _projectsIndex = []; return _projectsIndex; }
  try {
    const d = JSON.parse(readFileSync(PROJECTS_PATH, 'utf8'));
    _projectsIndex = Array.isArray(d.projects) ? d.projects : [];
  } catch { _projectsIndex = []; }
  return _projectsIndex;
}

// ── Migration ─────────────────────────────────────────────────────────────────

function migrate() {
  if (_migrated) return;
  _migrated = true;
  runMigration({
    dataDir:       DATA_DIR,
    projectsDir:   PROJECTS_DIR,
    projectsPath:  PROJECTS_PATH,
    slugify,
    flushFile:     _flushFile,
    projectsIndex: loadProjectsIndex(),
  });
}

// ── Per-project data loading ─────────────────────────────────────────────────

function loadProjectData(name) {
  if (_projectData.has(name)) return _projectData.get(name);
  const dir = projectDataDir(name);
  mkdirSync(dir, { recursive: true });
  const data = {
    context:     _readArr(contextFilePath(name), 'entries'),
    graph:       _readObj(graphFilePath(name), { build: null }),
    summary:     _readArr(summaryFilePath(name), 'entries'),
    discussions: _readArr(discussFilePath(name), 'discussions'),
  };
  _projectData.set(name, data);
  return data;
}

function getAllEntries(projectName) {
  const data = loadProjectData(projectName);
  return [...data.context, ...data.summary];
}

// Find an entry by ID, optionally scoped to a project.
function findEntryById(id, projectHint) {
  const search = (data) => {
    for (const arr of [data.context, data.summary]) {
      const e = arr.find(c => c.id === id);
      if (e) return e;
    }
    return null;
  };
  if (projectHint) {
    const e = search(loadProjectData(projectHint));
    if (e) return { entry: e, projectName: projectHint };
  }
  for (const [name, data] of _projectData.entries()) {
    if (name === projectHint) continue;
    const e = search(data);
    if (e) return { entry: e, projectName: name };
  }
  // Load all remaining projects
  const idx = loadProjectsIndex();
  for (const proj of idx) {
    if (_projectData.has(proj.name) || proj.name === projectHint) continue;
    const e = search(loadProjectData(proj.name));
    if (e) return { entry: e, projectName: proj.name };
  }
  return null;
}

// Remove an entry from its array in the project data.
function removeEntryFromData(data, entry) {
  if (treeFor(entry) === 'summary') {
    data.summary = data.summary.filter(e => e.id !== entry.id);
  } else {
    data.context = data.context.filter(e => e.id !== entry.id);
  }
}

// ── Dirty tracking & flush ───────────────────────────────────────────────────

function markDirty() {
  _dirty = true;
  _generation++;
  if (_writeTimer) clearTimeout(_writeTimer);
  _writeTimer = setTimeout(flushToDisk, WRITE_DEBOUNCE_MS);
}

function flushProjectToDisk(name) {
  const data = _projectData.get(name);
  if (!data) return;
  const dir = projectDataDir(name);
  mkdirSync(dir, { recursive: true });
  _flushFile(contextFilePath(name),   { entries: data.context });
  _flushFile(graphFilePath(name),     data.graph);
  _flushFile(summaryFilePath(name),   { entries: data.summary });
  _flushFile(discussFilePath(name),   { discussions: data.discussions });
}

function flushToDisk() {
  if (!_dirty) return;
  _writeTimer = null;

  for (const name of _dirtyProjects) {
    flushProjectToDisk(name);
  }
  _dirtyProjects.clear();

  if (_projectsIndexDirty && _projectsIndex) {
    _flushFile(PROJECTS_PATH, { projects: _projectsIndex });
    _projectsIndexDirty = false;
  }

  _dirty = false;
}

process.on('exit', flushToDisk);
process.on('SIGINT',  () => { flushToDisk(); process.exit(); });
process.on('SIGTERM', () => { flushToDisk(); process.exit(); });

// ── Initialise: run migration lazily on first access ─────────────────────────

function init() {
  loadProjectsIndex();
  migrate();
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function truncate(text, max) {
  if (!text || text.length <= max) return text;
  return text.slice(0, max - 3) + '...';
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) return tags;
  if (typeof tags === 'string') return tags.split(',').map(t => t.trim()).filter(Boolean);
  return [];
}

const VALID_SOURCES = new Set(['user', 'ai-summary', 'file', 'web', 'cli', 'auto']);
function normalizeSource(s) { return VALID_SOURCES.has(s) ? s : 'user'; }

function compactEntry(e) {
  const compact = {
    id:        e.id,
    project:   e.project,
    sessionId: e.sessionId,
    nodeType:  e.nodeType || 'entry',
    title:     e.title || '',
    type:      e.type || 'note',
    status:    e.status || 'active',
    version:   e.version || 1,
    tags:      e.tags,
    source:    e.source,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt || null,
    preview:   truncate(e.content, PREVIEW_LENGTH),
  };
  if (e.files    && e.files.length)    compact.files    = e.files;
  if (e.codeRefs && e.codeRefs.length) compact.codeRefs = e.codeRefs;
  if (e.expiresAt) compact.expiresAt = e.expiresAt;
  return compact;
}

// ── Context entries ──────────────────────────────────────────────────────────

export function saveContext({ project, content, tags = [], source = 'user', title = '',
  type = 'note', status = 'active', files = [], codeRefs = [],
  sessionId = null, parentId = null, expiresAt = null, rootPath = null }) {
  init();
  const projectName = project || 'global';
  ensureProject(projectName, rootPath || undefined);
  const data = loadProjectData(projectName);
  const now = new Date().toISOString();
  const entry = {
    id: randomUUID(),
    project: projectName,
    sessionId: sessionId || null,
    parentId: parentId || sessionId || `project:${projectName}`,
    nodeType: 'entry',
    version: 1,
    title: truncate(title, 60),
    content: truncate(content, MAX_CONTENT_LENGTH),
    type,
    status,
    tags: normalizeTags(tags),
    source: normalizeSource(source),
    files: Array.isArray(files) ? files : [],
    codeRefs: Array.isArray(codeRefs) ? codeRefs : [],
    discussionId: null,
    createdAt: now,
    updatedAt: null,
    expiresAt: expiresAt || null,
  };
  const tree = treeFor(entry);
  if (tree === 'graph') data.graph.entries.push(entry);
  else if (tree === 'summary') data.summary.push(entry);
  else data.context.push(entry);
  _dirtyProjects.add(projectName);
  markDirty();
  return entry;
}

export function updateContext({ id, content, title, tags, type, status, files, codeRefs, sessionId, parentId, expiresAt }) {
  init();
  const found = findEntryById(id);
  if (!found) return null;
  const { entry, projectName } = found;
  const data = loadProjectData(projectName);

  const oldTree = treeFor(entry);
  if (content   !== undefined) entry.content   = truncate(content, MAX_CONTENT_LENGTH);
  if (title     !== undefined) entry.title     = truncate(title, 60);
  if (tags      !== undefined) entry.tags      = normalizeTags(tags);
  if (type      !== undefined) entry.type      = type;
  if (status    !== undefined) entry.status    = status;
  if (files     !== undefined) entry.files     = Array.isArray(files) ? files : [];
  if (codeRefs  !== undefined) entry.codeRefs  = Array.isArray(codeRefs) ? codeRefs : [];
  if (expiresAt !== undefined) entry.expiresAt = expiresAt || null;
  if (sessionId !== undefined) entry.sessionId = sessionId || null;
  if (parentId  !== undefined) entry.parentId  = parentId || entry.sessionId || `project:${entry.project || 'global'}`;
  entry.version  = (entry.version || 1) + 1;
  entry.updatedAt = new Date().toISOString();

  // Re-route if type/status changed tree membership
  const newTree = treeFor(entry);
  if (newTree !== oldTree) {
    removeEntryFromData(data, entry);
    // Re-add with updated tree
    const tempEntry = { ...entry };
    if (newTree === 'graph') data.graph.entries.push(tempEntry);
    else if (newTree === 'summary') data.summary.push(tempEntry);
    else data.context.push(tempEntry);
  }

  _dirtyProjects.add(projectName);
  markDirty();
  return entry;
}

export function getContext({ project, tags, limit = 20, compact = false, ids } = {}) {
  init();

  if (ids && ids.length) {
    const idSet = new Set(ids);
    // Load all projects to find entries
    const idx = loadProjectsIndex();
    const all = [];
    const loaded = new Set(_projectData.keys());
    for (const proj of idx) loaded.add(proj.name);
    for (const name of loaded) {
      for (const e of getAllEntries(name)) {
        if (idSet.has(e.id)) all.push(e);
      }
    }
    return compact ? all.map(compactEntry) : all;
  }

  let results;
  if (project) {
    const entries = getAllEntries(project);
    const globalEntries = project !== 'global' ? getAllEntries('global') : [];
    results = [...entries, ...globalEntries];
  } else {
    // No project filter: load all
    const idx = loadProjectsIndex();
    const all = [];
    const seen = new Set(_projectData.keys());
    for (const proj of idx) seen.add(proj.name);
    for (const name of seen) {
      all.push(...getAllEntries(name));
    }
    results = all;
  }

  if (tags && tags.length) {
    const tagList = Array.isArray(tags) ? tags : tags.split(',').map(t => t.trim());
    results = results.filter(c => tagList.some(t => Array.isArray(c.tags) && c.tags.includes(t)));
  }

  // Sort by createdAt ascending, then take last `limit`
  results.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const sliced = results.slice(-limit).reverse();
  return compact ? sliced.map(compactEntry) : sliced;
}

export function getContextSince(since, project) {
  init();
  let results;
  if (project) {
    results = [...getAllEntries(project)];
    if (project !== 'global') results.push(...getAllEntries('global'));
  } else {
    const idx = loadProjectsIndex();
    results = [];
    const seen = new Set([..._projectData.keys(), ...idx.map(p => p.name)]);
    for (const name of seen) results.push(...getAllEntries(name));
  }
  return results.filter(c => c.createdAt >= since);
}

export function searchContext({ query, project, limit = 10, compact = false }) {
  init();
  const terms = query.toLowerCase().split(/\s+/);
  let results;
  if (project) {
    results = [...getAllEntries(project)];
    if (project !== 'global') results.push(...getAllEntries('global'));
  } else {
    const idx = loadProjectsIndex();
    results = [];
    const seen = new Set([..._projectData.keys(), ...idx.map(p => p.name)]);
    for (const name of seen) results.push(...getAllEntries(name));
  }
  const scored = results.map(c => {
    const haystack = `${c.title || ''} ${c.content || ''} ${(Array.isArray(c.tags) ? c.tags : []).join(' ')}`.toLowerCase();
    const score = terms.reduce((s, t) => s + (haystack.split(t).length - 1), 0);
    return { ...c, score };
  }).filter(c => c.score > 0).sort((a, b) => b.score - a.score);
  const sliced = scored.slice(0, limit).map(({ score, ...c }) => c);
  return compact ? sliced.map(compactEntry) : sliced;
}

export function deleteContext({ id, ids }) {
  init();
  const idSet = new Set(ids && ids.length ? ids : (id ? [id] : []));
  if (!idSet.size) return { deleted: 0 };
  let deleted = 0;
  // Scan all loaded projects
  const seen = new Set(_projectData.keys());
  loadProjectsIndex().forEach(p => seen.add(p.name));
  for (const name of seen) {
    const data = loadProjectData(name);
    const allEntries = getAllEntries(name);
    const toRemove = allEntries.filter(e => idSet.has(e.id));
    if (!toRemove.length) continue;
    for (const entry of toRemove) removeEntryFromData(data, entry);
    _dirtyProjects.add(name);
    deleted += toRemove.length;
    if (deleted >= idSet.size) break;
  }
  if (deleted > 0) markDirty();
  return { deleted };
}

export function deleteProject(nameOrId) {
  init();
  const idx = loadProjectsIndex();
  const byId = idx.find(p => p.id === nameOrId);
  const projectName = byId ? byId.name : nameOrId;

  // Count before removing
  const data = _projectData.get(projectName) || loadProjectData(projectName);
  const ctxCount  = data.context.length + data.graph.entries.length + data.summary.length;
  const discCount = data.discussions.length;

  // Remove project directory from disk
  const dir = projectDataDir(projectName);
  if (existsSync(dir)) {
    for (const file of ['context.json', 'graph.json', 'summary.json', 'discussions.json']) {
      try { unlinkSync(join(dir, file)); } catch {}
    }
    try { rmdirSync(dir); } catch {}
  }

  // Drop from cache
  _projectData.delete(projectName);
  _dirtyProjects.delete(projectName);

  // Remove from index
  const beforeProj = idx.length;
  _projectsIndex = idx.filter(p => p.name !== projectName);
  if (_projectsIndex.length !== beforeProj) {
    _projectsIndexDirty = true;
    markDirty();
  }

  return { deletedEntries: ctxCount, deletedDiscussions: discCount };
}

export function countContext(project) {
  init();
  if (!project) {
    const idx = loadProjectsIndex();
    let total = 0;
    const seen = new Set([..._projectData.keys(), ...idx.map(p => p.name)]);
    for (const name of seen) total += getAllEntries(name).length;
    return total;
  }
  return getAllEntries(project).length;
}

export function ensureProject(name, rootPath) {
  if (!name || name === 'global') return null;
  const idx = loadProjectsIndex();
  let proj = idx.find(p => p.name === name);
  if (!proj) {
    proj = {
      id: randomUUID(),
      name,
      createdAt: new Date().toISOString(),
      dataDir: `projects/${slugify(name)}`,
    };
    idx.push(proj);
    _projectsIndexDirty = true;
    markDirty();
  }
  if (rootPath && !proj.rootPath) {
    proj.rootPath = rootPath;
    if (!proj.dataDir) proj.dataDir = `projects/${slugify(name)}`;
    _projectsIndexDirty = true;
    markDirty();
  }
  return proj;
}

export function getProjectRoot(name) {
  if (!name || name === 'global') return null;
  init();
  return loadProjectsIndex().find(p => p.name === name)?.rootPath || null;
}

export function listProjects() {
  init();
  const idx = loadProjectsIndex();
  // Load all known project dirs to get entry counts
  const seen = new Set([..._projectData.keys(), ...idx.map(p => p.name)]);
  return [...seen]
    .map(name => {
      const count = getAllEntries(name).length;
      const reg = idx.find(p => p.name === name);
      if (!reg && count === 0) return null;
      return {
        id:        reg?.id        || null,
        name,
        count,
        createdAt: reg?.createdAt || null,
        rootPath:  reg?.rootPath  || null,
      };
    })
    .filter(p => p && p.count > 0);
}

// ── Auto-dedup ───────────────────────────────────────────────────────────────

export function findDuplicate(content, project) {
  init();
  const existing = getContext({ project, limit: 50 });
  if (!existing.length) return null;
  const newWords = new Set(content.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  if (!newWords.size) return null;
  for (const entry of existing) {
    const oldWords = new Set((entry.content || '').toLowerCase().split(/\s+/).filter(w => w.length > 3));
    if (!oldWords.size) continue;
    const overlap = [...newWords].filter(w => oldWords.has(w)).length;
    const similarity = overlap / Math.max(newWords.size, oldWords.size);
    if (similarity > 0.85) return entry;
  }
  return null;
}

// ── Discussions ───────────────────────────────────────────────────────────────

const VALID_DISCUSSION_TYPES    = new Set(['plan','research','idea','design','implementation','review','thread']);
const VALID_DISCUSSION_STATUSES = new Set(['active','done']);

export function saveDiscussion({ name, title, description, content, project, tags,
  type, status, steps, linkedContextIds, parentId, sessionId }) {
  init();
  const proj = project || 'global';
  const data = loadProjectData(proj);
  const existing = data.discussions.findIndex(d => d.name === name);
  const now = new Date().toISOString();
  const prev = existing >= 0 ? data.discussions[existing] : null;
  const disc = {
    id:               prev?.id || randomUUID(),
    name,
    project:          project          !== undefined ? (project || 'global')                              : (prev?.project          ?? 'global'),
    sessionId:        sessionId        !== undefined ? (sessionId || null)                                : (prev?.sessionId        ?? null),
    parentId:         parentId         !== undefined ? (parentId || null)                                 : (prev?.parentId         ?? null),
    title:            title            !== undefined ? truncate(title || name, 80)                        : (prev?.title            ?? name),
    description:      description      !== undefined ? (description || '')                                : (prev?.description      ?? ''),
    content:          content          !== undefined ? truncate(content || '', MAX_CONTENT_LENGTH)         : (prev?.content          ?? ''),
    type:             type             !== undefined ? (VALID_DISCUSSION_TYPES.has(type) ? type : 'plan')  : (prev?.type             ?? 'plan'),
    status:           status           !== undefined ? (VALID_DISCUSSION_STATUSES.has(status) ? status : 'active') : (prev?.status  ?? 'active'),
    tags:             tags             !== undefined ? normalizeTags(tags)                                : (prev?.tags             ?? []),
    steps:            steps            !== undefined ? mergeSteps(prev?.steps ?? [], steps)               : (prev?.steps            ?? []),
    linkedContextIds: linkedContextIds !== undefined ? (Array.isArray(linkedContextIds) ? linkedContextIds : []) : (prev?.linkedContextIds ?? []),
    createdAt:        prev?.createdAt || now,
    updatedAt:        now,
  };
  if (existing >= 0) data.discussions[existing] = disc;
  else data.discussions.push(disc);
  _dirtyProjects.add(proj);
  markDirty();
  return disc;
}

function mergeSteps(prevSteps, incomingSteps) {
  if (!Array.isArray(incomingSteps) || incomingSteps.length === 0) return prevSteps;
  return incomingSteps.map((s, i) => {
    const prev = prevSteps.find(p => p.id && p.id === s.id) || prevSteps[i];
    return {
      id:               s.id              || prev?.id              || randomUUID(),
      title:            s.title           ?? prev?.title           ?? '',
      description:      s.description     ?? prev?.description     ?? '',
      status:           s.status          ?? prev?.status          ?? 'pending',
      order:            s.order           ?? prev?.order           ?? i,
      linkedContextIds: s.linkedContextIds ?? prev?.linkedContextIds ?? [],
      completedAt:      s.completedAt     ?? prev?.completedAt     ?? null,
    };
  });
}

export function updateDiscussion({ id, name, title, description, content, status, type, tags, steps, linkedContextIds, parentId, sessionId }) {
  init();
  let disc = null;
  let projName = null;
  const idx = loadProjectsIndex();
  const seen = new Set([..._projectData.keys(), ...idx.map(p => p.name)]);
  for (const pName of seen) {
    const d = loadProjectData(pName);
    const found = id ? d.discussions.find(x => x.id === id) : d.discussions.find(x => x.name === name);
    if (found) { disc = found; projName = pName; break; }
  }
  if (!disc) return null;
  if (title       !== undefined) disc.title       = truncate(title || disc.name, 80);
  if (description !== undefined) disc.description = description || '';
  if (content     !== undefined) disc.content     = truncate(content || '', MAX_CONTENT_LENGTH);
  if (type        !== undefined) disc.type        = VALID_DISCUSSION_TYPES.has(type)      ? type   : disc.type;
  if (status      !== undefined) disc.status      = VALID_DISCUSSION_STATUSES.has(status) ? status : disc.status;
  if (tags        !== undefined) disc.tags        = normalizeTags(tags);
  if (steps       !== undefined) disc.steps       = mergeSteps(disc.steps ?? [], steps);
  if (linkedContextIds !== undefined) disc.linkedContextIds = Array.isArray(linkedContextIds) ? linkedContextIds : disc.linkedContextIds;
  if (parentId    !== undefined) disc.parentId    = parentId || null;
  if (sessionId   !== undefined) disc.sessionId   = sessionId || null;
  disc.updatedAt = new Date().toISOString();
  _dirtyProjects.add(projName);
  markDirty();
  return disc;
}

export function getDiscussion({ project, name, id } = {}) {
  init();
  if (project) {
    const data = loadProjectData(project);
    let list = data.discussions;
    if (id)   return list.find(d => d.id   === id)   || null;
    if (name) return list.find(d => d.name === name) || null;
    return null;
  }
  // Search all
  const idx = loadProjectsIndex();
  const seen = new Set([..._projectData.keys(), ...idx.map(p => p.name)]);
  for (const pName of seen) {
    const d = loadProjectData(pName);
    const found = id ? d.discussions.find(x => x.id === id) : d.discussions.find(x => x.name === name);
    if (found) return found;
  }
  return null;
}

export function listDiscussions({ project, status, type } = {}) {
  init();
  let list = [];
  if (project) {
    list = loadProjectData(project).discussions;
    if (project !== 'global') list = [...list, ...loadProjectData('global').discussions];
  } else {
    const idx = loadProjectsIndex();
    const seen = new Set([..._projectData.keys(), ...idx.map(p => p.name)]);
    for (const pName of seen) list.push(...loadProjectData(pName).discussions);
  }
  if (status) list = list.filter(d => d.status === status);
  if (type)   list = list.filter(d => d.type   === type);
  return list.map(({ content: _, steps, ...rest }) => ({
    ...rest,
    stepsSummary: {
      total:      (steps || []).length,
      done:       (steps || []).filter(s => s.status === 'done').length,
      inProgress: (steps || []).filter(s => s.status === 'in-progress').length,
    },
  }));
}

export function linkContextToDiscussion({ discussionId, discussionName, contextId }) {
  init();
  // Find discussion across projects
  let disc = null;
  let discProject = null;
  const idx = loadProjectsIndex();
  const seen = new Set([..._projectData.keys(), ...idx.map(p => p.name)]);
  for (const pName of seen) {
    const d = loadProjectData(pName);
    const found = discussionId
      ? d.discussions.find(x => x.id   === discussionId)
      : d.discussions.find(x => x.name === discussionName);
    if (found) { disc = found; discProject = pName; break; }
  }
  if (!disc) return null;

  if (!Array.isArray(disc.linkedContextIds)) disc.linkedContextIds = [];
  let changed = false;
  if (!disc.linkedContextIds.includes(contextId)) {
    disc.linkedContextIds.push(contextId);
    disc.updatedAt = new Date().toISOString();
    _dirtyProjects.add(discProject);
    changed = true;
  }

  // Write discussionId back onto the context entry
  const found = findEntryById(contextId);
  if (found && found.entry.discussionId !== disc.id) {
    found.entry.discussionId = disc.id;
    found.entry.updatedAt = new Date().toISOString();
    _dirtyProjects.add(found.projectName);
    changed = true;
  }
  if (changed) markDirty();
  return { discussionId: disc.id, contextId };
}

export function getContextByDiscussion(discussionId) {
  init();
  const idx = loadProjectsIndex();
  const seen = new Set([..._projectData.keys(), ...idx.map(p => p.name)]);
  const results = [];
  for (const name of seen) {
    results.push(...getAllEntries(name).filter(c => c.discussionId === discussionId));
  }
  return results;
}

export function clearDiscussionLink(contextId) {
  init();
  const found = findEntryById(contextId);
  if (!found) return null;
  found.entry.discussionId = null;
  found.entry.updatedAt = new Date().toISOString();
  _dirtyProjects.add(found.projectName);
  markDirty();
  return found.entry;
}

export function deleteDiscussion({ name, id }) {
  init();
  const idx = loadProjectsIndex();
  const seen = new Set([..._projectData.keys(), ...idx.map(p => p.name)]);
  for (const pName of seen) {
    const data = loadProjectData(pName);
    const before = data.discussions.length;
    data.discussions = data.discussions.filter(d => {
      if (id)   return d.id   !== id;
      if (name) return d.name !== name;
      return true;
    });
    if (data.discussions.length < before) {
      _dirtyProjects.add(pName);
      markDirty();
      return { deleted: before - data.discussions.length };
    }
  }
  return { deleted: 0 };
}

export function updateDiscussionStep({ discussionName, discussionId, stepId, status, linkedContextId }) {
  init();
  let disc = null;
  let projName = null;
  const idx = loadProjectsIndex();
  const seen = new Set([..._projectData.keys(), ...idx.map(p => p.name)]);
  for (const pName of seen) {
    const d = loadProjectData(pName);
    const found = discussionId
      ? d.discussions.find(x => x.id   === discussionId)
      : d.discussions.find(x => x.name === discussionName);
    if (found) { disc = found; projName = pName; break; }
  }
  if (!disc) return null;
  const step = (disc.steps || []).find(s => s.id === stepId);
  if (!step) return null;
  if (status) step.status = status;
  if (status === 'done') step.completedAt = new Date().toISOString();
  if (linkedContextId) {
    if (!Array.isArray(step.linkedContextIds)) step.linkedContextIds = [];
    if (!step.linkedContextIds.includes(linkedContextId)) step.linkedContextIds.push(linkedContextId);
    if (!Array.isArray(disc.linkedContextIds)) disc.linkedContextIds = [];
    if (!disc.linkedContextIds.includes(linkedContextId)) disc.linkedContextIds.push(linkedContextId);
  }
  const allDone = disc.steps.every(s => s.status === 'done' || s.status === 'skipped');
  if (allDone && disc.status !== 'done') disc.status = 'done';
  disc.updatedAt = new Date().toISOString();
  _dirtyProjects.add(projName);
  markDirty();
  return { discussion: disc, step };
}

// ── Auto-operations ───────────────────────────────────────────────────────────

export function archiveExpired(project) {
  init();
  const now = new Date().toISOString();
  let count = 0;
  const processEntries = (entries, projName) => {
    for (const entry of entries) {
      if (entry.expiresAt && entry.expiresAt < now && entry.status !== 'archived') {
        entry.status    = 'archived';
        entry.updatedAt = now;
        _dirtyProjects.add(projName);
        count++;
      }
    }
  };

  if (project) {
    processEntries(getAllEntries(project), project);
  } else {
    const idx = loadProjectsIndex();
    const seen = new Set([..._projectData.keys(), ...idx.map(p => p.name)]);
    for (const name of seen) processEntries(getAllEntries(name).slice(), name);
  }
  if (count > 0) markDirty();
  return { archived: count };
}

// ── Exports ──────────────────────────────────────────────────────────────────

export function getStorePath() { return DATA_DIR; }
export function getGeneration() { return _generation; }
export function flushStore() { flushToDisk(); }

// ── Auto-compaction ───────────────────────────────────────────────────────────

const COMPACTION_THRESHOLD = 20;
const COMPACTION_TARGET    = 30;

export function shouldCompact(project) {
  return countContext(project) > COMPACTION_THRESHOLD;
}

export function compactProject(project, summaryContent) {
  init();
  const proj = project || 'global';
  const data = loadProjectData(proj);
  const entries = data.context
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  if (entries.length < COMPACTION_TARGET) return null;
  const toRemove = new Set(entries.slice(0, COMPACTION_TARGET).map(e => e.id));
  const removed = entries.filter(e => toRemove.has(e.id));
  for (const entry of removed) removeEntryFromData(data, entry);
  _dirtyProjects.add(proj);
  markDirty();
  const summary = saveContext({
    project: proj,
    title: `Compacted ${removed.length} entries — ${new Date().toISOString().slice(0, 10)}`,
    content: summaryContent,
    type: 'compaction',
    source: 'auto',
    tags: ['compaction', 'auto'],
  });
  return { removedCount: removed.length, summaryId: summary.id };
}

// ── Graph registry ────────────────────────────────────────────────────────────

export function saveGraph({ path, nodes, edges, communities, cached, changed, time_ms, summary }) {
  init();
  // Find project by rootPath matching graph path
  const idx = loadProjectsIndex();
  const proj = idx.find(p => normPath(p.rootPath) === normPath(path));
  const projName = proj ? proj.name : 'global';

  const data = loadProjectData(projName);
  const existing = data.graph.build;
  const record = {
    path,
    nodes:       nodes       ?? existing?.nodes       ?? 0,
    edges:       edges       ?? existing?.edges       ?? 0,
    communities: communities ?? existing?.communities ?? 0,
    cached:      cached      ?? 0,
    changed:     changed     ?? 0,
    time_ms:     time_ms     ?? 0,
    summary:     summary     || existing?.summary     || '',
    builtAt:     new Date().toISOString(),
  };
  data.graph.build = record;
  _dirtyProjects.add(projName);
  markDirty();
  return record;
}

export function getGraph(path) {
  init();
  if (!path) return listGraphs();
  const idx = loadProjectsIndex();
  for (const proj of idx) {
    if (normPath(proj.rootPath) === normPath(path)) {
      return loadProjectData(proj.name).graph.build || null;
    }
  }
  // fallback: scan all loaded data
  for (const [, data] of _projectData.entries()) {
    if (data.graph.build && normPath(data.graph.build.path) === normPath(path))
      return data.graph.build;
  }
  return null;
}

export function listGraphs() {
  init();
  const idx = loadProjectsIndex();
  const results = [];
  const seen = new Set([..._projectData.keys(), ...idx.map(p => p.name)]);
  for (const name of seen) {
    const build = loadProjectData(name).graph.build;
    if (build) results.push(build);
  }
  return results;
}
