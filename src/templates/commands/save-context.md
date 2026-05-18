Call the `context` MCP tool with `action: "save"` to store a note for the current project.

Parse `$ARGUMENTS` to determine:
- `project`: infer from current working directory name if not specified
- `title`: first sentence or phrase from the argument
- `content`: full argument text
- `type`: auto-detect — if mentions a bug/fix → `"bug"`, decision/chose/decided → `"decision"`, structure/architecture → `"architecture"`, otherwise `"note"`

Confirm to the user what was saved (title, type, project).
