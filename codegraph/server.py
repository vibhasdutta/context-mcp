#!/usr/bin/env python3
"""
codegraph/server.py — MCP server exposing codebase knowledge graph tools.

Tools:
  codegraph_build      — scan project, extract AST nodes, build graph (local only, no API)
  codegraph_extract    — return raw doc content for the AI to read and extract concepts from
  codegraph_add_nodes  — AI pushes extracted concept nodes back into the graph
  codegraph_query      — natural language question → graph traversal answer
  codegraph_report     — return full CODEGRAPH_REPORT.md
  codegraph_nodes      — list nodes of a given type
  codegraph_path       — shortest path between two concepts
"""

import asyncio
import json
import os
import time
from pathlib import Path

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

from .scanner import scan, classify_file
from .cache import file_hash, set_cached_nodes, save_cache, save_semantic_cache
from .extractors.ast_extractor import extract as ast_extract
from .extractors.doc_extractor import extract_text
from .graph.builder import build, to_json_dict, save_graph, load_graph
from .graph.query import answer as graph_answer, find_path
from .graph.clustering import detect_communities
from .report import generate as generate_report

app = Server("codegraph")


# ── Tool definitions ──────────────────────────────────────────────────────────

TOOLS = [
    Tool(
        name="codegraph_build",
        description=(
            "Scan a project directory and build the knowledge graph from code files. "
            "Uses AST extraction (with regex fallback) for all code files. "
            "Fast, local, no API key needed. "
            "For docs and images, call codegraph_extract afterward — the AI reads and extracts concepts, "
            "then calls codegraph_add_nodes to push them into the graph."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "path":    {"type": "string", "description": "Absolute path to project root"},
                "cluster": {"type": "boolean", "description": "Run community detection after build (default true)"},
            },
            "required": ["path"],
        },
    ),
    Tool(
        name="codegraph_extract",
        description=(
            "Return raw content of changed doc files so the AI can read them and extract concepts. "
            "Call this after codegraph_build. Read the returned files, extract key concepts and "
            "relationships, then call codegraph_add_nodes with your findings. "
            "Works with any AI — no API key required."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "path":  {"type": "string", "description": "Project root (same as codegraph_build)"},
                "limit": {"type": "integer", "description": "Max files to return per call (default 10)"},
            },
            "required": ["path"],
        },
    ),
    Tool(
        name="codegraph_add_nodes",
        description=(
            "Add concept nodes extracted by the AI into the graph. "
            "Call this after reading the output of codegraph_extract. "
            "Each node should have: name, type, file, and optionally description and relations."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "path":  {"type": "string", "description": "Project root"},
                "nodes": {
                    "type": "array",
                    "description": "Concept nodes to add",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name":        {"type": "string"},
                            "type":        {"type": "string", "description": "class|function|concept|service|decision|requirement"},
                            "file":        {"type": "string", "description": "Relative file path this concept came from"},
                            "description": {"type": "string"},
                            "relations":   {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "name":     {"type": "string"},
                                        "relation": {"type": "string", "description": "depends-on|uses|implements|defines|documents"},
                                    },
                                },
                            },
                        },
                        "required": ["name", "type", "file"],
                    },
                },
            },
            "required": ["path", "nodes"],
        },
    ),
    Tool(
        name="codegraph_query",
        description=(
            "Ask a structural question about the codebase. Pure graph traversal — instant, no API call. "
            "Returns structured NODE/EDGE text truncated to token_budget. "
            "Good for: dependencies, callers, module relationships. "
            "NOT for: bug investigation or understanding code logic — read the file for that."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "path":         {"type": "string", "description": "Project root"},
                "question":     {"type": "string", "description": "Natural language question"},
                "token_budget": {"type": "integer", "description": "Max tokens in response (default 2000)"},
            },
            "required": ["path", "question"],
        },
    ),
    Tool(
        name="codegraph_explain",
        description=(
            "Look up a node by name — returns description, type, file, and direct neighbors. "
            "Use to understand what a specific function/class/module does and how it connects. "
            "Descriptions are AI-written via codegraph_add_nodes."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Project root"},
                "node": {"type": "string", "description": "Node name or partial name"},
            },
            "required": ["path", "node"],
        },
    ),
    Tool(
        name="codegraph_report",
        description="Return CODEGRAPH_REPORT.md — god nodes, clusters, surprising connections, suggested questions.",
        inputSchema={
            "type": "object",
            "properties": {"path": {"type": "string"}},
            "required": ["path"],
        },
    ),
    Tool(
        name="codegraph_nodes",
        description="List all nodes of a given type in the graph.",
        inputSchema={
            "type": "object",
            "properties": {
                "path":  {"type": "string"},
                "type":  {"type": "string", "enum": ["class", "function", "module", "concept", "service", "file", "struct", "table"]},
                "limit": {"type": "integer", "description": "Max results (default 50)"},
            },
            "required": ["path", "type"],
        },
    ),
    Tool(
        name="codegraph_path",
        description="Find the shortest relationship path between two concepts in the graph.",
        inputSchema={
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "from": {"type": "string"},
                "to":   {"type": "string"},
            },
            "required": ["path", "from", "to"],
        },
    ),
]


