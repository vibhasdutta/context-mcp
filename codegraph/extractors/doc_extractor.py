"""
doc_extractor.py — extract plain text from doc and PDF files.
PDF extraction uses pymupdf if installed; falls back to label-only otherwise.
"""

from pathlib import Path


def extract_text(path: str) -> str:
    """Return text content of a doc/PDF file. Truncated at DOC_MAX_CHARS."""
    from ..config import DOC_MAX_CHARS
    if path.lower().endswith(".pdf"):
        return _extract_pdf(path, DOC_MAX_CHARS)
    try:
        return Path(path).read_text(encoding="utf-8", errors="replace")[:DOC_MAX_CHARS]
    except OSError:
        return ""


def _extract_pdf(path: str, max_chars: int) -> str:
    try:
        import pymupdf  # optional dep
        doc = pymupdf.open(path)
        parts = []
        for page in doc:
            parts.append(page.get_text())
            if sum(len(p) for p in parts) >= max_chars:
                break
        doc.close()
        return "".join(parts)[:max_chars]
    except ImportError:
        return f"[PDF: {Path(path).name} — install pymupdf to extract text]"
    except Exception:
        return ""
