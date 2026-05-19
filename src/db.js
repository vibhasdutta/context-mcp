/**
 * db.js — optimized JSON store for context-mcp
 *
 * Performance optimizations:
 *   1. In-memory cache — disk is read once, all ops hit RAM
 *   2. Debounced writes — batches rapid saves into one disk write
 *   3. Compact mode — returns previews instead of full content (saves tokens)
 *   4. Content size cap — prevents bloated entries
 *   5. Flush-on-exit — guarantees data is written before process dies
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, openSync, closeSync, unlinkSync, renameSync, chmodSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const DATA_DIR          = process.env.CONTEXT_MCP_DIR || join(homedir(), '.context-mcp');
const CONTEXTS_PATH     = join(DATA_DIR, 'contexts.json');
const DISCUSSIONS_PATH  = join(DATA_DIR, 'discussions.json');
const GRAPHS_PATH       = join(DATA_DIR, 'graphs.json');
const PROJECTS_PATH     = join(DATA_DIR, 'projects.json');


const MAX_CONTENT_LENGTH = 5000;
const PREVIEW_LENGTH = 200;

// Normalize file paths for cross-platform comparison (Windows case + slash variants)
function normPath(p) {
  return p ? p.toLowerCase().replace(/\\/g, '/').replace(/\/$/, '') : '';
}
const WRITE_DEBOUNCE_MS = 500;
const LOCK_WAIT_TIMEOUT_MS = 2000;

const _isWin = platform() === 'win32';

function _secureFile(p) {
  if (_isWin) return;
  try { chmodSync(p, 0o600); } catch {}
}

if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
  if (!_isWin) { try { chmodSync(DATA_DIR, 0o700); } catch {} }
}

// ── In-memory cache ──────────────────────────────────────────────────────────

let _cache = null;
let _dirty = false;
let _writeTimer = null;
let _generation = 0;
const _changedContextIds      = new Set();
const _deletedContextIds      = new Set();
const _changedDiscussionNames = new Set();
const _changedGraphPaths      = new Set();
const _changedProjectIds      = new Set();


function _readCollection(path, key) {
  if (!existsSync(path)) return [];
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    return Array.isArray(data[key]) ? data[key] : (Array.isArray(data) ? data : []);
  } catch { return []; }
}

function load() {
  if (_cache) return _cache;
  _cache = {
    contexts:    _readCollection(CONTEXTS_PATH,    'contexts'),
    discussions: _readCollection(DISCUSSIONS_PATH, 'discussions'),
    graphs:      _readCollection(GRAPHS_PATH,      'graphs'),
    projects:    _readCollection(PROJECTS_PATH,    'projects'),
  };
  return _cache;
}

function readStoreFromDisk() {
  return {
    contexts:    _readCollection(CONTEXTS_PATH,    'contexts'),
    discussions: _readCollection(DISCUSSIONS_PATH, 'discussions'),
    graphs:      _readCollection(GRAPHS_PATH,      'graphs'),
    projects:    _readCollection(PROJECTS_PATH,    'projects'),
  };
}

function refreshFromDisk() {
  const latest = readStoreFromDisk();
  _cache = mergeStore(latest, _cache || { contexts: [], discussions: [], graphs: [], projects: [] });
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) return tags;
  if (typeof tags === 'string') return tags.split(',').map(t => t.trim()).filter(Boolean);
  return [];
}

const VALID_SOURCES = new Set(['user', 'ai-summary', 'file', 'web', 'cli', 'auto']);
function normalizeSource(s) {
  return VALID_SOURCES.has(s) ? s : 'user';
}

const VALID_PRIORITIES = new Set(['low', 'normal', 'high', 'critical']);
function normalizePriority(p) {
  return VALID_PRIORITIES.has(p) ? p : 'normal';
}

// backward-compat: old data has relations as string[], new is {id, relType}[]
function normalizeRelations(relations) {
  if (!Array.isArray(relations)) return [];
  return relations.map(r => {
    if (typeof r === 'string') return { id: r, relType: 'relates-to' };
    if (r && typeof r.id === 'string') return { id: r.id, relType: r.relType || 'relates-to' };
    return null;
  }).filter(Boolean);
}


function mergeStore(latest, local) {
  const contextsById = new Map(
    latest.contexts
      .filter(c => !_deletedContextIds.has(c.id))
      .map(c => [c.id, c])
  );
  for (const context of local.contexts) {
    if (_changedContextIds.has(context.id)) contextsById.set(context.id, context);
  }

  const discussionsByName = new Map(latest.discussions.map(d => [d.name, d]));
  for (const disc of local.discussions) {
    if (_changedDiscussionNames.has(disc.name)) discussionsByName.set(disc.name, disc);
  }

  const graphsByPath = new Map((latest.graphs || []).map(g => [normPath(g.path), g]));
  for (const graph of (local.graphs || [])) {
    if (_changedGraphPaths.has(graph.path)) graphsByPath.set(normPath(graph.path), graph);
  }

  const projectsById = new Map((latest.projects || []).map(p => [p.id, p]));
  for (const proj of (local.projects || [])) {
    if (_changedProjectIds.has(proj.id)) projectsById.set(proj.id, proj);
  }

  return {
    contexts:    [...contextsById.values()],
    discussions: [...discussionsByName.values()],
    graphs:      [...graphsByPath.values()],
    projects:    [...projectsById.values()],
  };
}

function markDirty() {
  _dirty = true;
  _generation++;
  // Debounce: schedule a write after WRITE_DEBOUNCE_MS of no further mutations
  if (_writeTimer) clearTimeout(_writeTimer);
  _writeTimer = setTimeout(flushToDisk, WRITE_DEBOUNCE_MS);
}

function _flushCollection(filePath, key, data) {
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
    writeFileSync(tmpPath, JSON.stringify({ [key]: data }, null, 2), 'utf8');
    _secureFile(tmpPath);
    renameSync(tmpPath, filePath);
    renamed = true;
  } finally {
    if (lockFd !== undefined) { closeSync(lockFd); try { unlinkSync(lockPath); } catch {} }
    try { if (!renamed && existsSync(tmpPath)) unlinkSync(tmpPath); } catch {}
  }
}

function flushToDisk() {
  if (!_dirty || !_cache) return;
  _writeTimer = null;

  const latest = readStoreFromDisk();
  _cache = mergeStore(latest, _cache);

  if (_changedContextIds.size > 0 || _deletedContextIds.size > 0) {
    _flushCollection(CONTEXTS_PATH, 'contexts', _cache.contexts);
    _changedContextIds.clear();
    _deletedContextIds.clear();
  }
  if (_changedDiscussionNames.size > 0) {
    _flushCollection(DISCUSSIONS_PATH, 'discussions', _cache.discussions);
    _changedDiscussionNames.clear();
  }
  if (_changedGraphPaths.size > 0) {
    _flushCollection(GRAPHS_PATH, 'graphs', _cache.graphs);
    _changedGraphPaths.clear();
  }
  if (_changedProjectIds.size > 0) {
    _flushCollection(PROJECTS_PATH, 'projects', _cache.projects);
    _changedProjectIds.clear();
  }

  _dirty = false;
}

// Flush on process exit to guarantee no data loss
process.on('exit', flushToDisk);
process.on('SIGINT', () => { flushToDisk(); process.exit(); });
process.on('SIGTERM', () => { flushToDisk(); process.exit(); });

// ── Helpers ──────────────────────────────────────────────────────────────────

function truncate(text, max) {
  if (!text || text.length <= max) return text;
  return text.slice(0, max - 3) + '...';
}

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
  relations = [], sessionId = null, parentId = null, expiresAt = null }) {
  refreshFromDisk();
  const store = load();
  const projectName = project || 'global';
  ensureProject(projectName);
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
    relations: normalizeRelations(relations),
    relatedBy: [],      // back-references written by addRelation()
    discussionId: null, // set by linkContextToDiscussion()
    createdAt: now,
    updatedAt: null,
    expiresAt: expiresAt || null,
  };
  store.contexts.push(entry);
  _changedContextIds.add(entry.id);
  markDirty();
  return entry;
}

export function updateContext({ id, content, title, tags, type, status, files, codeRefs, relations, sessionId, parentId, expiresAt }) {
  refreshFromDisk();
  const store = load();
  const entry = store.contexts.find(c => c.id === id);
  if (!entry) return null;
  if (content !== undefined) entry.content = truncate(content, MAX_CONTENT_LENGTH);
  if (title !== undefined) entry.title = truncate(title, 60);
  if (tags !== undefined) entry.tags = normalizeTags(tags);
  if (type !== undefined) entry.type = type;
  if (status !== undefined) entry.status = status;
  if (files !== undefined) entry.files = Array.isArray(files) ? files : [];
  if (codeRefs !== undefined) entry.codeRefs = Array.isArray(codeRefs) ? codeRefs : [];
  if (relations !== undefined) entry.relations = normalizeRelations(relations);
  if (expiresAt !== undefined) entry.expiresAt = expiresAt || null;
  if (sessionId !== undefined) entry.sessionId = sessionId || null;
  if (parentId !== undefined) entry.parentId = parentId || entry.sessionId || `project:${entry.project || 'global'}`;
  entry.version = (entry.version || 1) + 1;
  entry.updatedAt = new Date().toISOString();
  _changedContextIds.add(entry.id);
  _deletedContextIds.delete(entry.id);
  markDirty();
  return entry;
}

/**
 * Get recent context entries.
 * @param {Object} opts
 * @param {boolean} opts.compact - If true, returns previews instead of full content (saves tokens)
 */
