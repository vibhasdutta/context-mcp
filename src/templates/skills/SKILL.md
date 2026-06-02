---
name: context-mcp
description: >
  Persistent memory + ContextGraph (codebase knowledge graph) for Claude.
  Use at the START of every conversation to resume project context. Use
  whenever the user mentions a project, asks to remember/save something,
  references past work, or says "pick up where we left off". Also use
  when the user asks about code structure, dependencies, or what exists
  in a codebase — query the ContextGraph before reading any files.
---

# Context-MCP

Persistent memory + codebase knowledge graph across every conversation.
`context.resume` starts every session. `codegraph_arch` shows module structure. `codegraph_query` finds specific symbols. Files only for bugs/logic.

---

## MANDATORY: Start of Every Conversation

Call `context` tool **before any tool or response** with:
- `action: "resume"`
- `project: "<basename of git repo root dir>"` — infer from `cwd` if not stated
- `rootPath: "<absolute path to git repo root>"` — required for sandbox + graph lookup

Returns:
- `recentEntries` — last 15 entries; newest 5 have full content, rest have 200-char preview
- `activePlans` — in-progress plans; read them before starting any new work
- `codegraph` — `{ built: true/false, nodes, edges, communities }`
- `stats.totalEntries` — if ≥ 20, write a compaction summary before proceeding (see Rule 4)

Then:
- `codegraph.built: true` → use `codegraph_arch` for structure overview, `codegraph_query` for specific lookups
- `codegraph.built: false` → call `codegraph_build(path)` first, then proceed

---

## When to Save Context (MANDATORY TRIGGERS)

### Always save — no judgment needed

**A. Task / fix / feature complete**
Any time you finish implementing something — call `context.save` immediately:

```
context.save
  project: "<project>"
  title:   "<what was done — up to 120 chars, be specific>"
  why:     "<what problem this solved or why it mattered>"
  outcome: "<result: fixed/shipped/verified + which files changed>"
  type:    "task" | "bug" | "decision"
  files:   ["src/file.js", ...]   ← required for task/bug types
```

**B. Decision made** → `type: "decision"` with `why` explaining tradeoffs.

**C. Discovery / gotcha** → `type: "note"` — non-obvious behavior, constraint, env requirement.

**D. Config / deploy** → `type: "config"` — env vars, deploy steps, secrets.

**E. Graph build complete** → save `type:"note"` with nodes/edges/communities count.

**F. Explicit user request** → "save this", "remember this" → save immediately.

**G. Manual compaction** → "compact now", "compress memory", "clean up context" → write full session summary, save as `type:"compaction"`. Server removes old entries using your text.

### Do NOT save
Routine file reads, search results, explanations of existing code, dead-end debugging.

---

## Plans (MANDATORY for multi-file work)

**Create a plan when:** editing 2+ files, multi-step implementation, refactor, or multi-file bug fix.

**Skip plan for:** single-file edits, questions, simple config tweaks.

**Lifecycle:**
1. `plan.save` with name, content, project, planDir — before starting work
2. Work through plan
3. `plan.update status:"done"` when complete

On `resume`, check `activePlans` — do not duplicate in-progress work.

---

## Auto-Summary Rule (MANDATORY)

When `resume` returns `stats.totalEntries ≥ 20`, call `context.save` **before the user's task**:

```
type: "compaction"  title: "Session summary — <date>"
content: "<AI-written: what was built, decided, broke, current state>"
tags: ["compaction", "auto"]  project: "<project>"
```

---

## Search Before Asking

If user references past work → `search` first. Never ask user to re-explain saved information.

---

## ContextGraph Pipeline

### Build (once per project)
```
codegraph_build(path)  →  AST graph: functions, classes, imports, edges
```

### Query tools
```
codegraph_arch(path)                     → module map: every file, exports, imports
codegraph_query(path, question?, node?)  → find symbol or answer structural question
codegraph_nodes(path, type)              → list all nodes of a type
codegraph_report(path)                   → god nodes, clusters, structural analysis
```

### When to use which

| Question | Tool |
|---|---|
| Architecture overview / what files exist | `codegraph_arch` |
| Where is function/class X defined? | `codegraph_query node:"X"` |
| What does module Y import? | `codegraph_query question:"..."` |
| List all classes/functions | `codegraph_nodes type:"class"` |
| Most connected / central files | `codegraph_report` |

---

## Rules

1. `context.resume` first — before any tool or response
2. Always pass `project` — never save to global unless truly cross-project
3. Save on task complete — mandatory, `why` + `outcome` + `files` required
4. Summary at ≥ 20 entries — write before starting task
5. Plan for multi-file work — save before starting, mark done on complete
6. Search before asking — if user references past work
7. `codegraph_arch` for architecture — before reading files for structure questions
8. `codegraph_query` for specific lookups — before reading files for "where is X"
9. Read files only for bugs/logic
