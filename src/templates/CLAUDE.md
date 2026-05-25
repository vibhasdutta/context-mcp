---
name: context-mcp
description: >
  Guides Claude on using the context-mcp memory + knowledge graph system.
  Trigger at the start of every conversation, when the user mentions a project,
  asks to remember/save something, or says "pick up where we left off".
---

# Context-MCP — Claude Usage Guide

Persistent memory + codebase knowledge graph for Claude.
Every conversation starts with `context.resume`. Every codebase question uses `codegraph_query`. Files only read for bugs/logic.

---

## 1. Start of Every Conversation (MANDATORY)

Call `context` tool **before anything else** with:
- `action: "resume"`
- `project: "<basename of git repo root dir>"` — infer from cwd if not stated
- `rootPath: "<absolute path to git repo root>"` — required for sandbox + graph lookup

Both fields are required: `project` names the memory bucket, `rootPath` enables exact graph matching and file sandboxing.

Returns:
- `recentEntries` — decisions, bugs, notes from previous conversations
- `activePlans` — active AI-created plans for this project
- `codegraph` — `{ built: true/false, nodes, edges, communities }`

Then:
- `codegraph.built: true` → use `codegraph_query` before reading any files
- `codegraph.built: false` → call `codegraph_build(path)` first, then proceed

---

## 2. When to Auto-Save Context

### Always save — no user prompt needed

**After graph build or rebuild** — every time `codegraph_build` completes:
```
context.save  project: "<project>"  type: "note"  title: "ContextGraph built — <project>"
content: "nodes: X | edges: Y | communities: Z"
```

**User explicitly asks** — any phrase like "save this", "remember this", "note that" → save immediately.

**During plan / implementation / discussion / research** — save only when genuinely valuable:

| What happened | Type |
|--------------|------|
| Approach / library / pattern decided | `decision` |
| Bug found, root cause known, or fixed | `bug` |
| Gotcha, constraint, discovery, structure understood | `note` |
| Config / env var / secret / deploy step | `config` |

Do NOT save: routine reads, search results, temporary debugging dead-ends.

**Making any kind of plan** → call `plan.save` immediately with the plan summary and `planDir` pointing to your platform's plans folder.
Need past info → `search` before asking user.
Always pass `project`. Auto-compact fires at >20 entries.

---

## 3. ContextGraph Pipeline

> The knowledge graph is also called **ContextGraph**. The MCP tools use the `codegraph_*` prefix — both names refer to the same thing.

### Step 1 — Build (once per project, fast, local)
```
codegraph_build(path)
```
- Parses codebase into AST graph using tree-sitter (regex fallback for unsupported languages)
- Extracts functions, classes, imports, call edges for all code files
- Build files (package.json, pyproject.toml, go.mod, Dockerfile, etc.) get a single metadata node
- Saves graph to `~/.context-mcp/graphs.json`. Visible on `context.resume`.

### Step 2 — Query (free, instant, forever)
```
codegraph_query(path, question)     → fetch any details about the codebase
codegraph_explain(path, node)       → one node: type, file, depends_on, used_by
codegraph_path(path, from, to)      → shortest path between two concepts
codegraph_nodes(path, type)         → list all nodes of a type
codegraph_report(path)              → god nodes, clusters, surprises
```

---

## 4. Graph vs File

**Graph** — use for any question about what exists in the codebase: finding functions, classes, files, understanding what a module contains, dependencies, callers, imports, paths between concepts.

**File** — use for bugs, logic inside a specific function, tracing unexpected behavior.

---

## 5. Rules

1. **`context.resume` first** — before any tool or response
2. **Always pass `project`** — never save to global unless truly cross-project
3. **`search` before asking** — if user references past work, find it first
4. **`codegraph_query` before reading files** — graph is faster and cheaper
5. **Read files for bugs/logic** — graph is structure only, not behavior
