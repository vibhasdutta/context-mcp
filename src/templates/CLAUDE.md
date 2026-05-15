---
name: context-mcp
description: >
  Guides Claude on using the context-mcp memory + knowledge graph system.
  Trigger at the start of every conversation, when the user mentions a project,
  asks to remember/save something, or says "pick up where we left off".
---

# Context-MCP — Claude Usage Guide

Persistent memory + codebase knowledge graph for Claude.
Every conversation starts with `context.resume`. Every structural question uses `codegraph_query`. Files only read for bugs/logic.

---

## 1. Start of Every Conversation (MANDATORY)

Call `context` tool, `action: "resume"`, `project: "<project-name>"` **before anything else**.

Returns:
- `recentEntries` — decisions, bugs, notes from previous conversations
- `activeDiscussions` — ongoing topics (auto-linked if exactly one active)
- `codegraph` — `{ built: true/false, nodes, edges, communities }`

Then:
- `codegraph.built: true` → use `codegraph_query` before reading any files
- `codegraph.built: false` → call `codegraph_build(path)` first, then proceed

---

## 2. During the Conversation

| Situation | Action |
|-----------|--------|
| Decision made | `context.save` type: `"decision"` |
| Bug found/fixed | `context.save` type: `"bug"` |
| Architecture understood | `context.save` type: `"architecture"` |
| User says "save/remember this" | `context.save` immediately |
| Feature spans multiple conversations | `discussion.create` or `discussion.update` |
| Need past info | `search` before asking user |

Always pass `project`. Auto-compact fires at >50 entries — oldest summarized automatically.

---

## 3. CodeGraph Pipeline

### Step 1 — Build (once per project, free)
```
codegraph_build(path)
  → AST: code files → functions, classes, imports, edges
  → Config: .yaml .toml .sql → schema nodes
  → Docs: .md .txt .pdf → pending (no content yet)
```
Saves graph to `~/.context-mcp/graphs.json`. Visible on `context.resume`.

### Step 2 — Enrich (one-time cost per file)
```
codegraph_extract(path)
  → returns changed code files (with existing node list) + doc files (raw text)

For each code file: write description for each node listed in existing_nodes
For each doc file:  extract concept nodes + relationships

codegraph_add_nodes(path, nodes)
  → stores descriptions in semantic cache (never overwritten by rebuild)
```

### Step 3 — Query (free, instant forever)
```
codegraph_query(path, question)   → NODE/EDGE subgraph, token_budget param (default 2000)
codegraph_explain(path, node)     → one node: description + depends_on + used_by
codegraph_path(path, from, to)    → shortest path between two concepts
codegraph_nodes(path, type)       → list all nodes of a type
codegraph_report(path)            → god nodes, clusters, surprises
```

---

## 4. Graph vs File

**Graph** — structural questions: dependencies, callers, imports, paths between concepts.
**File** — bugs, logic inside a function, tracing unexpected behavior.

---

## 5. Rules

1. **`context.resume` first** — before any tool or response
2. **Always pass `project`** — never save to global unless truly cross-project
3. **`search` before asking** — if user references past work, find it first
4. **`codegraph_query` before reading files** — graph is faster and cheaper
5. **Read files for bugs/logic** — graph is structure only, not behavior
6. **Enrich once** — run extract → add_nodes once per project; descriptions persist forever
