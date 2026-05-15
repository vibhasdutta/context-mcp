import { execFileSync } from 'node:child_process';
import { guardPath } from '../guard.js';
import {
  saveContext, updateContext, getContext, deleteContext,
  listProjects, findDuplicate, archiveExpired, linkContextToDiscussion,
  listDiscussions, listGraphs, countContext, shouldCompact, compactProject,
  ensureProject, getProjectRoot,
} from '../db.js';

function detectGitRoot() {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: process.cwd(), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch { return null; }
}
import { summarizeEntries } from '../summarizer.js';
import { fireAutoLink } from '../hooks/autoLink.js';

function autoDigest(entries, project) {
  if (entries.length <= 10) return null;
  return summarizeEntries(entries, { project: project || 'global', topN: 5 });
}

export const definition = {
  name: 'context',
  description:
    `Factual memory — record what happened, what was decided, what broke, what was built.\n` +
    `• "resume"       — START HERE every conversation. Loads recent context, active discussions, and graph status for a project.\n` +
    `• "save"         — Store a note, decision, bug, or code snippet. Auto-deduplicates.\n` +
    `• "get"          — Load recent entries (compact previews). Auto-digests when large.\n` +
    `• "update"       — Edit an existing entry by id (any field).\n` +
    `• "delete"       — Remove an entry by id.\n` +
    `• "list_projects"— Show all projects and entry counts.`,
  inputSchema: {
    type: 'object',
    properties: {
      action:        { type: 'string', enum: ['resume', 'save', 'get', 'update', 'delete', 'list_projects'] },
      content:       { type: 'string' },
      title:         { type: 'string' },
      project:       { type: 'string' },
      rootPath:      { type: 'string', description: 'Absolute path to the project root directory. Stored on first call and used to sandbox file/git tool access.' },
      type:          { type: 'string', enum: ['decision', 'note', 'code', 'bug', 'architecture', 'config', 'summary', 'error'] },
      status:        { type: 'string', enum: ['active', 'archived'] },
      tags:          { type: 'array', items: { type: 'string' } },
      source:        { type: 'string', enum: ['user', 'ai-summary', 'file', 'web', 'cli', 'auto'] },
      files:         { type: 'array', items: { type: 'object' } },
      codeRefs:      { type: 'array', items: { type: 'object' } },
      relations:     { type: 'array', items: { type: 'object' } },
      expiresAt:     { type: 'string' },
      limit:         { type: 'number' },
      includeArchived: { type: 'boolean' },
      id:            { type: 'string' },
    },
    required: ['action'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      success:  { type: 'boolean' },
      id:       { type: 'string' },
      message:  { type: 'string' },
      entries:  { type: 'array' },
      count:    { type: 'number' },
      digest:   { type: 'string' },
      projects: { type: 'array' },
      storePath:{ type: 'string' },
    },
  },
};

