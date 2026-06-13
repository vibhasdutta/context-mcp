# context-resume

Resume context for the current project from persistent memory.

## Steps

1. Call the `context` MCP tool with `action: "resume"` and `project: "<current project name>"`.
2. Read `recentEntries` — the last saved notes, decisions, and bug records.
3. Read `activePlans` — any in-progress multi-step plans.
4. Check `codegraph.built`:
   - `true` → graph tools are available; use `codegraph_arch` before reading files
   - `false` → run `codegraph_build` when structural questions arise
5. If `stats.totalEntries ≥ 20`, save a compaction summary before starting work:
   ```
   context(action:"save", type:"compaction",
     title:"Session summary — YYYY-MM-DD",
     content:"<full summary of session>",
     project:"<project>")
   ```
6. Summarize what was found: recent work, open plans, graph status.
