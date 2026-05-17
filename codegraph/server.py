#!/usr/bin/env python3
"""
codegraph/server.py — MCP server exposing codebase knowledge graph tools.

Tools:
  codegraph_build   — scan project, extract AST nodes, build graph (local only, no API)
  codegraph_query   — fetch details about any part of the codebase via natural language
  codegraph_explain — look up a specific node: type, file, connections
  codegraph_report  — return full CODEGRAPH_REPORT.md
  codegraph_nodes   — list nodes of a given type
  codegraph_path    — shortest path between two concepts
"""

import asyncio
import json
import os
import time
from pathlib import Path

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

from .scanner import scan
from .config import classify_file
from .cache import file_hash, set_cached_nodes, save_cache
from .extractors.ast_extractor import extract as ast_extract
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
            "Uses tree-sitter AST (with regex fallback) for all code files. "
            "Fast, local, no API key needed. "
            "Run once per project; rebuild whenever code changes."
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
        name="codegraph_query",
        description=(
            "Fetch details about any part of the codebase using a natural language question. "
            "Searches the knowledge graph — instant, no API call. "
            "Use for: finding functions, classes, files, understanding what exists, "
            "what a module contains, what calls what, what imports what. "
            "NOT for: bug investigation or tracing unexpected behavior — read the file for that."
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
            "Look up a specific function, class, or module by name — returns its type, file location, "
            "and all direct connections (what it depends on, what uses it). "
            "Use when you already know the name and want its full context in the graph."
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
    if name == "codegraph_build":   return await _build(args)
    if name == "codegraph_query":   return await _query(args)
    if name == "codegraph_explain": return await _explain(args)
    if name == "codegraph_report":  return await _report(args)
    if name == "codegraph_nodes":   return await _nodes(args)
    if name == "codegraph_path":    return await _path(args)
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

    all_nodes: list[dict] = []

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
        elif cat == "build":
            from codegraph.extractors.build_extractor import extract as build_extract
            nodes = build_extract(abs_path, rel_path)
            set_cached_nodes(cache, rel_path, file_hash(abs_path), nodes)
            all_nodes.extend(nodes)
        elif cat in ("image", "audio", "video", "doc", "pdf"):
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

    return result


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
        "hint": None,
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
