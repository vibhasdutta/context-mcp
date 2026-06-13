# save-context

Save a note, decision, bug, or task to context-mcp project memory.

1. Call the `context` MCP tool with `action: "save"`.

2. Infer `project` from the current working directory name.

3. Auto-detect `type` from the user's description:
   - bug/fix/error → `"bug"`
   - task/done/complete/shipped/implemented → `"task"`
   - decision/chose/decided/approach → `"decision"`
   - config/env/secret/deploy → `"config"`
   - otherwise → `"note"`

4. Fill in `title` (up to 120 chars), `why`, `outcome`, and `files`.

5. Confirm back to the user: title, type, why, outcome, and project name.
