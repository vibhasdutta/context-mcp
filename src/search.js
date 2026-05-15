/**
 * search.js — unified search entry point
 *
 * Single function replaces direct calls to searchContext / vectorSearch / findRelated
 * across index.js, cli.js, and error_check. db.js + vector.js stay as low-level impls.
 */

import { getContext, searchContext } from './db.js';
import { vectorSearch, findRelated } from './vector.js';

/**
 * @param {Object} opts
 * @param {string} opts.query      - search query (keyword/semantic)
 * @param {string} [opts.mode]     - 'keyword' | 'semantic' | 'related' (default: semantic)
 * @param {string} [opts.project]  - scope to project
 * @param {number} [opts.limit]    - max results (default 10)
 * @param {string} [opts.id]       - [related] entry ID
 * @param {boolean} [opts.compact] - return compact previews
 */
export function search({ query, mode = 'semantic', project, limit = 10, id, compact = false }) {
  switch (mode) {
    case 'keyword': {
      if (!query) throw new Error('query required for keyword search');
      return searchContext({ query, project, limit, compact });
    }
    case 'semantic': {
      if (!query) throw new Error('query required for semantic search');
      const corpus = getContext({ project, limit: 500 });
      return vectorSearch(query, corpus, limit);
    }
    case 'related': {
      if (!id) throw new Error('id required for related search');
      const all = getContext({ limit: 1000 });
      const target = all.find(e => e.id === id || e.id.startsWith(id));
      if (!target) throw new Error(`No entry found with id starting "${id}"`);
      // explicit relations first, semantic enrichment for remainder
      const explicitIds = new Set([
        ...(target.relations  || []).map(r => r.id),
        ...(target.relatedBy  || []).map(r => r.id),
      ]);
      const explicit = all.filter(e => explicitIds.has(e.id));
      const semantic = explicitIds.size < limit
        ? findRelated(target, all.filter(e => !explicitIds.has(e.id) && e.id !== target.id), limit - explicitIds.size)
        : [];
      return { target, results: [...explicit, ...semantic].slice(0, limit) };
    }
    default:
      throw new Error(`Unknown search mode: ${mode}. Use: keyword, semantic, related`);
  }
}
