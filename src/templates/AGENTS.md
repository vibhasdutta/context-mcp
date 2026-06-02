# Context-MCP — Codex CLI Usage Guide

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

| Trigger | Type | Required fields |
|---|---|---|
| Task / fix / feature complete | `task` or `bug` | title, why, outcome, files[] |
| Decision made | `decision` | title, why, outcome |
| Discovery / constraint | `note` | title, content |
| Config / env / deploy | `config` | title, content |
| Graph build complete | `note` | nodes/edges/communities count |
| User says "save this" | any | title, content |
| "compact now" / "compress memory" / "clean up context" | `compaction` | full session summary as content |

Always include `why` (why it mattered) and `outcome` (what the result was) for task/bug/decision entries. Title up to 120 chars — be specific.

**Do NOT save:** routine reads, search results, explanations of existing code.

---

## 3. Plans (MANDATORY for multi-file work)

**Create a plan when:** editing 2+ files, multi-step implementation, refactor, multi-file bug fix.

**Skip plan for:** single-file edits, questions, simple config tweaks.

1. Call `plan.save` with name, content, project before starting work
2. Call `plan.update status:"done"` when complete

On resume, check `activePlans` — do not create duplicate plans.

---

## 4. Auto-Summary at ≥ 20 Entries (MANDATORY)

When `resume` returns `totalEntries ≥ 20`, call `context.save` BEFORE the user's task:

```
type: "compaction"  title: "Session summary — <YYYY-MM-DD>"
content: "<AI-written summary: what was built, decided, broke, current state>"
tags: ["compaction", "auto"]  project: "<project>"
```

---

## 5. Search Before Asking

Call `search` before asking user to re-explain past work.

---

## 6. ContextGraph Tools

```
codegraph_build(path)                    → build AST graph (run once)
codegraph_arch(path, limit?)             → module map: files, exports, imports
codegraph_query(path, question?, node?)  → find symbol or answer structural question
codegraph_nodes(path, type)              → list all nodes of a type
codegraph_report(path)                   → structural analysis
```

Use `codegraph_arch` first for architecture overview. Use `codegraph_query` to find specific symbols. Never read files for structure questions.

---

## 7. Rules

1. `context.resume` first — before any tool or response
2. Always pass `project`
3. Save on task complete — `why` + `outcome` + `files` required
4. Summary at ≥ 20 entries — before starting task
5. Plan before multi-file work — save + mark done
6. Search before asking user about past work
7. Graph tools before files — structure questions only
8. Read files only for bugs/logic