export function getContext({ project, tags, limit = 20, compact = false } = {}) {
  refreshFromDisk();
  const store = load();
  let results = store.contexts;
  if (project) results = results.filter(c => c.project === project || c.project === 'global');
  if (tags && tags.length) {
    const tagList = Array.isArray(tags) ? tags : tags.split(',').map(t => t.trim());
    results = results.filter(c => tagList.some(t => Array.isArray(c.tags) && c.tags.includes(t)));
  }
  const sliced = results.slice(-limit).reverse();
  return compact ? sliced.map(compactEntry) : sliced;
}

export function getContextSince(since, project) {
  refreshFromDisk();
  const store = load();
  let results = store.contexts;
  if (project) results = results.filter(c => c.project === project || c.project === 'global');
  return results.filter(c => c.createdAt >= since);
}

export function searchContext({ query, project, limit = 10, compact = false }) {
  refreshFromDisk();
  const store = load();
  const terms = query.toLowerCase().split(/\s+/);
  let results = store.contexts;
  if (project) results = results.filter(c => c.project === project || c.project === 'global');
  const scored = results.map(c => {
    const haystack = `${c.title || ''} ${c.content || ''} ${(Array.isArray(c.tags) ? c.tags : []).join(' ')}`.toLowerCase();
    const score = terms.reduce((s, t) => s + (haystack.split(t).length - 1), 0);
    return { ...c, score };
  }).filter(c => c.score > 0).sort((a, b) => b.score - a.score);
  const sliced = scored.slice(0, limit).map(({ score, ...c }) => c);
  return compact ? sliced.map(compactEntry) : sliced;
}

