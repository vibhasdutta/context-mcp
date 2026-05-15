# Context-MCP — Gemini CLI Usage Guide

Persistent memory + codebase knowledge graph.
Every conversation starts with `context.resume`. Every structural question uses `codegraph_query`. Files only read for bugs/logic.

---

## 1. Start of Every Conversation (MANDATORY)

Call the `context` MCP tool with `action: "resume"`, `project: "<project-name>"` **before anything else**.

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
| Feature spans sessions | `discussion.save` then `discussion.update` |
| Need past info | `search` before asking user |

Always pass `project`. Auto-compact fires at >50 entries.

---

## 3. CodeGraph Pipeline

### Step 1 — Build (once, free)
```
codegraph_build(path)  →  AST graph: functions, classes, imports, edges
```

### Step 2 — Enrich (one-time per file)
```
codegraph_extract(path)           →  file content + node list
codegraph_add_nodes(path, nodes)  →  semantic descriptions (permanent cache)
```

### Step 3 — Query (free, instant)
```
codegraph_query(path, question)   →  NODE/EDGE subgraph (token_budget default 2000)
codegraph_explain(path, node)     →  single node + neighbors
codegraph_path(path, from, to)    →  shortest path
codegraph_nodes(path, type)       →  list nodes by type
codegraph_report(path)            →  full graph analysis
```

---

## 4. Graph vs File

**Graph** — structural questions: dependencies, callers, imports.
**File** — bugs, logic, tracing behavior.

---

## 5. Rules

1. **`context.resume` first** — before any tool or response
2. **Always pass `project`** — never save to global unless truly cross-project
3. **`search` before asking** — if user references past work, find it first
4. **`codegraph_query` before reading files** — graph is faster and cheaper
5. **Read files for bugs/logic** — graph is structure only, not behavior
6. **Enrich once** — descriptions persist forever
