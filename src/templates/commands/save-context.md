Call the `context` MCP tool with `action: "save"` to store a note for the current project.

Parse `$ARGUMENTS` to determine:
- `project`: infer from current working directory name if not specified
- `title`: first sentence or phrase (up to 120 chars — be specific)
- `why`: reason it mattered — what problem it solved or constraint it revealed
- `outcome`: result — what changed, what was verified, what shipped, which files were affected
- `files`: list of files changed (required for task/bug types)
- `content`: full argument text
- `type`: auto-detect — bug/fix/error → `"bug"`, task/done/complete/shipped/implemented → `"task"`, decision/chose/decided/approach → `"decision"`, config/env/secret/deploy → `"config"`, otherwise `"note"`

Confirm to the user: title, type, why, outcome, project.
