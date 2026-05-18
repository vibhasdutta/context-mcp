# Context-MCP — Gemini CLI Usage Guide

Persistent memory + codebase knowledge graph.
Every conversation starts with `context.resume`. Every codebase question uses `codegraph_query`. Files only read for bugs/logic.

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

## 2. When to Auto-Save Context

**After graph build or rebuild** — every time `codegraph_build` completes:
```
context.save  type: "architecture"  title: "ContextGraph built — <project>"
content: "nodes: X | edges: Y | communities: Z"
```

**User explicitly asks** — "save this", "remember this", "note that" → save immediately.

**During plan / implementation / discussion / research** — save only when genuinely valuable:

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

Do NOT save: routine reads, search results, temporary debugging dead-ends.
Feature spans sessions → `discussion.save` then `discussion.update`.
Need past info → `search` before asking. Always pass `project`.

---

## 3. ContextGraph Pipeline

> The knowledge graph is also called **ContextGraph**. The MCP tools use the `codegraph_*` prefix — both names refer to the same thing.

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
2. **Always pass `project`** — never save to global unless truly cross-project
3. **`search` before asking** — if user references past work, find it first
4. **`codegraph_query` before reading files** — graph is faster and cheaper
5. **Read files for bugs/logic** — graph is structure only, not behavior
