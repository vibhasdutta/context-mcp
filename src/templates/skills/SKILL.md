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
`context.resume` starts every session. `codegraph_query` answers every structure question. Files only for bugs/logic.

---

## MANDATORY: Start of Every Conversation

Call `context` tool **before any tool or response** with:
- `action: "resume"`
- `project: "<basename of git repo root dir>"` — infer from `cwd` if not stated
- `rootPath: "<absolute path to git repo root>"` — required for sandbox + graph lookup

Both fields are required: `project` names the memory bucket, `rootPath` enables exact graph matching and file sandboxing.

Returns:
- `recentEntries` — decisions, bugs, notes from past sessions
- `activeDiscussions` — ongoing topics (auto-linked if exactly one active)
- `codegraph` — `{ built: true/false, nodes, edges, communities }`

Then:
- `codegraph.built: true` → use `codegraph_query` before reading any files
- `codegraph.built: false` → call `codegraph_build(path)` first, then proceed

---

## When to Auto-Save Context

### Always save — no user prompt needed

**1. After graph build or rebuild**
Every time `codegraph_build` completes successfully, immediately call:
```
context.save  project: "<project>"  type: "architecture"  title: "ContextGraph built — <project>"
content: "nodes: X | edges: Y | communities: Z | built: <timestamp>"
```

**2. When user explicitly asks**
Any phrase like "save this", "remember this", "note that", "log this" → `context.save` immediately with whatever was just discussed.

**3. During plan / implementation / discussion / research — save when something valuable happens**
Only save if the moment is genuinely worth keeping across sessions:
- A decision was made and agreed on (approach, library, pattern, architecture)
- A bug was found with its root cause identified, or fixed
- An important discovery (gotcha, constraint, non-obvious behavior, env requirement)
- A significant milestone reached (feature complete, refactor done, plan finalized)
- Something that would save future-you from re-learning it

Do NOT save for: routine file reads, search results, explanations of existing code, temporary debugging steps that led nowhere.

| What happened | Type |
|--------------|------|
| Approach / library / pattern decided | `decision` |
| Bug found (root cause known) or fixed | `bug` |
| System structure understood | `architecture` |
| Gotcha, constraint, non-obvious behavior | `note` |
| Config / env var / secret key discovered | `config` |
| External API or service integration learned | `note` |
| Performance insight (why something is slow/fast) | `note` |
| How to run tests / test pattern discovered | `note` |
| Deploy / release step discovered | `note` |
| Milestone / feature / task completed | `note` |

Always pass `project`. Feature spans multiple sessions → `discussion.create` or `discussion.update`. Need past info → `search` before asking user. Auto-compact fires at >20 entries.

---

## ContextGraph Pipeline

> Also called **CodeGraph**. MCP tools use the `codegraph_*` prefix — both names mean the same thing.

### Build (once per project, ~seconds, local)
```
codegraph_build(path)
```
Parses codebase into AST graph via tree-sitter. Extracts functions, classes, imports, call edges for 16+ languages. Build files get a single metadata node. Saved to `~/.context-mcp/graphs.json`.

### Query (free, instant, forever)
```
codegraph_query(path, question?, node?)  → structural question OR single-node lookup (or both in one call)
codegraph_path(path, from, to)           → shortest path between two concepts
codegraph_nodes(path, type)       → list all nodes of a type
codegraph_report(path)            → god nodes, clusters, surprises
```

---

## Graph vs File

**Graph** — what exists: finding functions, classes, files, dependencies, callers, imports, paths between concepts.

**File** — bugs, logic inside a specific function, tracing unexpected behavior.

---

## Rules

1. **`context.resume` first** — before any tool or response
2. **Always pass `project`** — never save to global unless truly cross-project
3. **`search` before asking** — if user references past work, find it first
4. **`codegraph_query` before reading files** — graph is faster and cheaper
5. **Read files for bugs/logic only** — graph is structure, not behavior