export async function handle(args, state) {
  const { getStorePath } = await import('../db.js');

  switch (args.action) {

    case 'resume': {
      const proj = args.project || null;
      archiveExpired(proj);

      // Set project on state so autoLink works for subsequent saves
      if (proj) state.sessionProject = proj;

      // Store rootPath with project (first time only) and load it onto session state.
      // Auto-detect from git if neither provided nor previously stored.
      const storedRoot = proj ? getProjectRoot(proj) : null;
      const resolvedRoot = args.rootPath || storedRoot || detectGitRoot() || null;
      if (proj) ensureProject(proj, resolvedRoot || undefined);
      state.projectRootPath = resolvedRoot;

      const entries       = getContext({ project: proj, limit: 15, compact: true })
        .filter(e => e.status !== 'archived');
      const discussions   = listDiscussions({ project: proj, status: 'active' });
      const allGraphs     = listGraphs();
      const graph         = proj
        ? allGraphs.find(g => g.path?.toLowerCase().includes(proj.toLowerCase())) || allGraphs[0] || null
        : allGraphs[0] || null;
      const totalEntries  = countContext(proj);

      // Auto-restore single active discussion
      if (discussions.length === 1) state.discussionId = discussions[0].id;

      const digest = totalEntries > 10
        ? autoDigest(getContext({ project: proj, limit: 30 }), proj)
        : null;

      const graphStatus = graph
        ? { built: true, path: graph.path, nodes: graph.nodes, edges: graph.edges, communities: graph.communities, builtAt: graph.builtAt }
        : { built: false };

      return {
        recentEntries:      entries,
        activeDiscussions:  discussions,
        restoredDiscussion: discussions.length === 1 ? { id: discussions[0].id, name: discussions[0].name } : null,
        codegraph:          graphStatus,
        digest:             digest || undefined,
        stats:              { totalEntries, projects: listProjects().length },
        message: `Loaded ${totalEntries} entries for project "${proj || 'global'}".${discussions.length === 1 ? ` Auto-linked to discussion "${discussions[0].name}".` : ''}`,
        rootPath: state.projectRootPath || undefined,
        sandbox: state.projectRootPath
          ? `All file and git operations are sandboxed to: ${state.projectRootPath} — do not use paths outside this root.`
          : 'No project root configured — pass rootPath to restrict file/git access to a directory.',
        hint: graphStatus.built
          ? `Graph ready (${graphStatus.nodes} nodes). Use codegraph_query for structural questions.`
          : 'No graph built yet. Call codegraph_build on the project root to enable graph queries.',
      };
    }

    case 'save': {
      if (!args.content) throw new Error('content is required for save');
      if (!args.project && state.sessionProject) args = { ...args, project: state.sessionProject };
      // Auto-detect and store project root if not yet configured
      if (args.project) {
        const existing = getProjectRoot(args.project);
        if (!existing) {
          const detected = state.projectRootPath || detectGitRoot();
          if (detected) {
            ensureProject(args.project, detected);
            if (!state.projectRootPath) state.projectRootPath = detected;
          }
        }
      }
      // Validate file paths in files[] and codeRefs[] stay within project root
      if (state.projectRootPath) {
        if (Array.isArray(args.files)) {
          args.files.forEach(f => { if (f.path) guardPath(f.path, state.projectRootPath); });
        }
        if (Array.isArray(args.codeRefs)) {
          args.codeRefs.forEach(r => { if (r.file) guardPath(r.file, state.projectRootPath); });
        }
      }

      const dupe = findDuplicate(args.content, args.project);
      if (dupe) {
        const updated = updateContext({
          id: dupe.id, content: args.content,
          title: args.title || dupe.title, tags: args.tags || dupe.tags,
          type: args.type || dupe.type, status: args.status || dupe.status,
          expiresAt: args.expiresAt !== undefined ? args.expiresAt : dupe.expiresAt,
          files: args.files || dupe.files, codeRefs: args.codeRefs || dupe.codeRefs,
          relations: args.relations || dupe.relations,
        });
        fireAutoLink(updated.id, state);
        return { success: true, id: updated.id, deduplicated: true,
          message: `Updated existing entry "${updated.title || updated.id}" (auto-dedup).` };
      }
      const entry = saveContext({ ...args });
      fireAutoLink(entry.id, state);

      // Auto-compact when too many entries accumulate
      let compaction = null;
      if (shouldCompact(entry.project)) {
        const old = getContext({ project: entry.project, limit: 500 });
        const { summarizeEntries: summarize } = await import('../summarizer.js');
        const cs = summarize(old.slice(old.length - 30), { project: entry.project || 'global', sessionLabel: 'auto-compaction', topN: 5 });
        compaction = compactProject(entry.project, cs);
      }

      return { success: true, id: entry.id, deduplicated: false,
        compaction: compaction ? { removedCount: compaction.removedCount, message: `Auto-compacted ${compaction.removedCount} old entries into summary.` } : null,
        message: `Saved context "${entry.title || entry.id}" under project "${entry.project}".` };
    }

    case 'get': {
      if (!args.project && state.sessionProject) args = { ...args, project: state.sessionProject };
      archiveExpired(args.project);
      const includeArchived = args.includeArchived === true;
      let entries = getContext({ project: args.project, tags: args.tags, limit: args.limit, compact: true });
      if (!includeArchived) entries = entries.filter(e => e.status !== 'archived');
      const fullEntries = entries.length > 10
        ? getContext({ project: args.project, tags: args.tags, limit: args.limit })
            .filter(e => includeArchived || e.status !== 'archived')
        : null;
      const digest = fullEntries ? autoDigest(fullEntries, args.project) : null;
      return {
        entries, count: entries.length, digest: digest || undefined,
        message: entries.length
          ? `Found ${entries.length} entries.${digest ? ' Auto-digest included.' : ''} Use search for full content.`
          : 'No context found.',
      };
    }

    case 'update': {
      if (!args.id) throw new Error('id is required for update');
      const updated = updateContext({ ...args });
      if (!updated) throw new Error(`No entry found with id "${args.id}"`);
      fireAutoLink(updated.id, state);
      return { success: true, id: updated.id, version: updated.version,
        message: `Updated entry "${updated.title || updated.id}" (v${updated.version}).` };
    }

    case 'delete': {
      if (!args.id) throw new Error('id is required for delete');
      return deleteContext(args);
    }

    case 'list_projects': {
      return { projects: listProjects(), storePath: getStorePath() };
    }

    default:
      throw new Error(`Unknown context action: ${args.action}`);
  }
}
