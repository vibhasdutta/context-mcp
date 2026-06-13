# graph-build

Build or refresh the codebase knowledge graph for the current project.

## Steps

1. Identify the project root — use the workspace path or ask if ambiguous.
2. Call `codegraph_build` with `path: "<absolute project root>"`.
   - This scans all source files using AST extraction (16+ languages).
   - Incremental: only changed files are re-processed.
3. When complete, call `context` with `action:"save"`:
   ```
   type: "note"
   title: "CodeGraph built — <project>"
   content: "nodes: N | edges: E | communities: C | time: Xms"
   project: "<project>"
   tags: ["codegraph"]
   ```
4. Report: node count, edge count, communities, any warnings.
5. Suggest next steps:
   - `codegraph_arch` — module map
   - `codegraph_report` — god nodes, surprising connections
   - `codegraph_query` — ask structural questions
