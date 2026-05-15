"""
ast_extractor.py — extract nodes from code files using tree-sitter AST.

Falls back to regex if tree-sitter grammars aren't installed.
Each node: { id, name, type, file, line, docstring?, calls?, imports? }
"""

import re
from pathlib import Path


# ── tree-sitter setup (optional — graceful fallback) ─────────────────────────

def _try_load_ts():
    try:
        import tree_sitter_python as tspython
        import tree_sitter_javascript as tsjavascript
        from tree_sitter import Language, Parser
        PY_LANG = Language(tspython.language())
        JS_LANG = Language(tsjavascript.language())
        return {"python": (PY_LANG, Parser(PY_LANG)), "javascript": (JS_LANG, Parser(JS_LANG))}
    except ImportError:
        return {}

_TS_PARSERS = _try_load_ts()


# ── tree-sitter queries ───────────────────────────────────────────────────────

_PY_CLASS_QUERY = """
(class_definition name: (identifier) @name) @class
"""

_PY_FUNC_QUERY = """
(function_definition name: (identifier) @name) @func
"""

_JS_CLASS_QUERY = """
(class_declaration name: (identifier) @name) @class
"""

_JS_FUNC_QUERY = """
[
  (function_declaration name: (identifier) @name)
  (method_definition name: (property_identifier) @name)
] @func
"""


def _ts_extract(source: bytes, lang_key: str, rel_path: str) -> list:
    parsers = _TS_PARSERS
    if lang_key not in parsers:
        return []
    lang, parser = parsers[lang_key]
    tree = parser.parse(source)

    nodes = []
    lines = source.decode("utf-8", errors="replace").splitlines()

    def _node(kind, name, line):
        return {
            "id": f"{rel_path}::{kind}::{name}",
            "name": name,
            "type": kind,
            "file": rel_path,
            "line": line,
        }

    def _iter_captures(query, root):
        """Yield (capture_name, tree_node) pairs; compatible with tree-sitter >=0.20."""
        try:
            # tree-sitter >= 0.22: matches() returns list of (pattern_idx, {name: [Node]})
            for _pat_idx, caps in query.matches(root):
                for cap_name, cap_nodes in caps.items():
                    for n in (cap_nodes if isinstance(cap_nodes, list) else [cap_nodes]):
                        yield cap_name, n
        except Exception:
            pass

    # Classes
    try:
        query = lang.query(_PY_CLASS_QUERY if lang_key == "python" else _JS_CLASS_QUERY)
        for cap_name, node in _iter_captures(query, tree.root_node):
            if cap_name == "name" and node.type == "identifier":
                nodes.append(_node("class", node.text.decode(), node.start_point[0] + 1))
    except Exception:
        pass

    # Functions
    try:
        query = lang.query(_PY_FUNC_QUERY if lang_key == "python" else _JS_FUNC_QUERY)
        for cap_name, node in _iter_captures(query, tree.root_node):
            if cap_name == "name" and node.type in ("identifier", "property_identifier"):
                nodes.append(_node("function", node.text.decode(), node.start_point[0] + 1))
    except Exception:
        pass

    return nodes


# ── Regex fallback ────────────────────────────────────────────────────────────

