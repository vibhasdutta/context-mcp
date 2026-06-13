# save-context

Save the current work state to persistent memory.

## Steps

1. Ask (or infer from context):
   - **Title** — one-line summary of what was done
   - **Why** — motivation or trigger
   - **Outcome** — result, decision, or current state
   - **Files** — list of files touched (if applicable)
2. Call `context` MCP tool with `action: "save"`:
   ```
   type: "note"
   title: "<title>"
   why: "<why>"
   outcome: "<outcome>"
   files: ["<file1>", "<file2>"]
   project: "<project>"
   ```
3. Confirm: report the saved entry ID and title.

## When to use

- After completing a task, fix, or feature
- After making a significant decision
- When discovering a constraint or gotcha
- When the user says "save this" or "remember this"
- After a graph build (use `graph-build` workflow instead)
