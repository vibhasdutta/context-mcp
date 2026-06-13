---
mode: agent
description: "Save a note/decision/bug to context-mcp project memory"
argument-hint: "What to remember (e.g. 'fixed auth bug in src/auth.js')"
---

Call the `context` MCP tool with `action: "save"` to store a note for the current project.

Infer `project` from the current working directory name. Auto-detect `type`:
- bug/fix/error → `"bug"`
- task/done/complete/shipped/implemented → `"task"`
- decision/chose/decided/approach → `"decision"`
- config/env/secret/deploy → `"config"`
- otherwise → `"note"`

Fill in `title` (up to 120 chars), `why`, `outcome`, and `files`. Confirm back to the user: title, type, why, outcome, and project.
