# Context-MCP — Windsurf Usage Guide

Persistent memory + codebase knowledge graph.
`context.resume` starts every session. `codegraph_arch` shows module structure. `codegraph_query` finds specific symbols. Files only for bugs/logic.

---

## 1. Start of Every Conversation (MANDATORY)

Call `context` tool: `action:"resume"`, `project:"<name>"` before anything else.

Returns: `recentEntries`, `activePlans`, `codegraph`, `stats.totalEntries`.

- `codegraph.built: false` → run `codegraph_build(path)` first
- `stats.totalEntries ≥ 20` → write compaction summary first (see Rule 4)
- `activePlans` non-empty → read before starting new work

---

## 2. Save Triggers (MANDATORY)

Call `context.save` with `type: "note"` after finishing anything worth keeping:

| Trigger | Required fields |
|---|---|
| Task / fix / feature complete | title, why, outcome, files[] |
| Decision made | title, why, outcome |
| Discovery / constraint / gotcha | title, content |
| Config / env / deploy info | title, content |
| Graph build complete | title, content (nodes/edges count) |
| User says "save this" | title, content |
| "compact now" / "compress memory" | `type:"compaction"`, full session summary |

**Do NOT save:** routine reads, search results, explanations of existing code.

---

## 3. Plans

Call `plan.save` before any work touching 2+ files or multiple steps.
Call `plan.update status:"done"` when complete — deletes the plan.
Check `activePlans` on resume — don't duplicate.

---

## 4. Auto-Summary at ≥ 20 Entries (MANDATORY)

When `totalEntries ≥ 20`, call `context.save` BEFORE the user's task:

```
type: "compaction"  title: "Session summary — <date>"
content: "<what was built, decided, broke, current state>"
project: "<project>"
```

---

## 5. Search Before Asking

Call `search` before asking user to re-explain past work.

---

## 6. ContextGraph Tools

```
codegraph_arch(path)                   → module map (files, exports, imports)
codegraph_query(path, ...)             → find specific function/class/file
codegraph_nodes(path, type)            → list all nodes of a type (class|function|module|file|struct|table)
codegraph_report(path)                 → structural analysis, god nodes, clusters
codegraph_affected(path, node, depth?) → blast radius — what breaks if X changes?
codegraph_html(path, formats?)         → regenerate visualizations (auto on every build)
get_symbol_detail(name, path)          → source code for one function/class — no full file read
tool_registry()                        → which tools have side effects + approval requirements
safety_policy()                        → which actions need user confirmation
```

Decision rules:
- **Unknown codebase**: `codegraph_report` first
- **"Where is X?"**: `codegraph_query node:"X"`
- **Before any refactor**: `codegraph_affected node:"X"` — FIRST
- **"Show me function X"**: `get_symbol_detail` — avoids full file read
- **List all classes**: `codegraph_nodes type:"class"`
- **`search`** finds past decisions. **`codegraph_query`** finds code. Different tools.

Never read files for structure questions.

---

## 7. Rules

1. `context.resume` first — every conversation
2. Save on task complete — `why` + `outcome` + `files`
3. Compaction at ≥ 20 entries — before starting task
4. Plan for 2+ file changes — `status:"done"` deletes it
5. Search before asking about past work
6. Graph tools before files
