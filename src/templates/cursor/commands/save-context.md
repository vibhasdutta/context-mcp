# save-context

Save a note, decision, bug, or task to context-mcp project memory.

Call the `context` MCP tool with `action: "save"`. Infer `project` from the current working directory name. Auto-detect `type` from the user's description:
- bug/fix/error → `"bug"`
- task/done/complete/shipped → `"task"`
- decision/chose/decided → `"decision"`
- config/env/deploy → `"config"`
- otherwise → `"note"`

Fill in `title` (up to 120 chars), `why`, `outcome`, and `files`. Confirm back to the user what was saved.
