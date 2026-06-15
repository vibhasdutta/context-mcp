"""
graph/query.py — natural language graph traversal for codegraph_query.

No LLM call on query — pure graph + keyword matching.
"""

import re
from collections import deque
from typing import Any


def answer(question: str, graph_dict: dict, token_budget: int = 2000) -> dict:
    """
    Answer a natural language question about the codebase using graph traversal.

    Returns { answer, nodes, confidence, tokens_used }
    Output is truncated to token_budget (approx 4 chars = 1 token).
    """
    nodes = graph_dict.get("nodes", [])
    edges = graph_dict.get("edges", [])
    communities = graph_dict.get("communities", [])
    god_nodes = graph_dict.get("god_nodes", [])

    q_lower = question.lower()
    terms = _extract_terms(q_lower)

    # 1. Find relevant nodes by name/file match
    matched = _match_nodes(nodes, terms)

    # 2. Detect query intent
    intent = _detect_intent(q_lower)

    if intent == "depends_on" and matched:
        result = _depends_on(matched[0], edges, nodes)
    elif intent == "used_by" and matched:
        result = _used_by(matched[0], edges, nodes)
    elif intent == "path" and len(matched) >= 2:
        result = _shortest_path(matched[0], matched[1], edges, nodes)
    elif intent == "list":
        result = _list_nodes(nodes, terms)
    elif intent == "god_nodes":
        result = _describe_god_nodes(god_nodes, nodes)
    elif intent == "community" and matched:
        result = _describe_community(matched[0], communities, nodes)
    elif intent == "circular":
        result = _circular_imports(graph_dict)
    else:
        result = _general_search(matched, nodes, edges)

    # Render subgraph as structured text, truncated to token_budget
    subgraph_text = _render_subgraph(result.get("nodes", []), edges, token_budget)
    answer_text = result.get("text", "No answer found.")
    if subgraph_text:
        answer_text = f"{answer_text}\n\n{subgraph_text}"

    # Truncate to budget (4 chars ≈ 1 token)
    char_limit = token_budget * 4
    truncated = len(answer_text) > char_limit
    if truncated:
        answer_text = answer_text[:char_limit] + "\n…(truncated to token budget)"

    return {
        "question":   question,
        "answer":     answer_text,
        "nodes":      result.get("nodes", []),
        "confidence": result.get("confidence", "low"),
        "tokens_used": len(answer_text) // 4,
        "truncated":  truncated,
    }


def find_path(from_name: str, to_name: str, graph_dict: dict) -> dict:
    """Find shortest relationship path between two concepts."""
    nodes = graph_dict.get("nodes", [])
    edges = graph_dict.get("edges", [])
    from_node = _find_by_name(nodes, from_name)
    to_node   = _find_by_name(nodes, to_name)
    if not from_node or not to_node:
        return {"path": [], "found": False, "message": f"Could not find '{from_name}' or '{to_name}' in graph."}
    result = _shortest_path(from_node, to_node, edges, nodes)
    return {"path": result.get("nodes", []), "found": bool(result.get("nodes")), "text": result.get("text", "")}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _extract_terms(q: str) -> list[str]:
    stop = {"what", "does", "how", "where", "is", "the", "a", "an", "to", "do",
            "does", "which", "files", "modules", "functions", "classes", "list",
            "show", "find", "get", "all", "me", "about"}
    return [w for w in re.findall(r"\w+", q) if w not in stop and len(w) > 2]


def _match_nodes(nodes: list, terms: list) -> list:
    scored = []
    for n in nodes:
        name  = (n.get("name", "") or "").lower()
        fpath = (n.get("file", "") or "").lower()
        score = sum(1 for t in terms if t in name or t in fpath)
        if score:
            scored.append((score, n))
    scored.sort(key=lambda x: -x[0])
    return [n for _, n in scored]


def _find_by_name(nodes: list, name: str) -> dict | None:
    name_l = name.lower()
    for n in nodes:
        if (n.get("name", "") or "").lower() == name_l:
            return n
    # partial match
    for n in nodes:
        if name_l in (n.get("name", "") or "").lower():
            return n
    return None


def _detect_intent(q: str) -> str:
    if any(w in q for w in ("used by", "who calls", "caller")):
        return "used_by"
    if any(w in q for w in ("depend", "import", "use", "require")):
        return "depends_on"
    if any(w in q for w in ("path", "connect", "relate", "between")):
        return "path"
    if any(w in q for w in ("list", "all", "show all", "every")):
        return "list"
    if any(w in q for w in ("god", "central", "most connected", "hub")):
        return "god_nodes"
    if any(w in q for w in ("community", "cluster", "group", "module")):
        return "community"
    if any(w in q for w in ("circular", "cycle", "cyclic", "recursive import")):
        return "circular"
    return "general"


