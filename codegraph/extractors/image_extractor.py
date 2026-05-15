"""
image_extractor.py — encode images as base64 for AI vision.
No external deps — stdlib only.
"""

import base64
import mimetypes
from pathlib import Path


def extract_image_b64(path: str) -> dict | None:
    """Return {"data": base64_str, "media_type": "image/png"} or None on failure."""
    try:
        data = Path(path).read_bytes()
        media_type = mimetypes.guess_type(path)[0] or "image/png"
        return {"data": base64.b64encode(data).decode(), "media_type": media_type}
    except OSError:
        return None


def extract_svg_text(path: str) -> str:
    """Return SVG file as plain text (SVGs are XML — readable as-is)."""
    try:
        return Path(path).read_text(encoding="utf-8", errors="replace")[:4000]
    except OSError:
        return ""
