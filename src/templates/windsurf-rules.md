# Context-MCP — Windsurf Usage Guide

Persistent memory + codebase knowledge graph for Windsurf.
`context.resume` starts every session. `codegraph_arch` shows module structure. `codegraph_query` finds specific symbols. Files only for bugs/logic.

---

## 1. Start of Every Conversation (MANDATORY)

Call `context` tool: `action:"resume"`, `project:"<name>"` before anything else.

Returns: `recentEntries`, `activePlans`, `codegraph`, `stats.totalEntries`.

- `codegraph.built: false` → run `codegraph_build(path)` first
- `stats.totalEntries ≥ 20` → write compaction summary first (see Rule 4)
- `activePlans` non-empty → read them before starting new work

---

## 2. Save Context (MANDATORY TRIGGERS)

| When | Type | Required fields |
|---|---|---|
| Task / fix / feature complete | `task` / `bug` | title, why, outcome, files[] |
| Decision made | `decision` | title, why, outcome |
| Discovery / constraint | `note` | title, content |
| Config / env / deploy | `config` | title, content |
| Graph build complete | `note` | nodes/edges count |
| "save this" / "remember this" | any | title, content |
| "compact now" / "compress memory" | `compaction` | full session summary |

Title up to 120 chars. Always include `why` and `outcome` for task/bug/decision types.

---

## 3. Plans

Call `plan.save` before any work touching 2+ files or multiple steps.
Call `plan.update status:"done"` when complete.
Check `activePlans` on resume — don't duplicate.

---

## 4. Auto-Summary at ≥ 20 Entries (MANDATORY)

When `totalEntries ≥ 20`, call `context.save` BEFORE the user's task:
`type:"compaction"`, `title:"Session summary — <date>"`, AI-written content summary.

---

## 5. Search Before Asking

Call `search` before asking user to re-explain past work.

---

## 6. ContextGraph Tools

```
codegraph_arch(path)          → module map (files, exports, imports) — use for architecture
codegraph_query(path, ...)    → find specific function/class/file
codegraph_nodes(path, type)   → list all nodes of a type
codegraph_report(path)        → structural analysis
```

Use `codegraph_arch` first. Never read files for structure questions.

---

## 7. Rules

1. `context.resume` first — every conversation
2. Save on task complete — `why` + `outcome` + `files` mandatory
3. Compaction summary when ≥ 20 entries — before starting task
4. Plan for 2+ file changes
5. Search before asking user about past work
6. Graph tools before files
7. Files only for bugs and logic