_PATTERNS = {
    "python": {
        "class":    re.compile(r"^class\s+(\w+)", re.MULTILINE),
        "function": re.compile(r"^def\s+(\w+)", re.MULTILINE),
        "import":   re.compile(r"^(?:import|from)\s+([\w.]+)", re.MULTILINE),
    },
    "javascript": {
        "class":    re.compile(r"\bclass\s+(\w+)", re.MULTILINE),
        "function": re.compile(r"\bfunction\s+(\w+)", re.MULTILINE),
        "import":   re.compile(r"^import\s+.*?from\s+['\"](.+?)['\"]", re.MULTILINE),
    },
    "go": {
        "function": re.compile(r"^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)", re.MULTILINE),
        "struct":   re.compile(r"^type\s+(\w+)\s+struct", re.MULTILINE),
        "import":   re.compile(r'"([\w./]+)"', re.MULTILINE),
    },
    "rust": {
        "function": re.compile(r"^(?:pub\s+)?fn\s+(\w+)", re.MULTILINE),
        "struct":   re.compile(r"^(?:pub\s+)?struct\s+(\w+)", re.MULTILINE),
        "import":   re.compile(r"^use\s+([\w:]+)", re.MULTILINE),
    },
    "java": {
        "class":    re.compile(r"\bclass\s+(\w+)", re.MULTILINE),
        "function": re.compile(r"(?:public|private|protected|static|\s)+[\w<>\[\]]+\s+(\w+)\s*\(", re.MULTILINE),
        "import":   re.compile(r"^import\s+([\w.]+);", re.MULTILINE),
    },
    "ruby": {
        "class":    re.compile(r"^class\s+(\w+)", re.MULTILINE),
        "function": re.compile(r"^\s*def\s+(\w+)", re.MULTILINE),
    },
    "sql": {
        "table":    re.compile(r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`\"]?(\w+)[`\"]?", re.IGNORECASE),
        "index":    re.compile(r"CREATE\s+(?:UNIQUE\s+)?INDEX\s+\w+\s+ON\s+[`\"]?(\w+)[`\"]?", re.IGNORECASE),
    },
    # config files: no node extraction — file node created by scanner
}


def _ext_to_lang(ext: str) -> str:
    return {
        ".py": "python", ".pyw": "python",
        ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript",
        ".jsx": "javascript", ".ts": "javascript", ".tsx": "javascript",
        ".go": "go", ".rs": "rust",
        ".java": "java", ".rb": "ruby",
        ".sql": "sql",
        ".yaml": "config", ".yml": "config", ".toml": "config",
        ".env": "config", ".ini": "config", ".cfg": "config",
    }.get(ext, "")


def _regex_extract(text: str, lang: str, rel_path: str) -> list:
    patterns = _PATTERNS.get(lang, {})
    children = []
    for kind, pat in patterns.items():
        if kind == "import":
            continue
        for m in pat.finditer(text):
            line = text[:m.start()].count("\n") + 1
            children.append({
                "id":   f"{rel_path}::{kind}::{m.group(1)}",
                "name": m.group(1),
                "type": kind,
                "file": rel_path,
                "line": line,
            })

    imp_pat = patterns.get("import")
    imports = [m.group(1) for m in imp_pat.finditer(text)][:30] if imp_pat else []

    return _wrap_in_module(rel_path, children, imports)


# ── Module wrapper ───────────────────────────────────────────────────────────

def _wrap_in_module(rel_path: str, children: list, imports: list) -> list:
    """
    Create a module node for the file, link all child nodes to it via defined_in.
    The module node carries the imports so builder can create file-to-file edges.
    """
    from pathlib import Path as _Path
    stem = _Path(rel_path).stem
    mod_id = f"{rel_path}::module::{stem}"
    module = {
        "id":      mod_id,
        "name":    stem,
        "type":    "module",
        "file":    rel_path,
        "line":    1,
        "imports": imports,
    }
    for child in children:
        child["relations"] = [{"id": mod_id, "relation": "defined-in", "confidence": "EXTRACTED"}]
    return [module] + children


# ── Public API ────────────────────────────────────────────────────────────────

def extract(abs_path: str, rel_path: str) -> list:
    """Extract nodes from a code/sql/config file. Returns list of node dicts."""
    ext = Path(abs_path).suffix.lower()
    lang = _ext_to_lang(ext)
    if not lang:
        return []

    try:
        raw = open(abs_path, "rb").read()
        text = raw.decode("utf-8", errors="replace")
    except OSError:
        return []

    # tree-sitter for Python and JS/TS if available
    if lang in ("python", "javascript") and lang in _TS_PARSERS:
        children = _ts_extract(raw, lang, rel_path)
        if children:
            imp_pat = _PATTERNS.get(lang, {}).get("import")
            imports = [m.group(1) for m in imp_pat.finditer(text)][:30] if imp_pat else []
            return _wrap_in_module(rel_path, children, imports)

    return _regex_extract(text, lang, rel_path)
