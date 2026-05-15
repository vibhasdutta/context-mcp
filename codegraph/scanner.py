"""
scanner.py — walk a project directory, hash every file, detect what changed.
"""

import os
from pathlib import Path
from typing import Iterator

from .cache import file_hash, get_cached_nodes, set_cached_nodes, remove_deleted, load_cache, save_cache
from .config import (
    DEFAULT_IGNORE, MAX_FILE_BYTES,
    CODE_EXTENSIONS, SQL_EXTENSIONS, CONFIG_EXTENSIONS,
    DOC_EXTENSIONS, PDF_EXTENSIONS, IMAGE_EXTENSIONS,
    AUDIO_EXTENSIONS, VIDEO_EXTENSIONS,
)


def _should_ignore(name: str, ignore: set) -> bool:
    return name.startswith(".") and name != ".env" or name in ignore


def walk_files(root: str, extra_ignore: set | None = None) -> Iterator[str]:
    """Yield absolute paths to all non-ignored files under root."""
    ignore = DEFAULT_IGNORE | (extra_ignore or set())
    for dirpath, dirnames, filenames in os.walk(root):
        # Prune ignored dirs in-place so os.walk doesn't descend
        dirnames[:] = [d for d in dirnames if d not in ignore and not d.startswith(".")]
        for fname in filenames:
            abs_path = os.path.join(dirpath, fname)
            try:
                if os.path.getsize(abs_path) > MAX_FILE_BYTES:
                    continue
            except OSError:
                continue
            yield abs_path


def classify_file(path: str) -> str:
    """Return extraction category for a file."""
    ext = Path(path).suffix.lower()
    if ext in CODE_EXTENSIONS:    return "code"
    if ext in SQL_EXTENSIONS:     return "sql"
    if ext in CONFIG_EXTENSIONS:  return "config"
    if ext in DOC_EXTENSIONS:     return "doc"
    if ext in PDF_EXTENSIONS:     return "pdf"
    if ext in IMAGE_EXTENSIONS:   return "image"
    if ext in AUDIO_EXTENSIONS:   return "audio"
    if ext in VIDEO_EXTENSIONS:   return "video"
    return "unknown"


def scan(project_root: str, extra_ignore: set | None = None) -> dict:
    """
    Walk project, diff against cache.

    Returns:
        {
          "cached":  { rel_path: [nodes] },   # unchanged — load from cache
          "changed": { rel_path: abs_path },  # hash changed — need re-extraction
          "deleted": [rel_path],              # in cache but file gone
          "cache":   dict,                    # current cache (mutated in place)
        }
    """
    root = os.path.abspath(project_root)
    cache = load_cache(root)

    cached = {}
    changed = {}
    existing_rel = set()

    for abs_path in walk_files(root, extra_ignore):
        rel_path = os.path.relpath(abs_path, root).replace("\\", "/")
        existing_rel.add(rel_path)
        category = classify_file(abs_path)
        if category == "unknown":
            continue
        h = file_hash(abs_path)
        nodes = get_cached_nodes(cache, rel_path, h)
        if nodes is not None:
            cached[rel_path] = nodes
        else:
            changed[rel_path] = abs_path

    deleted = remove_deleted(cache, existing_rel)

    return {
        "cached":  cached,
        "changed": changed,
        "deleted": deleted,
        "cache":   cache,
        "root":    root,
    }
