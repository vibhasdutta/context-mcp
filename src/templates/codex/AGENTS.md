# Context-MCP - Codex CLI Usage Guide

Persistent memory + codebase knowledge graph.
`context.resume` starts every session. `codegraph_query` finds specific symbols.
Read files only for bugs or implementation logic.

---

## 1. Start of Every Conversation (MANDATORY)

Call the `context` MCP tool before any other action:

```json
{
  "action": "resume",
  "project": "<project>",
  "rootPath": "<absolute path to the project root>"
}
```

Returns: `recentEntries`, `activePlans`, `codegraph`, `stats.totalEntries`.

- `codegraph.built: true` -> use graph tools before reading files.
- `codegraph.built: false` -> call `codegraph_build(path)` first.
- `stats.totalEntries >= 20` -> write a compaction summary first.
- `activePlans` non-empty -> read them before starting new work.

---

## 2. Save Triggers (MANDATORY)

Call `context.save` with `type: "note"` after finishing anything worth keeping:

| Trigger | Required fields |
|---|---|
| Task / fix / feature complete | title, why, outcome, files[] |
| Decision made | title, why, outcome |
| Discovery / constraint / gotcha | title, content |
| Config / env / deploy info | title, content |
| Graph build complete | title, content with nodes/edges count |
| User says "save this" | title, content |
| "compact now" / "compress memory" | `type: "compaction"`, full session summary |

Do not save routine reads, search results, or explanations of existing code.

---

## 3. Plans (MANDATORY for multi-file work)

Create a plan when editing 2+ files, doing a multi-step implementation, refactor,
or multi-file bug fix.

1. Call `plan.save` with name, content, and project before starting.
2. Call `plan.update status: "done"` when complete.

Check `activePlans` on resume. Do not create duplicates.

---

## 4. Auto-Summary at >= 20 Entries (MANDATORY)

When `totalEntries >= 20`, call `context.save` before the user's task:

```json
{
  "type": "compaction",
  "title": "Session summary - <YYYY-MM-DD>",
  "content": "<what was built, decided, broke, current state>",
  "project": "<project>"
}
```

---

## 5. Search Before Asking

Call `search` before asking the user to re-explain past work.

---

## 6. ContextGraph Tools

```text
codegraph_build(path)                    -> build AST graph + auto-generate all visualizations
codegraph_arch(path, limit?)             -> module map: files, exports, imports
codegraph_query(path, question?, node?)  -> find symbol or answer structural question
codegraph_nodes(path, type)              -> list all nodes of a type
codegraph_report(path)                   -> structural analysis
codegraph_affected(path, node, depth?)   -> blast radius BFS — what breaks if X changes?
codegraph_html(path, formats?)           -> regenerate visualizations on demand
```

Use `codegraph_arch` first. Read files only when you need exact bug or
implementation details.

---

## 7. Rules

1. `context.resume` first, before any tool or response.
2. Always pass `project`.
3. Pass `rootPath` whenever the current project root is known.
4. Save on task complete with why, outcome, and files.
5. Compact at >= 20 entries before starting the task.
6. Plan before multi-file work.
7. Search before asking about past work.
8. Use graph tools before files.