@app.list_tools()
async def list_tools():
    return TOOLS


@app.call_tool()
async def call_tool(name: str, arguments: dict):
    try:
        result = await _dispatch(name, arguments)
        return [TextContent(type="text", text=json.dumps(result, indent=2))]
    except Exception as e:
        return [TextContent(type="text", text=json.dumps({"error": str(e)}))]


async def _dispatch(name: str, args: dict):
    if name == "codegraph_build":      return await _build(args)
    if name == "codegraph_extract":    return await _extract(args)
    if name == "codegraph_add_nodes":  return await _add_nodes(args)
    if name == "codegraph_query":      return await _query(args)
    if name == "codegraph_explain":    return await _explain(args)
    if name == "codegraph_report":     return await _report(args)
    if name == "codegraph_nodes":      return await _nodes(args)
    if name == "codegraph_path":       return await _path(args)
    raise ValueError(f"Unknown tool: {name}")


# ── Build ─────────────────────────────────────────────────────────────────────

async def _build(args: dict) -> dict:
    root       = args["path"]
    do_cluster = args.get("cluster", True)
    t0         = time.time()

    scan_result = scan(root)
    cache   = scan_result["cache"]
    cached  = scan_result["cached"]
    changed = scan_result["changed"]
    deleted = scan_result["deleted"]

    # Local AST extraction — code/sql/config files only
    all_nodes: list[dict] = []
    pending_docs: list[str] = []   # rel_paths of changed docs/images for codegraph_extract

    for nodes in cached.values():
        all_nodes.extend(nodes)

    for rel_path, abs_path in changed.items():
        cat = classify_file(abs_path)
        if cat in ("code", "sql"):
            nodes = ast_extract(abs_path, rel_path)
            set_cached_nodes(cache, rel_path, file_hash(abs_path), nodes)
            all_nodes.extend(nodes)
        elif cat == "config":
            # Label config files as a single node — don't decompose every key
            node = {"id": f"{rel_path}::file::{Path(rel_path).name}",
                    "name": Path(rel_path).name, "type": "file", "file": rel_path}
            set_cached_nodes(cache, rel_path, file_hash(abs_path), [node])
            all_nodes.append(node)
        elif cat in ("doc", "pdf"):
            pending_docs.append(rel_path)
        elif cat in ("image", "audio", "video"):
            # Label-only — node in graph so AI can reference the file, no content extraction
            node = {"id": f"{rel_path}::file::{Path(rel_path).name}",
                    "name": Path(rel_path).name, "type": "file", "file": rel_path}
            set_cached_nodes(cache, rel_path, file_hash(abs_path), [node])
            all_nodes.append(node)

    G          = build(all_nodes)
    communities = []
    if do_cluster:
        try:
            communities = detect_communities(G)
        except Exception:
            pass

    graph_dict = to_json_dict(G)
    save_graph(root, graph_dict)
    generate_report(graph_dict, root)
    save_cache(root, cache)

    elapsed_ms = int((time.time() - t0) * 1000)
    result = {
        "success":     True,
        "nodes":       len(graph_dict.get("nodes", [])),
        "edges":       len(graph_dict.get("edges", [])),
        "communities": len(communities),
        "cached":      len(cached),
        "changed":     len(changed),
        "deleted":     len(deleted),
        "time_ms":     elapsed_ms,
        "summary":     f"Built graph: {len(graph_dict.get('nodes', []))} nodes from code files.",
    }

    if pending_docs:
        result["pending_docs"] = len(pending_docs)
        result["hint"] = (
            f"{len(pending_docs)} doc/image file(s) need concept extraction. "
            "Call codegraph_extract to get their content, then codegraph_add_nodes with your findings."
        )

    return result


