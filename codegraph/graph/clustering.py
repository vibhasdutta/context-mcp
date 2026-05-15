"""
graph/clustering.py — community detection using NetworkX connected-components.
No external deps beyond networkx (already required).
"""


def detect_communities(G) -> list[dict]:
    """Assign community IDs to graph nodes. Returns list of community dicts."""
    try:
        import networkx as nx
    except ImportError:
        return []

    if G.number_of_nodes() == 0:
        return []

    undirected = G.to_undirected()
    communities = []
    for comm_id, component in enumerate(nx.connected_components(undirected)):
        member_ids = list(component)
        label = _community_label(G, member_ids)
        communities.append({"id": comm_id, "label": label, "members": member_ids})
        for nid in member_ids:
            if G.has_node(nid):
                G.nodes[nid]["community"] = comm_id

    G.graph["communities"] = communities
    return communities


def _community_label(G, member_ids: list) -> str:
    files = []
    for nid in member_ids:
        if G.has_node(nid):
            f = G.nodes[nid].get("file", "")
            if f:
                files.append(f.split("/")[0])
    if not files:
        return "misc"
    return max(set(files), key=files.count)