export function deleteContext({ id }) {
  refreshFromDisk();
  const store = load();
  const before = store.contexts.length;
  const removed = store.contexts.filter(c => c.id === id);
  store.contexts = store.contexts.filter(c => c.id !== id);
  if (store.contexts.length < before) {
    for (const entry of removed) {
      _deletedContextIds.add(entry.id);
      _changedContextIds.delete(entry.id);
    }
    markDirty();
  }
  return { deleted: before - store.contexts.length };
}

export function deleteProject(nameOrId) {
  refreshFromDisk();
  const store = load();
  // Resolve name from ID if needed
  const byId = store.projects.find(p => p.id === nameOrId);
  const projectName = byId ? byId.name : nameOrId;

  const beforeCtx  = store.contexts.length;
  const beforeDisc = store.discussions.length;
  const removed = store.contexts.filter(c => c.project === projectName);
  store.contexts     = store.contexts.filter(c => c.project !== projectName);
  store.discussions  = store.discussions.filter(d => d.project !== projectName);
  // Remove from project registry
  const beforeProj = store.projects.length;
  store.projects = store.projects.filter(p => p.name !== projectName);
  for (const entry of removed) {
    _deletedContextIds.add(entry.id);
    _changedContextIds.delete(entry.id);
  }
  if (store.contexts.length < beforeCtx || store.discussions.length < beforeDisc || store.projects.length < beforeProj) {
    if (store.projects.length < beforeProj && byId) _changedProjectIds.add(byId.id);
    markDirty();
  }
  return {
    deletedEntries:      beforeCtx  - store.contexts.length,
    deletedDiscussions:  beforeDisc - store.discussions.length,
  };
}

