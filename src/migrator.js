/**
 * migrator.js — one-time migration from flat JSON files to per-project directory structure.
 *
 * Old layout:
 *   ~/.context-mcp/contexts.json      all entries flat
 *   ~/.context-mcp/discussions.json   all discussions flat
 *   ~/.context-mcp/graphs.json        all graph build records flat
 *
 * New layout:
 *   ~/.context-mcp/projects/<slug>/context.json
 *   ~/.context-mcp/projects/<slug>/graph.json     { build, entries[] }
 *   ~/.context-mcp/projects/<slug>/summary.json
 *   ~/.context-mcp/projects/<slug>/discussions.json
 */

import { readFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

function normPath(p) {
  return p ? p.toLowerCase().replace(/\\/g, '/').replace(/\/$/, '') : '';
}

function treeFor(entry) {
  if (entry.type === 'compaction') return 'summary';
  return 'context';
}

function readArr(filePath, key) {
  if (!existsSync(filePath)) return [];
  try {
    const d = JSON.parse(readFileSync(filePath, 'utf8'));
    return Array.isArray(d[key]) ? d[key] : (Array.isArray(d) ? d : []);
  } catch { return []; }
}

/**
 * Run migration if legacy flat files are present.
 * @param {object} opts
 * @param {string}   opts.dataDir       - base data dir (~/.context-mcp)
 * @param {string}   opts.projectsDir   - projects sub-dir
 * @param {string}   opts.projectsPath  - path to projects.json
 * @param {Function} opts.slugify       - name → filesystem slug
 * @param {Function} opts.flushFile     - (filePath, content) atomic write
 * @param {Array}    opts.projectsIndex - current projects.json array (mutated in place)
 */
export function runMigration({ dataDir, projectsDir, projectsPath, slugify, flushFile, projectsIndex }) {
  const legacyContexts    = join(dataDir, 'contexts.json');
  const legacyDiscussions = join(dataDir, 'discussions.json');
  const legacyGraphs      = join(dataDir, 'graphs.json');

  const hasLegacy = existsSync(legacyContexts)
    || existsSync(legacyDiscussions)
    || existsSync(legacyGraphs);

  if (!hasLegacy) return false;

  const oldContexts    = readArr(legacyContexts,    'contexts');
  const oldDiscussions = readArr(legacyDiscussions,  'discussions');
  const oldGraphs      = readArr(legacyGraphs,       'graphs');

  // Remap legacy type names to current 4-type schema
  const TYPE_MAP = { architecture: 'note', code: 'note', error: 'bug', summary: 'compaction' };
  const remapType = entry => {
    if (TYPE_MAP[entry.type]) entry.type = TYPE_MAP[entry.type];
    return entry;
  };

  // Group everything by project name
  const byProject = {};
  const ensure = name => {
    if (!byProject[name]) byProject[name] = {
      context: [], graph: { build: null }, summary: [], discussions: [],
    };
    return byProject[name];
  };

  for (const entry of oldContexts) {
    remapType(entry);
    const p = entry.project || 'global';
    const d = ensure(p);
    if (treeFor(entry) === 'summary') d.summary.push(entry);
    else d.context.push(entry);
  }

  for (const disc of oldDiscussions) {
    ensure(disc.project || 'global').discussions.push(disc);
  }

  // Match graph build records to projects via rootPath
  for (const graph of oldGraphs) {
    const proj = projectsIndex.find(p => normPath(p.rootPath) === normPath(graph.path));
    const name = proj ? proj.name : 'global';
    const d = ensure(name);
    d.graph.build = {
      path: graph.path, nodes: graph.nodes, edges: graph.edges,
      communities: graph.communities, cached: graph.cached || 0,
      changed: graph.changed || 0, time_ms: graph.time_ms || 0,
      summary: graph.summary || '', builtAt: graph.builtAt,
    };
  }

  // Write per-project files
  for (const [name, data] of Object.entries(byProject)) {
    const dir = join(projectsDir, slugify(name));
    mkdirSync(dir, { recursive: true });
    flushFile(join(dir, 'context.json'),     { entries: data.context });
    flushFile(join(dir, 'graph.json'),       data.graph);
    flushFile(join(dir, 'summary.json'),     { entries: data.summary });
    flushFile(join(dir, 'discussions.json'), { discussions: data.discussions });
  }

  // Stamp dataDir onto each project record
  for (const proj of projectsIndex) {
    if (!proj.dataDir) proj.dataDir = `projects/${slugify(proj.name)}`;
  }
  flushFile(projectsPath, { projects: projectsIndex });

  // Remove legacy flat files
  try { unlinkSync(legacyContexts);    } catch {}
  try { unlinkSync(legacyDiscussions); } catch {}
  try { unlinkSync(legacyGraphs);      } catch {}

  return true;
}
