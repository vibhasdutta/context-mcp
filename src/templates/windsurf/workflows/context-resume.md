# context-resume

Resume project memory and ContextGraph from context-mcp before starting any work.

1. Call the `context` MCP tool with `action: "resume"`, infer `project` from the current working directory name, and pass `rootPath` as the absolute path to the git repo root.

2. Read the returned `recentEntries` (last 15 entries), `activePlans`, and `codegraph` status.

3. If `codegraph.built` is false, call `codegraph_build` on the project path immediately before proceeding.

4. If `stats.totalEntries` is 20 or more, save a compaction summary before starting any new work.