export function countContext(project) {
  refreshFromDisk();
  const store = load();
  if (!project) return store.contexts.length;
  return store.contexts.filter(c => c.project === project || c.project === 'global').length;
}

// Ensure a project entity exists for this name; returns the project record.
// If rootPath is provided and the project has no rootPath yet, it is stored.
export function ensureProject(name, rootPath) {
  if (!name || name === 'global') return null;
  const store = load();
  let proj = store.projects.find(p => p.name === name);
  if (!proj) {
    proj = { id: randomUUID(), name, createdAt: new Date().toISOString() };
    store.projects.push(proj);
    _changedProjectIds.add(proj.id);
    markDirty();
  }
  if (rootPath && !proj.rootPath) {
    proj.rootPath = rootPath;
    _changedProjectIds.add(proj.id);
    markDirty();
  }
  return proj;
}

// Returns the stored rootPath for a project, or null if not set.
export function getProjectRoot(name) {
  if (!name || name === 'global') return null;
  const store = load();
  return store.projects.find(p => p.name === name)?.rootPath || null;
}

export function listProjects() {
  refreshFromDisk();
  const store = load();
  // Count entries per project name
  const counts = {};
  for (const c of store.contexts) {
    counts[c.project] = (counts[c.project] || 0) + 1;
  }
  // Merge with project registry (provides stable IDs); backfill any missing
  const registered = new Map(store.projects.map(p => [p.name, p]));
  for (const name of Object.keys(counts)) {
    if (!registered.has(name)) ensureProject(name); // auto-register legacy projects
  }
  // Re-read after potential backfill
  const reg = new Map(store.projects.map(p => [p.name, p]));
  return Object.entries(counts).map(([name, count]) => ({
    id:        reg.get(name)?.id || null,
    name,
    count,
    createdAt: reg.get(name)?.createdAt || null,
  })); // only show projects that have entries
}

// ── Auto-dedup ───────────────────────────────────────────────────────────────

