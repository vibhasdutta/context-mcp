---
name: context-mcp
description: >
  Persistent memory + ContextGraph for Claude.
  Use at the START of every conversation to resume project context.
  Use whenever the user mentions a project, asks to remember/save something,
  references past work, or says "pick up where we left off".
  Also use when the user asks about code structure — query ContextGraph before reading any files.
---

# Context-MCP — Claude Usage Guide

Persistent memory + codebase knowledge graph across every conversation.
`context.resume` starts every session. `codegraph_arch` shows module structure. `codegraph_query` finds specific symbols. Files only for bugs/logic.

---

## 1. Start of Every Conversation (MANDATORY)

Call `context` tool **before any tool or response**:
- `action: "resume"`
- `project: "<basename of git repo root>"` — infer from cwd
- `rootPath: "<absolute path to git repo root>"` — required

Returns:
- `recentEntries` — last 15 entries; newest 5 have full content, rest have 200-char preview
- `activePlans` — in-progress plans; read them before starting any new work
- `codegraph` — `{ built: true/false, nodes, edges }`
- `stats.totalEntries` — if ≥ 20, write a compaction summary before proceeding (see Rule 4)

Then:
- `codegraph.built: true` → use `codegraph_arch` for structure overview, `codegraph_query` for specific lookups
- `codegraph.built: false` → call `codegraph_build(path)` first

---

## 2. When to Save Context (MANDATORY TRIGGERS)

### Always save — no judgment needed

**A. Task / fix / feature complete**
Any time you finish implementing something — a bug fix, a feature, a refactor, a config change — call `context.save` immediately:

```
context.save
  project: "<project>"
  title:   "<what was done — up to 120 chars, be specific>"
  why:     "<what problem this solved or why it mattered>"
  outcome: "<result: fixed/shipped/verified + which files changed>"
  type:    "task" | "bug" | "decision"
  files:   ["src/file.js", ...]   ← required for task/bug types
```

Example:
```
title:   "Fixed saveContext() not passing rootPath to ensureProject()"
why:     "Projects created without rootPath broke file sandboxing on subsequent calls"
outcome: "Patched db.js:299. Verified via context.resume showing rootPath populated."
type:    "bug"
files:   ["src/db.js"]
```

**B. Decision made**
Architecture choice, library selected, approach agreed on → save as `type: "decision"` with `why` explaining tradeoffs.

**C. Discovery / gotcha**
Non-obvious behavior found, constraint identified, env requirement discovered → `type: "note"`.

**D. Config / deploy**
Env vars, deploy steps, secrets structure → `type: "config"`.

**E. Graph build complete**
After every `codegraph_build` succeeds → save:
```
type: "note"  title: "ContextGraph built — <project>"
content: "nodes: X | edges: Y | communities: Z"
```

**F. Explicit user request**
"save this", "remember this", "note that" → save immediately.

**G. Manual compaction request**
"compact now", "summarize and compress", "clean up context", "compress memory" → write a full session summary and save as `type:"compaction"`. Server will automatically remove old entries using your summary.

### Do NOT save
Routine file reads, search results, explanations of existing code, dead-end debugging steps.

---

## 3. Plans (MANDATORY for multi-file work)

**Create a plan when:**
- About to edit 2+ files
- Multi-step implementation, refactor, or architectural change
- Bug fix requiring investigation across multiple files

**Skip plan for:**
- Single-file edits
- Answering a question
- Simple config tweaks

**Lifecycle:**
1. Call `plan.save` with `name`, `content` (full plan in markdown), `project`, `planDir` before starting work
2. Work through the plan
3. Call `plan.update status:"done"` when complete

On `resume`, if `activePlans` is non-empty — read them before starting any new work. Do not create a duplicate plan for in-progress work.

---

## 4. Auto-Summary Rule (MANDATORY)

When `resume` returns `stats.totalEntries ≥ 20`:

**Before doing anything else**, call `context.save` with an AI-written summary:

```
context.save
  type:    "compaction"
  title:   "Session summary — <YYYY-MM-DD>"
  content: "<what was built, what was decided, what broke, current project state>"
  tags:    ["compaction", "auto"]
  project: "<project>"
```

This runs BEFORE starting the user's task. Mandatory, not optional.

---

## 5. Search Before Asking

If the user references something from a past session → call `search` first:

```
search  query: "<what they're referencing>"  project: "<project>"
```

Never ask the user to re-explain something that may already be saved.

---

## 6. ContextGraph Pipeline

### Build (once per project)
```
codegraph_build(path)
```
Parses all code files into AST graph. Extracts functions, classes, imports, call edges.

### Query tools
```
codegraph_arch(path, limit?)         → module map: every file, its exports, its imports
codegraph_query(path, question?, node?)  → find function/class/file or answer structural question
codegraph_nodes(path, type)          → list all nodes of a type (function/class/module/file)
codegraph_report(path)               → god nodes, clusters, structural analysis
```

### When to use which

| Question | Tool |
|---|---|
| "What files exist and what do they export?" | `codegraph_arch` |
| "Where is function X defined?" | `codegraph_query node:"X"` |
| "What does module Y depend on?" | `codegraph_query question:"what does Y import?"` |
| "What are all the classes?" | `codegraph_nodes type:"class"` |
| "What are the most connected files?" | `codegraph_report` |

**Never read files just to understand structure — use graph tools first.**

---

## 7. Rules Summary

1. `context.resume` first — before any tool or response
2. Always pass `project` — never save to global unless truly cross-project
3. Save on task complete — mandatory, with `why` + `outcome` + `files`
4. Summary at ≥ 20 entries — write it before starting the task
5. Plan for multi-file work — save before starting, mark done on complete
6. Search before asking — if user references past work
7. `codegraph_arch` for structure overview — before reading any file for architecture questions
8. `codegraph_query` for specific lookups — before reading any file for "where is X" questions
9. Read files only for bugs/logic — graph is structure, not behavior
