# context-resume

Resume project memory and ContextGraph from context-mcp before starting any work.

Call the `context` MCP tool with `action: "resume"`, infer `project` from the current working directory name, and pass `rootPath` as the absolute path to the git repo root.

This loads recent decisions, bugs, notes, active plans, and ContextGraph status. If `codegraph.built` is false, immediately call `codegraph_build` on the project path.