export function findDuplicate(content, project) {
  refreshFromDisk();
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

const VALID_DISCUSSION_TYPES   = new Set(['plan','research','idea','design','implementation','review','thread']);
const VALID_DISCUSSION_STATUSES = new Set(['active','done']);

export function saveDiscussion({ name, title, description, content, project, tags,
  type, status, steps,
  linkedContextIds, parentId, sessionId }) {
  refreshFromDisk();
  const store = load();
  const existing = store.discussions.findIndex(d => d.name === name);
  const now = new Date().toISOString();
  const prev = existing >= 0 ? store.discussions[existing] : null;

  // When updating an existing discussion, only overwrite fields that were
  // explicitly provided by the caller — preserve everything else from prev.
  const disc = {
    id:               prev?.id || randomUUID(),
    name,
    project:          project          !== undefined ? (project || 'global')                            : (prev?.project          ?? 'global'),
    sessionId:        sessionId        !== undefined ? (sessionId || null)                              : (prev?.sessionId        ?? null),
    parentId:         parentId         !== undefined ? (parentId || null)                               : (prev?.parentId         ?? null),
    title:            title            !== undefined ? truncate(title || name, 80)                      : (prev?.title            ?? name),
    description:      description      !== undefined ? (description || '')                              : (prev?.description      ?? ''),
    content:          content          !== undefined ? truncate(content || '', MAX_CONTENT_LENGTH)       : (prev?.content          ?? ''),
    type:             type             !== undefined ? (VALID_DISCUSSION_TYPES.has(type) ? type : 'plan'): (prev?.type             ?? 'plan'),
    status:           status           !== undefined ? (VALID_DISCUSSION_STATUSES.has(status) ? status : 'active') : (prev?.status  ?? 'active'),
    tags:             tags             !== undefined ? normalizeTags(tags)                              : (prev?.tags             ?? []),
    // For steps: if caller passed steps[], re-normalize them but preserve any
    // per-step fields (linkedContextIds, completedAt) that already exist on prev.
    steps:            steps            !== undefined ? mergeSteps(prev?.steps ?? [], steps)             : (prev?.steps            ?? []),
    linkedContextIds: linkedContextIds !== undefined ? (Array.isArray(linkedContextIds) ? linkedContextIds : []) : (prev?.linkedContextIds ?? []),
    createdAt:        prev?.createdAt || now,
    updatedAt:        now,
  };
  if (existing >= 0) store.discussions[existing] = disc;
  else store.discussions.push(disc);
  _changedDiscussionNames.add(disc.name);
  markDirty();
  return disc;
}

// Merge incoming steps[] with the existing steps[], preserving runtime state
// (linkedContextIds, completedAt) for steps that already exist by id or order.
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
  refreshFromDisk();
  const store = load();
  const disc = id
    ? store.discussions.find(d => d.id === id)
    : store.discussions.find(d => d.name === name);
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
  _changedDiscussionNames.add(disc.name);
  markDirty();
  return disc;
}
export function getDiscussion({ project, name, id } = {}) {
  refreshFromDisk();
  const store = load();
  let list = store.discussions;
  if (project) list = list.filter(d => d.project === project || d.project === 'global');
  if (id)   return list.find(d => d.id   === id)   || null;
  if (name) return list.find(d => d.name === name) || null;
  return null;
}

export function listDiscussions({ project, status, type } = {}) {
  refreshFromDisk();
  const store = load();
  let list = store.discussions;
  if (project) list = list.filter(d => d.project === project || d.project === 'global');
  if (status)  list = list.filter(d => d.status === status);
  if (type)    list = list.filter(d => d.type === type);
  // Return without full content — just header + stepsSummary
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
  refreshFromDisk();
  const store = load();
  const disc = discussionId
    ? store.discussions.find(d => d.id   === discussionId)
    : store.discussions.find(d => d.name === discussionName);
  if (!disc) return null;
  if (!Array.isArray(disc.linkedContextIds)) disc.linkedContextIds = [];
  let changed = false;
  if (!disc.linkedContextIds.includes(contextId)) {
    disc.linkedContextIds.push(contextId);
    disc.updatedAt = new Date().toISOString();
    _changedDiscussionNames.add(disc.name);
    changed = true;
  }
  // write discussionId back onto the context entry
  const entry = store.contexts.find(c => c.id === contextId);
  if (entry && entry.discussionId !== disc.id) {
    entry.discussionId = disc.id;
    entry.updatedAt = new Date().toISOString();
    _changedContextIds.add(entry.id);
    changed = true;
  }
  if (changed) markDirty();
  return { discussionId: disc.id, contextId };
}

export function addRelation({ fromId, toId, relType = 'relates-to' }) {
  refreshFromDisk();
  const store = load();
  const from = store.contexts.find(c => c.id === fromId);
  const to   = store.contexts.find(c => c.id === toId);
  if (!from || !to) return null;
  if (!Array.isArray(from.relations)) from.relations = [];
  if (!Array.isArray(to.relatedBy))   to.relatedBy   = [];
  if (!from.relations.find(r => r.id === toId)) {
    from.relations.push({ id: toId, relType });
    from.updatedAt = new Date().toISOString();
    _changedContextIds.add(from.id);
  }
  if (!to.relatedBy.find(r => r.id === fromId)) {
    to.relatedBy.push({ id: fromId, relType });
    to.updatedAt = new Date().toISOString();
    _changedContextIds.add(to.id);
  }
  markDirty();
  return { fromId, toId, relType };
}

export function getContextByDiscussion(discussionId) {
  refreshFromDisk();
  const store = load();
  return store.contexts.filter(c => c.discussionId === discussionId);
}

