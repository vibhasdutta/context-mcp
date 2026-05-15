"""
graph/builder.py — build a NetworkX directed graph from extracted nodes.

Node attributes: id, name, type, file, line, community
Edge attributes: relation, confidence (EXTRACTED | INFERRED | AMBIGUOUS)
"""

import json
from pathlib import Path

try:
    import networkx as nx
    _HAS_NX = True
except ImportError:
    _HAS_NX = False


def build(all_nodes: list[dict]) -> "nx.DiGraph | dict":
    """
    Build graph from flat node list. Returns nx.DiGraph or plain dict fallback.
    Edges are created from node.imports[] and node.calls[] fields.
    """
    if not _HAS_NX:
        return _dict_graph(all_nodes)

    G = nx.DiGraph()

    node_by_name: dict[str, str] = {}    # name -> id
    module_by_file: dict[str, str] = {}  # rel_path -> module node id

    for node in all_nodes:
        nid = node.get("id", "")
        if not nid:
            continue
        G.add_node(nid, **{k: v for k, v in node.items() if k not in ("imports", "calls", "relations")})
        node_by_name[node.get("name", "")] = nid
        if node.get("type") == "module":
            module_by_file[node.get("file", "")] = nid

    # Build file-path lookup from module nodes
    file_node: dict[str, str] = {}
    for rel_path, mod_id in module_by_file.items():
        p = rel_path.replace("\\", "/")
        stem = p.split("/")[-1].split(".")[0]
        base = p.split("/")[-1]
        for key in (stem, base, p):
            file_node.setdefault(key, mod_id)

    # defined-in edges: child nodes → their module
    for node in all_nodes:
        nid = node.get("id", "")
        for rel in node.get("relations", []):
            target_id = rel.get("id") or node_by_name.get(rel.get("name", ""))
            if target_id and target_id != nid:
                G.add_edge(nid, target_id,
                           relation=rel.get("relation", "relates-to"),
                           confidence=rel.get("confidence", "EXTRACTED"))

    # Import edges: module → module
    seen_edges: set[tuple] = set()
    for node in all_nodes:
        if node.get("type") != "module":
            continue
        src_id = node.get("id", "")
        for imp in node.get("imports", []):
            clean = imp.lstrip(".")
            parts = clean.replace("\\", "/").split("/")
            last  = parts[-1]
            stem  = last.split(".")[0]
            for c in (clean, last, stem):
                if not c:
                    continue
                target = file_node.get(c) or node_by_name.get(c)
                if target and target != src_id:
                    key = (src_id, target)
                    if key not in seen_edges:
                        seen_edges.add(key)
                        G.add_edge(src_id, target, relation="imports", confidence="EXTRACTED")
                    break

    # Edges from explicit relations (concept nodes from LLM)
    for node in all_nodes:
        nid = node.get("id", "")
        for rel in node.get("relations", []):
            target_id = rel.get("id") or node_by_name.get(rel.get("name", ""))
            if target_id and target_id != nid:
                G.add_edge(nid, target_id,
                           relation=rel.get("relation", "relates-to"),
                           confidence=rel.get("confidence", "INFERRED"))

    return G


def _dict_graph(all_nodes: list[dict]) -> dict:
    """Fallback when networkx not installed."""
    nodes = []
    edges = []
    seen = set()
    for node in all_nodes:
        nid = node.get("id", "")
        if nid in seen:
            continue
        seen.add(nid)
        nodes.append({k: v for k, v in node.items() if k not in ("imports", "calls", "relations")})
        for imp in node.get("imports", []):
            edges.append({"from": nid, "to": imp, "relation": "imports", "confidence": "EXTRACTED"})
    return {"nodes": nodes, "edges": edges, "communities": [], "god_nodes": []}


def to_json_dict(G) -> dict:
    """Serialize graph to the graph.json schema."""
    if isinstance(G, dict):
        return G  # fallback path

    nodes = [{"id": nid, **data} for nid, data in G.nodes(data=True)]
    edges = [{"from": u, "to": v, **data} for u, v, data in G.edges(data=True)]

    # God nodes = highest degree
    degrees = sorted(G.degree(), key=lambda x: x[1], reverse=True)
    god_nodes = [n for n, d in degrees[:5] if d > 2]

    return {
        "nodes": nodes,
        "edges": edges,
        "communities": G.graph.get("communities", []),
        "god_nodes": god_nodes,
        "generated_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
    }


def save_graph(project_root: str, graph_dict: dict) -> str:
    out = Path(project_root) / "codegraph-cache" / "graph.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(graph_dict, indent=2), encoding="utf-8")
    return str(out)


def load_graph(project_root: str) -> dict | None:
    p = Path(project_root) / "codegraph-cache" / "graph.json"
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None