def _depends_on(node: dict, edges: list, nodes: list) -> dict:
    nid = node["id"]
    targets = [e["to"] for e in edges if e["from"] == nid]
    target_nodes = [n for n in nodes if n["id"] in targets]
    names = [n["name"] for n in target_nodes]
    return {
        "text": f"{node['name']} depends on: {', '.join(names) or 'nothing found'}.",
        "nodes": [node] + target_nodes,
        "confidence": "high" if targets else "low",
    }


def _used_by(node: dict, edges: list, nodes: list) -> dict:
    nid = node["id"]
    sources = [e["from"] for e in edges if e["to"] == nid]
    source_nodes = [n for n in nodes if n["id"] in sources]
    names = [n["name"] for n in source_nodes]
    return {
        "text": f"{node['name']} is used by: {', '.join(names) or 'nothing found'}.",
        "nodes": [node] + source_nodes,
        "confidence": "high" if sources else "low",
    }


def _shortest_path(from_node: dict, to_node: dict, edges: list, nodes: list) -> dict:
    # BFS
    adj: dict[str, list[str]] = {}
    for e in edges:
        adj.setdefault(e["from"], []).append(e["to"])
        adj.setdefault(e["to"], []).append(e["from"])  # undirected for path finding

    start, end = from_node["id"], to_node["id"]
    visited = {start: None}
    queue: deque[str] = deque([start])
    while queue:
        cur = queue.popleft()
        if cur == end:
            break
        for nb in adj.get(cur, []):
            if nb not in visited:
                visited[nb] = cur
                queue.append(nb)

    if end not in visited:
        return {"text": f"No path found between {from_node['name']} and {to_node['name']}.", "nodes": []}

    path_ids = []
    cur = end
    while cur:
        path_ids.append(cur)
        cur = visited[cur]
    path_ids.reverse()

    node_map = {n["id"]: n for n in nodes}
    path_nodes = [node_map[i] for i in path_ids if i in node_map]
    names = [n["name"] for n in path_nodes]
    return {
        "text": f"Path: {' → '.join(names)}",
        "nodes": path_nodes,
        "confidence": "medium",
    }


def _list_nodes(nodes: list, terms: list) -> dict:
    matched = _match_nodes(nodes, terms) if terms else nodes[:20]
    names = [f"{n['name']} ({n.get('type','?')} in {n.get('file','?')})" for n in matched[:20]]
    return {
        "text": "\n".join(names) or "No matching nodes.",
        "nodes": matched[:20],
        "confidence": "medium",
    }


def _describe_god_nodes(god_node_ids: list, nodes: list) -> dict:
    node_map = {n["id"]: n for n in nodes}
    god = [node_map[i] for i in god_node_ids if i in node_map]
    names = [f"{n['name']} ({n.get('file','')})" for n in god]
    return {
        "text": f"God nodes (highest connectivity): {', '.join(names) or 'none identified'}.",
        "nodes": god,
        "confidence": "high",
    }


def _describe_community(node: dict, communities: list, nodes: list) -> dict:
    comm_id = node.get("community")
    comm = next((c for c in communities if c["id"] == comm_id), None)
    if not comm:
        return {"text": f"{node['name']} has no community assignment.", "nodes": [node], "confidence": "low"}
    node_map = {n["id"]: n for n in nodes}
    members = [node_map[m] for m in comm["members"] if m in node_map]
    return {
        "text": f"{node['name']} is in community '{comm['label']}' with {len(members)} members.",
        "nodes": members[:10],
        "confidence": "high",
    }