# ── Extract (return raw content for AI to read) ───────────────────────────────

async def _extract(args: dict) -> dict:
    root  = args["path"]
    limit = args.get("limit", 10)
    force = args.get("force", False)

    scan_result = scan(root)
    cache   = scan_result["cache"]
    scan_root = scan_result["root"]
    # force=True: return all files; otherwise only changed
    if force:
        from codegraph.scanner import walk_files, classify_file
        candidates = {
            os.path.relpath(p, scan_root).replace("\\", "/"): p
            for p in walk_files(scan_root)
            if classify_file(p) in ("doc", "code")
        }
    else:
        candidates = scan_result["changed"]

    files = []
    for rel_path, abs_path in list(candidates.items()):
        if len(files) >= limit:
            break
        cat = classify_file(abs_path)
        if cat in ("doc", "code"):
            text = extract_text(abs_path)
            if not text:
                continue
            entry: dict = {"rel_path": rel_path, "type": cat, "content": text}
            # For code files, include existing AST nodes so AI knows what to describe
            if cat == "code":
                cached_entry = cache.get(rel_path, {})
                existing_nodes = cached_entry.get("nodes", [])
                entry["existing_nodes"] = [
                    {"name": n.get("name"), "type": n.get("type")}
                    for n in existing_nodes
                ]
            files.append(entry)

    remaining = max(0, len(candidates) - limit)
    return {
        "files": files,
        "returned": len(files),
        "remaining": remaining,
        "instruction": (
            "For each file: read the content. "
            "For code files, write a description for each existing_node (name + type listed). "
            "For doc files, extract key concepts, decisions, and relationships as new nodes. "
            "Then call codegraph_add_nodes with all nodes (include description field)."
        ),
    }


# ── Add nodes (AI pushes extracted concepts in) ───────────────────────────────

async def _add_nodes(args: dict) -> dict:
    root  = args["path"]
    nodes = args.get("nodes", [])

    if not nodes:
        return {"success": False, "message": "No nodes provided."}

    graph_dict = load_graph(root) or {"nodes": [], "edges": [], "communities": [], "god_nodes": []}

    # Assign IDs and merge; update description on existing nodes
    existing_map = {n["id"]: n for n in graph_dict["nodes"]}
    added = 0
    updated = 0
    for node in nodes:
        nid = f"{node['file']}::concept::{node['name']}"
        desc = node.get("description", "")
        if nid in existing_map:
            if desc and desc != existing_map[nid].get("description", ""):
                existing_map[nid]["description"] = desc
                updated += 1
            # Still add edges below
        else:
            new_node = {
                "id":          nid,
                "name":        node["name"],
                "type":        node.get("type", "concept"),
                "file":        node["file"],
                "description": desc,
            }
            graph_dict["nodes"].append(new_node)
            existing_map[nid] = new_node
            added += 1

        # Also try to enrich AST nodes (different ID pattern: file::type::name)
        for id_pattern in [
            f"{node['file']}::{node.get('type','function')}::{node['name']}",
            f"{node['file']}::function::{node['name']}",
            f"{node['file']}::class::{node['name']}",
            f"{node['file']}::module::{node['name']}",
        ]:
            if id_pattern in existing_map and desc:
                if not existing_map[id_pattern].get("description"):
                    existing_map[id_pattern]["description"] = desc
                    updated += 1

        # Add relation edges
        for rel in node.get("relations", []):
            graph_dict["edges"].append({
                "from":     nid,
                "to":       rel["name"],
                "relation": rel.get("relation", "relates-to"),
                "confidence": "EXTRACTED",
            })

    # Persist descriptions to semantic cache (never overwritten by rebuild)
    by_file: dict = {}
    for node in nodes:
        if node.get("description"):
            by_file.setdefault(node["file"], []).append(node)
    if by_file:
        save_semantic_cache(root, by_file)

    save_graph(root, graph_dict)
    generate_report(graph_dict, root)

    return {
        "success":      True,
        "nodes_added":  added,
        "nodes_updated": updated,
        "total_nodes":  len(graph_dict["nodes"]),
        "message":      f"Added {added}, updated {updated} node description(s).",
    }


