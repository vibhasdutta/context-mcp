/**
 * src/tools/codegraph.js — CodeGraph tools bridged to Python subprocess.
 * Spawns `uv run python -m codegraph` with JSON on stdin, reads JSON from stdout.
 */

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT  = join(__dirname, '..', '..');

function callPython(tool, args) {
  const result = spawnSync('uv', ['run', 'python', '-m', 'codegraph'], {
    input:    JSON.stringify({ tool, args }),
    encoding: 'utf8',
    cwd:      REPO_ROOT,
    timeout:  120_000,
  });
  if (result.error) throw new Error(`codegraph subprocess failed: ${result.error.message}`);
  if (result.status !== 0) throw new Error(result.stderr?.trim() || 'codegraph error');
  const out = result.stdout.trim();
  if (!out) throw new Error('codegraph returned no output');
  return JSON.parse(out);
}

export const definitions = [
  {
    name: 'codegraph_build',
    description:
      'Scan a project directory and build the knowledge graph from code files. ' +
      'Uses AST extraction for code files. For docs and PDFs, call codegraph_extract ' +
      'afterward — the AI reads and extracts concepts, then calls codegraph_add_nodes.',
    inputSchema: {
      type: 'object',
      properties: {
        path:    { type: 'string', description: 'Absolute path to project root' },
        cluster: { type: 'boolean', description: 'Run community detection after build (default true)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'codegraph_query',
    description:
      'Ask a structural question about the codebase OR look up a specific node by name — or both in one call. ' +
      'Pass `question` for natural-language traversal: "what does module X depend on?", "what calls function Y?". ' +
      'Pass `node` for fast single-node lookup: returns type, file, depends_on, used_by. ' +
      'Pass both to get node detail + surrounding graph context together. ' +
      'Returns structured text within token_budget. Use before reading any files.',
    inputSchema: {
      type: 'object',
      properties: {
        path:         { type: 'string', description: 'Project root' },
        question:     { type: 'string', description: 'Natural language question about the codebase' },
        node:         { type: 'string', description: 'Node name or partial name to look up (type, file, deps, callers)' },
        token_budget: { type: 'integer', description: 'Max tokens in response (default 2000)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'codegraph_report',
    description: 'Return CODEGRAPH_REPORT.md — god nodes, clusters, surprising connections, suggested questions.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'codegraph_nodes',
    description: 'List all nodes of a given type in the graph.',
    inputSchema: {
      type: 'object',
      properties: {
        path:  { type: 'string' },
        type:  { type: 'string', enum: ['class', 'function', 'module', 'concept', 'service', 'file', 'struct', 'table'] },
        limit: { type: 'integer', description: 'Max results (default 50)' },
      },
      required: ['path', 'type'],
    },
  },
  {
    name: 'codegraph_path',
    description: 'Find the shortest relationship path between two concepts in the graph.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        from: { type: 'string' },
        to:   { type: 'string' },
      },
      required: ['path', 'from', 'to'],
    },
  },
];

export const TOOL_NAMES = new Set(definitions.map(d => d.name));

export function handle(name, args, state) {
  const result = callPython(name, args);

  // Persist graph metadata + save/update a context entry as a visible build record
  if (name === 'codegraph_build' && result.success) {
    import('../db.js').then(({ saveGraph, saveContext, updateContext, getContext }) => {
      saveGraph({
        path:        args.path,
        nodes:       result.nodes,
        edges:       result.edges,
        communities: result.communities,
        cached:      result.cached,
        changed:     result.changed,
        time_ms:     result.time_ms,
        summary:     result.summary || '',
      });

      const inferredProject = args.path
        ? args.path.replace(/\\/g, '/').replace(/\/$/, '').split('/').pop()
        : null;
      const project = state?.sessionProject || inferredProject || null;
      const title   = `CodeGraph — ${args.path}`;
      const content = [
        `nodes: ${result.nodes} | edges: ${result.edges} | communities: ${result.communities}`,
        `cached: ${result.cached} | changed: ${result.changed} | time: ${result.time_ms}ms`,
        result.summary || '',
      ].filter(Boolean).join('\n');

      const existing = getContext({ project, tags: ['codegraph'], limit: 100 })
        .find(e => e.title === title);

      if (existing) {
        updateContext({ id: existing.id, content, status: 'active' });
      } else {
        saveContext({
          project,
          sessionId: state?.sessionId || null,
          title,
          content,
          type:   'architecture',
          source: 'auto',
          tags:   ['codegraph', 'graph-build'],
        });
      }
    }).catch(() => {});
  }

  return result;
}