export function clearDiscussionLink(contextId) {
  refreshFromDisk();
  const store = load();
  const entry = store.contexts.find(c => c.id === contextId);
  if (!entry) return null;
  entry.discussionId = null;
  entry.updatedAt = new Date().toISOString();
  _changedContextIds.add(entry.id);
  markDirty();
  return entry;
}

export function deleteDiscussion({ name, id }) {
  refreshFromDisk();
  const store = load();
  const before = store.discussions.length;
  // Find the discussion first so we can clean up _changedDiscussionNames regardless of
  // whether it was matched by name or id.
  const toDelete = store.discussions.find(d => (id && d.id === id) || (name && d.name === name));
  store.discussions = store.discussions.filter(d => {
    if (id)   return d.id   !== id;
    if (name) return d.name !== name;
    return true;
  });
  if (store.discussions.length < before) {
    if (toDelete) _changedDiscussionNames.delete(toDelete.name);
    markDirty();
  }
  return { deleted: before - store.discussions.length };
}

export function updateDiscussionStep({ discussionName, discussionId, stepId, status, linkedContextId }) {
  refreshFromDisk();
  const store = load();
  const disc = discussionId
    ? store.discussions.find(d => d.id   === discussionId)
    : store.discussions.find(d => d.name === discussionName);
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
  _changedDiscussionNames.add(disc.name);
  markDirty();
  return { discussion: disc, step };
}

// ── Auto-operations ───────────────────────────────────────────────────────────

export function archiveExpired(project) {
  refreshFromDisk();
  const store = load();
  const now = new Date().toISOString();
  let count = 0;
  for (const entry of store.contexts) {
    if (entry.expiresAt && entry.expiresAt < now && entry.status !== 'archived') {
      entry.status    = 'archived';
      entry.updatedAt = now;
      _changedContextIds.add(entry.id);
      count++;
    }
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
const COMPACTION_TARGET = 30;

export function shouldCompact(project) {
  return countContext(project) > COMPACTION_THRESHOLD;
}

export function compactProject(project, summaryContent) {
  refreshFromDisk();
  const store = load();
  const proj = project || 'global';
  const entries = store.contexts
    .filter(c => (c.project === proj) && c.type !== 'summary')
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  if (entries.length < COMPACTION_TARGET) return null;
  const toRemove = new Set(entries.slice(0, COMPACTION_TARGET).map(e => e.id));
  const removed = store.contexts.filter(c => toRemove.has(c.id));
  store.contexts = store.contexts.filter(c => !toRemove.has(c.id));
  for (const e of removed) {
    _deletedContextIds.add(e.id);
    _changedContextIds.delete(e.id);
  }
  markDirty();
  // save the compaction summary as a new entry
  const summary = saveContext({
    project: proj,
    title: `Compacted ${removed.length} entries — ${new Date().toISOString().slice(0, 10)}`,
    content: summaryContent,
    type: 'summary',
    source: 'auto',
    tags: ['compaction', 'auto'],
  });
  return { removedCount: removed.length, summaryId: summary.id };
}

// ── Graph registry ────────────────────────────────────────────────────────────

export function saveGraph({ path, nodes, edges, communities, cached, changed, time_ms, summary }) {
  refreshFromDisk();
  const store = load();
  // Deduplicate: collapse any case/slash variants of same path, keep newest
  const dupes = store.graphs.filter(g => normPath(g.path) === normPath(path));
  if (dupes.length > 1) {
    const keep = dupes.reduce((a, b) => (a.builtAt >= b.builtAt ? a : b));
    store.graphs = store.graphs.filter(g => normPath(g.path) !== normPath(path));
    store.graphs.push(keep);
  }
  const existing = store.graphs.find(g => normPath(g.path) === normPath(path));
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
  if (existing) {
    Object.assign(existing, record);
  } else {
    store.graphs.push(record);
  }
  _changedGraphPaths.add(path);
  markDirty();
  return record;
}

export function getGraph(path) {
  const store = load();
  if (path) return store.graphs.find(g => normPath(g.path) === normPath(path)) || null;
  return store.graphs;
}

export function listGraphs() {
  return load().graphs;
}
