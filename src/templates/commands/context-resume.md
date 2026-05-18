Call the `context` MCP tool with `action: "resume"` and `project: "$ARGUMENTS"` (if no argument given, infer the project name from the current working directory name).

This loads:
- Recent decisions, bugs, and notes from past sessions
- Active discussions
- ContextGraph status (built or not)

If `codegraph.built` is false in the response, immediately call `codegraph_build` on the project path before proceeding.
