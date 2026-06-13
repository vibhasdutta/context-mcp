# Context-MCP — Gemini CLI Usage Guide

Persistent memory + codebase knowledge graph.
`context.resume` starts every session. `codegraph_arch` shows module structure. `codegraph_query` finds specific symbols. Files only for bugs/logic.

---

## 1. Start of Every Conversation (MANDATORY)

Call `context` MCP tool: `action:"resume"`, `project:"<project>"` before anything else.

Returns: `recentEntries`, `activePlans`, `codegraph`, `stats.totalEntries`.

- `codegraph.built: true` → use graph tools before reading files
- `codegraph.built: false` → call `codegraph_build(path)` first
- `stats.totalEntries ≥ 20` → write compaction summary FIRST (see Rule 4)
- `activePlans` non-empty → read them before starting new work

---

## 2. Save Triggers (MANDATORY)

Call `context.save` with `type: "note"` after finishing anything worth keeping:

| Trigger | Required fields |
|---|---|
| Task / fix / feature complete | title, why, outcome, files[] |
| Decision made | title, why, outcome |
| Discovery / constraint / gotcha | title, content |
| Config / env / deploy info | title, content |
| Graph build complete | title, content (nodes/edges count) |
| User says "save this" | title, content |
| "compact now" / "compress memory" | `type:"compaction"`, full session summary |

**Do NOT save:** routine reads, search results, explanations of existing code.

---

## 3. Plans (MANDATORY for multi-file work)

**Create a plan when:** editing 2+ files, multi-step implementation, refactor, multi-file bug fix.

1. Call `plan.save` with name, content, project before starting
2. Call `plan.update status:"done"` when complete — deletes the plan

Check `activePlans` on resume — don't create duplicates.

---

## 4. Auto-Summary at ≥ 20 Entries (MANDATORY)

When `totalEntries ≥ 20`, call `context.save` BEFORE the user's task:

```
type: "compaction"  title: "Session summary — <YYYY-MM-DD>"
content: "<what was built, decided, broke, current state>"
project: "<project>"
```

---

## 5. Search Before Asking

Call `search` before asking user to re-explain past work.

---

## 6. ContextGraph Tools

```
codegraph_build(path)                    → build AST graph + auto-generate all visualizations
codegraph_arch(path, limit?)             → module map: files, exports, imports
codegraph_query(path, question?, node?)  → find symbol or answer structural question
codegraph_nodes(path, type)              → list all nodes of a type
codegraph_report(path)                   → structural analysis
codegraph_affected(path, node, depth?)   → blast radius BFS — what breaks if X changes?
codegraph_html(path, formats?)           → regenerate visualizations on demand
```

Use `codegraph_arch` first. Never read files for structure questions.

---

## 7. Rules

1. `context.resume` first — before any tool or response
2. Always pass `project`
3. Save on task complete — `why` + `outcome` + `files`
4. Compaction at ≥ 20 entries — before starting task
5. Plan before multi-file work — `status:"done"` deletes it
6. Search before asking about past work
7. Graph tools before files