# ── Query / Report / Nodes / Path ─────────────────────────────────────────────

async def _query(args: dict) -> dict:
    graph_dict = load_graph(args["path"])
    if not graph_dict:
        raise ValueError("No graph found. Run codegraph_build first.")
    return graph_answer(args["question"], graph_dict, token_budget=args.get("token_budget", 2000))


async def _explain(args: dict) -> dict:
    graph_dict = load_graph(args["path"])
    if not graph_dict:
        raise ValueError("No graph found. Run codegraph_build first.")

    query = args["node"].lower()
    nodes = graph_dict.get("nodes", [])
    edges = graph_dict.get("edges", [])

    match = next((n for n in nodes if n.get("name", "").lower() == query), None)
    if not match:
        match = next((n for n in nodes if query in n.get("name", "").lower()), None)
    if not match:
        candidates = [n["name"] for n in nodes if query in n.get("id", "").lower()]
        return {"found": False, "query": args["node"],
                "message": f"No node matching '{args['node']}'.",
                "suggestions": candidates[:10]}

    nid = match["id"]
    depends_on, used_by = [], []
    for e in edges:
        if e.get("from") == nid:
            t = next((n for n in nodes if n.get("id") == e.get("to")), None)
            depends_on.append({"name": t["name"] if t else e["to"],
                               "file": t.get("file","") if t else "",
                               "relation": e.get("relation","→")})
        elif e.get("to") == nid:
            s = next((n for n in nodes if n.get("id") == e.get("from")), None)
            used_by.append({"name": s["name"] if s else e["from"],
                            "file": s.get("file","") if s else "",
                            "relation": e.get("relation","→")})

    return {
        "found":       True,
        "name":        match.get("name"),
        "type":        match.get("type"),
        "file":        match.get("file"),
        "description": match.get("description") or None,
        "depends_on":  depends_on[:20],
        "used_by":     used_by[:20],
        "hint": None if match.get("description") else
                "No description yet. Call codegraph_extract → codegraph_add_nodes to enrich.",
    }


async def _report(args: dict) -> dict:
    report_path = Path(args["path"]) / "codegraph-cache" / "CODEGRAPH_REPORT.md"
    if report_path.exists():
        return {"content": report_path.read_text(encoding="utf-8")}
    graph_dict = load_graph(args["path"])
    if not graph_dict:
        raise ValueError("No graph found. Run codegraph_build first.")
    return {"content": generate_report(graph_dict, args["path"])}


async def _nodes(args: dict) -> dict:
    graph_dict = load_graph(args["path"])
    if not graph_dict:
        raise ValueError("No graph found. Run codegraph_build first.")
    node_type = args["type"]
    limit     = args.get("limit", 50)
    matched   = [n for n in graph_dict.get("nodes", []) if n.get("type") == node_type]
    return {"type": node_type, "count": len(matched), "nodes": matched[:limit]}


async def _path(args: dict) -> dict:
    graph_dict = load_graph(args["path"])
    if not graph_dict:
        raise ValueError("No graph found. Run codegraph_build first.")
    return find_path(args["from"], args["to"], graph_dict)


# ── Entry point ───────────────────────────────────────────────────────────────

async def _async_main():
    async with stdio_server() as (read_stream, write_stream):
        await app.run(read_stream, write_stream, app.create_initialization_options())


def main():
    """Sync entry point — required by pyproject.toml [project.scripts]."""
    asyncio.run(_async_main())


if __name__ == "__main__":
    main()
