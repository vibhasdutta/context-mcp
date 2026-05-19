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
    name: 'codegraph_extract',
    description:
      'Return raw content of changed code and doc/PDF files so the AI can write descriptions. ' +
      'Code files: lists existing AST nodes — AI writes a description for each. ' +
      'Doc files: AI extracts new concept nodes. ' +
      'Call after codegraph_build, then call codegraph_add_nodes with results. ' +
      'Pass force:true to re-enrich all files (not just changed ones).',
    inputSchema: {
      type: 'object',
      properties: {
        path:  { type: 'string', description: 'Project root (same as codegraph_build)' },
        limit: { type: 'integer', description: 'Max files to return per call (default 10)' },
        force: { type: 'boolean', description: 'Return all files, not just changed (for re-enrichment)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'codegraph_add_nodes',
    description:
      'Add concept nodes extracted by the AI into the graph. ' +
      'Call after reading codegraph_extract output. ' +
      'Each node: name, type, file, and optionally description and relations.',
    inputSchema: {
      type: 'object',
      properties: {
        path:  { type: 'string', description: 'Project root' },
        nodes: {
          type: 'array',
          description: 'Concept nodes to add',
          items: {
            type: 'object',
            properties: {
              name:        { type: 'string' },
              type:        { type: 'string', description: 'class|function|concept|service|decision|requirement' },
              file:        { type: 'string', description: 'Relative file path this concept came from' },
              description: { type: 'string' },
              relations: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name:     { type: 'string' },
                    relation: { type: 'string', description: 'depends-on|uses|implements|defines|documents' },
                  },
                },
              },
            },
            required: ['name', 'type', 'file'],
          },
        },
      },
      required: ['path', 'nodes'],
    },
  },
  {
    name: 'codegraph_query',
    description:
      'Ask a structural/dependency question about the codebase. ' +
      'Pure graph traversal — returns NODE/EDGE structured text truncated to token_budget. ' +
      'Good for: "what does module X depend on?", "what calls function Y?", "what is the path from A to B?". ' +
      'NOT for: bug investigation, logic errors, or understanding what code actually does — read the file directly for those.',
    inputSchema: {
      type: 'object',
      properties: {
        path:         { type: 'string', description: 'Project root' },
        question:     { type: 'string', description: 'Natural language question' },
        token_budget: { type: 'integer', description: 'Max tokens in response (default 2000)' },
      },
      required: ['path', 'question'],
    },
  },
  {
    name: 'codegraph_explain',
    description:
      'Look up a node by name — returns description, type, file, and direct neighbors (depends_on + used_by). ' +
      'Use to understand what a specific function/class/module does and how it connects. ' +
      'Descriptions are AI-written via codegraph_add_nodes.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Project root' },
        node: { type: 'string', description: 'Node name or partial name' },
      },
      required: ['path', 'node'],
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