def _circular_imports(graph_dict: dict) -> dict:
    """Find circular import chains using iterative DFS on import edges."""
    edges = graph_dict.get("edges", [])
    nodes = graph_dict.get("nodes", [])
    node_map = {n["id"]: n for n in nodes}

    adj: dict[str, list[str]] = {}
    for e in edges:
        if e.get("relation") in ("imports", "imports_from"):
            adj.setdefault(e["from"], []).append(e["to"])

    cycles: list[list[str]] = []
    visited: set[str] = set()

    def dfs(start: str) -> None:
        stack = [(start, [start], {start})]
        while stack and len(cycles) < 5:
            node, path, path_set = stack.pop()
            for nb in adj.get(node, []):
                if nb in path_set:
                    cycle_start = path.index(nb)
                    cycles.append(path[cycle_start:] + [nb])
                    if len(cycles) >= 5:
                        return
                elif nb not in visited:
                    visited.add(nb)
                    stack.append((nb, path + [nb], path_set | {nb}))

    for nid in list(adj.keys()):
        if nid not in visited:
            visited.add(nid)
            dfs(nid)
        if len(cycles) >= 5:
            break

    if not cycles:
        return {"text": "No circular imports detected.", "nodes": [], "confidence": "high"}

    cycle_node_ids: list[str] = []
    lines = [f"Found {len(cycles)} circular import chain(s):"]
    for cycle in cycles[:5]:
        names = [node_map.get(nid, {}).get("name", nid) for nid in cycle]
        lines.append(f"  {' → '.join(names)}")
        cycle_node_ids.extend(nid for nid in cycle if nid in node_map)

    return {
        "text":       "\n".join(lines),
        "nodes":      [node_map[nid] for nid in dict.fromkeys(cycle_node_ids)][:20],
        "confidence": "high",
    }


def _general_search(matched: list, nodes: list, edges: list) -> dict:
    if not matched:
        return {"text": "No matching nodes found.", "nodes": [], "confidence": "low"}
    top = matched[:5]
    lines = [f"• {n['name']} ({n.get('type','?')}) in {n.get('file','?')} line {n.get('line','?')}" for n in top]
    return {
        "text": "\n".join(lines),
        "nodes": top,
        "confidence": "medium",
    }


def module_map(graph_dict: dict, limit: int = 100) -> dict:
    """
    Return a module map: for each file, its exported functions/classes and what it imports.
    Output grouped by file, sorted by export count descending.
    """
    nodes = graph_dict.get("nodes", [])
    edges = graph_dict.get("edges", [])

    files: dict[str, dict] = {}
    for n in nodes:
        f = n.get("file") or "unknown"
        if f not in files:
            files[f] = {"exports": [], "imports": set()}
        node_type = n.get("type", "?")
        if node_type in ("function", "class", "struct"):
            files[f]["exports"].append({"name": n["name"], "type": node_type})

    node_map = {n["id"]: n for n in nodes}
    for e in edges:
        from_node = node_map.get(e.get("from", ""))
        to_node   = node_map.get(e.get("to", ""))
        if not from_node or not to_node:
            continue
        from_file = from_node.get("file") or "unknown"
        to_file   = to_node.get("file") or "unknown"
        if from_file != to_file and from_file in files:
            files[from_file]["imports"].add(to_file)

    result = []
    for fpath, data in sorted(files.items(), key=lambda x: -len(x[1]["exports"])):
        result.append({
            "file":    fpath,
            "exports": data["exports"][:30],
            "imports": sorted(data["imports"])[:20],
        })

    return {
        "files":       result[:limit],
        "total_files": len(files),
        "truncated":   len(files) > limit,
    }


def _render_subgraph(result_nodes: list, all_edges: list, token_budget: int) -> str:
    """
    Render a subgraph as structured plain text (graphify-style).
    Format:
      NODE  name  [type]  src=file  desc=...
      EDGE  from → to  [relation]
    Sorted by degree descending. Truncated to token_budget.
    """
    if not result_nodes:
        return ""

    node_ids = {n["id"] for n in result_nodes}
    # Degree within subgraph
    degree: dict[str, int] = {n["id"]: 0 for n in result_nodes}
    subedges = []
    for e in all_edges:
        if e.get("from") in node_ids and e.get("to") in node_ids:
            subedges.append(e)
            degree[e["from"]] = degree.get(e["from"], 0) + 1
            degree[e["to"]]   = degree.get(e["to"],   0) + 1

    sorted_nodes = sorted(result_nodes, key=lambda n: -degree.get(n["id"], 0))

    char_limit = token_budget * 4
    lines = []
    chars = 0

    for n in sorted_nodes:
        desc = n.get("description", "")
        desc_part = f"  desc={desc[:80]}" if desc else ""
        line = f"NODE  {n.get('name','?')}  [{n.get('type','?')}]  src={n.get('file','?')}{desc_part}"
        if chars + len(line) > char_limit:
            break
        lines.append(line)
        chars += len(line)

    for e in subedges:
        line = f"EDGE  {e.get('from','')} → {e.get('to','')}  [{e.get('relation','?')}]"
        if chars + len(line) > char_limit:
            break
        lines.append(line)
        chars += len(line)

    return "\n".join(lines)
