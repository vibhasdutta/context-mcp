"""
config.py — codegraph settings.
"""

import os

# Files/dirs to ignore during scanning
DEFAULT_IGNORE = {
    "node_modules", ".git", "dist", "build", ".next", "__pycache__",
    ".venv", "venv", "env", ".env", "coverage", ".DS_Store",
    "codegraph-cache", ".pytest_cache", ".mypy_cache",
}

# Extensions handled by each extractor
CODE_EXTENSIONS = {
    ".py", ".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs",
    ".go", ".rs", ".java", ".c", ".cpp", ".h", ".hpp", ".rb",
}
SQL_EXTENSIONS   = {".sql"}
CONFIG_EXTENSIONS = {".yaml", ".yml", ".toml", ".env", ".ini", ".cfg"}
DOC_EXTENSIONS   = {".md", ".txt", ".rst", ".mdx"}
PDF_EXTENSIONS   = {".pdf"}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".svg", ".gif", ".webp"}
AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".ogg", ".flac"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".webm"}

# Max file size to process (bytes) — skip huge generated files
MAX_FILE_BYTES = 500_000

# Max characters of doc text returned to the AI per file
DOC_MAX_CHARS = 8_000
