# Context-MCP — Codex CLI Usage Guide

Persistent memory + codebase knowledge graph.
Every conversation starts with `context.resume`. Every codebase question uses `codegraph_query`. Files only read for bugs/logic.

---

## 1. Start of Every Conversation (MANDATORY)

Call the `context` MCP tool with `action: "resume"`, `project: "<project-name>"` **before anything else**.

Returns:
- `recentEntries` — decisions, bugs, notes from previous conversations
- `activeDiscussions` — ongoing topics
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
| Feature spans sessions | `discussion.save` status: `"active"` |
| Need past info | `search` before asking user |

Always pass `project`. Auto-compact fires at >50 entries.

---

## 3. CodeGraph Pipeline

### Step 1 — Build (once, fast, local)
```
codegraph_build(path)  →  AST graph: functions, classes, imports, edges
```

### Step 2 — Query (free, instant)
```
codegraph_query(path, question)   →  fetch any details about the codebase
codegraph_explain(path, node)     →  single node: type, file, connections
codegraph_path(path, from, to)    →  shortest path
codegraph_nodes(path, type)       →  list nodes by type
codegraph_report(path)            →  full graph analysis
```

---

## 4. Graph vs File

**Graph** — use for any question about what exists: finding functions, classes, files, dependencies, callers, imports, paths between concepts.
**File** — bugs, logic, tracing unexpected behavior.

---

## 5. Rules

1. **`context.resume` first** — before any tool or response
2. **Always pass `project`**
3. **`search` before asking** — if user references past work
4. **`codegraph_query` before reading files** — graph is faster and cheaper
5. **Read files for bugs/logic only**
