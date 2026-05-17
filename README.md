# context-mcp

Persistent memory and codebase knowledge graph for AI coding assistants — delivered as a single MCP server.

One shared context store. Works across Claude Code, Cursor, Gemini CLI, Codex, Windsurf, VS Code Copilot, Claude.ai, and ChatGPT. Save context from one AI, pick it up in another. Your memory follows the project, not the tool.

**6 AI platforms** · **6 IDEs** · **16 programming languages** (Python, JS, TS, Go, Rust, Java, Kotlin, C, C++, C#, Ruby, PHP, Swift, Lua, and more) · tree-sitter AST parsing with regex fallback

---

## The Problem

Every conversation with an AI assistant starts from zero. The AI re-reads files it already read yesterday, re-discovers architecture it already understood, re-derives decisions that were already made. You repeat context. You paste the same background. You explain the same things.

This gets worse as projects grow. A codebase with 50 files means the AI either reads all of them every time (burning thousands of tokens) or misses context and gives wrong answers.

---

## What context-mcp Solves

**1. You lose context between conversations.**
AI assistants have no memory. Every new chat is a blank slate. context-mcp gives the AI a persistent store of decisions, bugs, notes, and architecture — loaded automatically at conversation start.

**2. Context is siloed to one tool.**
You fix a bug with Claude Code, then open Cursor and it knows nothing about it. context-mcp stores everything in `~/.context-mcp/` — a single shared store on your machine. Any AI that connects reads and writes the same store.

**3. Structural understanding costs too many tokens.**
Reading 20 files to answer "what calls this function?" is wasteful. context-mcp builds a knowledge graph of your codebase once, then answers structural questions in ~500 tokens instead of ~50,000.

---

## Installation

```bash
npm install -g context-mcp-server
```

That's it. One command installs everything — the MCP server, HTTP server, and `ctx` CLI.

Then run from your project root:

```bash
ctx install --all
```

This writes MCP config + AI instruction files for every platform **and** automatically sets up the Python codegraph environment if [uv](https://docs.astral.sh/uv/) is installed.

> **CodeGraph requires uv.** Install it first if you want graph features:
> ```bash
> curl -Ls https://astral.sh/uv/install.sh | sh   # macOS / Linux
> winget install astral-sh.uv                      # Windows
> ```
> Memory tools work with npm alone — uv is only needed for `codegraph_build` and graph queries.

Requires Node.js ≥ 18.

Installs three commands:

| Command | What it runs |
|---------|-------------|
| `context-mcp` | Stdio MCP server (for local AI clients) |
| `context-mcp-http` | HTTP MCP server with OAuth 2.0 (for web clients) |
| `ctx` | Interactive CLI — browse, search, manage context |

---

## Platform Setup

```bash
ctx install --claude      # Claude Code
ctx install --cursor      # Cursor
ctx install --vscode      # VS Code Copilot
ctx install --gemini      # Gemini CLI
ctx install --codex       # Codex CLI
ctx install --windsurf    # Windsurf
ctx install --all         # all platforms + Python setup at once
```

Run from your project root. Each command writes the MCP config file and AI instruction file for that platform, then checks for uv and sets up the Python codegraph environment.

---

### Claude Code

`ctx install --claude` writes:
- `.claude/mcp.json` — MCP server config
- `CLAUDE.md` — instructions Claude reads automatically at conversation start

Manual config — add to `.claude/mcp.json`:

```json
{
  "mcpServers": {
    "context-mcp": {
      "command": "npx",
      "args": ["-y", "context-mcp-server@latest"]
    }
  }
}
```

---

### Cursor

`ctx install --cursor` writes:
- `.cursor/mcp.json` — MCP server config
- `.cursor/rules/context-mcp.mdc` — Cursor rules file

Manual config — add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "context-mcp": {
      "command": "npx",
      "args": ["-y", "context-mcp-server@latest"]
    }
  }
}
```

---

### VS Code Copilot

`ctx install --vscode` writes:
- `.vscode/mcp.json` — MCP server config
- `CLAUDE.md` — instruction file

Manual config — add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "context-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "context-mcp-server@latest"]
    }
  }
}
```

---

### Gemini CLI

`ctx install --gemini` writes:
- `.gemini/settings.json` — MCP server config
- `GEMINI.md` — instructions Gemini reads automatically

Manual config — add to `.gemini/settings.json`:

```json
{
  "mcpServers": {
    "context-mcp": {
      "command": "npx",
      "args": ["-y", "context-mcp-server@latest"]
    }
  }
}
```

---

### Codex CLI

`ctx install --codex` writes:
- `.codex/config.toml` — MCP server config
- `AGENTS.md` — instructions Codex reads automatically

Manual config — add to `.codex/config.toml`:

```toml
[[mcp_servers]]
name    = "context-mcp"
command = "npx"
args    = ["-y", "context-mcp-server@latest"]
```

---

### Windsurf

`ctx install --windsurf` writes:
- `.windsurf/rules/context-mcp.md` — local rules file (project scope)
- `~/.codeium/windsurf/mcp_config.json` — global MCP config (merged, not overwritten)

Manual config — add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "context-mcp": {
      "command": "npx",
      "args": ["-y", "context-mcp-server@latest"]
    }
  }
}
```

---

### Claude.ai / ChatGPT (HTTP mode)

Web-based clients connect over HTTP with OAuth 2.0. Use `ctx online` to start the HTTP server.

**Step 1 — Start the server:**

```bash
ctx online
```

Starts the server in the background, shows your OAuth credentials, and prints the endpoint URL. Safe to re-run — won't start a second copy.

```bash
ctx online --restart   # force restart
ctx online --port 3200 # use a different port
```

Or start directly:

```bash
context-mcp-http --port 3100 --host localhost --access-git
```

**Step 2 — Add as a remote MCP connector:**

1. Go to Claude.ai → Settings → Integrations → Add MCP Connector
2. Enter your server URL (e.g. `http://localhost:3100`)
3. Use the **Client ID** and **Client Secret** from `~/.context-mcp/contextconfig.json`

**View or edit config:**

```bash
ctx settings
```

---

## Path Sandboxing (Security)

File and git tools are sandboxed to your project root. Pass `rootPath` when calling `context.resume` to register it:

```json
{ "action": "resume", "project": "my-app", "rootPath": "/home/user/my-app" }
```

The root is stored permanently with the project. Any file or git operation outside that directory is rejected. This applies to all HTTP-connected clients (Claude.ai, ChatGPT) — they can only access files within the registered project root.

---

## CLI Reference

```bash
ctx                                  # open interactive mode

# Context
ctx list [project]                   # list entries, discussions, graphs
ctx projects                         # all projects with IDs, graph status, recent entries
ctx search "query"                   # keyword → semantic fallback search
ctx add                              # add entry interactively
ctx summary [project]                # summarize recent entries

# Delete
ctx delete <id-prefix>               # delete one entry by ID prefix
ctx delete project <name|id>         # delete all entries for a project

# Server
ctx online                           # start HTTP server (idempotent)
ctx online --restart                 # force stop + restart
ctx online --port 3200               # use a different port
ctx settings                         # view and edit config interactively

# Setup
ctx install --claude                 # write MCP config for Claude Code
ctx install --cursor                 # write MCP config for Cursor
ctx install --vscode                 # write MCP config for VS Code
ctx install --gemini                 # write MCP config for Gemini CLI
ctx install --codex                  # write MCP config for Codex CLI
ctx install --windsurf               # write MCP config for Windsurf
ctx install --all                    # all platforms + Python setup

# Tools
ctx benchmark                        # real token savings report (memory + graph)
ctx discuss [project]                # view discussions
```

---

## Server Flags

### `context-mcp` (stdio)

```
context-mcp [options]

Options:
  --data-dir <path>   Override storage directory (default: ~/.context-mcp)
                      Also via env: CONTEXT_MCP_DIR=<path>
  --help, -h          Show help
```

### `context-mcp-http` (HTTP + OAuth)

```
context-mcp-http [options]

Options:
  --port <number>     HTTP listen port (default: 3100)
  --host <string>     Bind address (default: localhost)
  --access-git        Enable git tools for connected clients
  --data-dir <path>   Override storage directory (default: ~/.context-mcp)
                      Also via env: CONTEXT_MCP_DIR=<path>
  --help, -h          Show help
```

---

## Config Reference

Config lives at `~/.context-mcp/contextconfig.json` — auto-created on first run:

```json
{
  "client_id": "context-mcp",
  "client_secret": "<auto-generated>",
  "port": 3100,
  "host": "localhost",
  "access_git": false,
  "public_url": null,
  "allowed_redirect_uris": ["https://claude.ai"],
  "allowed_origins": []
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `client_id` | `"context-mcp"` | OAuth client ID |
| `client_secret` | auto-generated | OAuth signing secret — keep private |
| `port` | `3100` | HTTP server port |
| `host` | `"localhost"` | HTTP bind host |
| `access_git` | `false` | Enable git tools for HTTP clients |
| `public_url` | `null` | Public URL shown in `ctx online` output |
| `allowed_redirect_uris` | `["https://claude.ai"]` | OAuth redirect URI whitelist |
| `allowed_origins` | `[]` | Extra CORS origins beyond `claude.ai` and `localhost` |

Edit any field interactively with `ctx settings`.

---

## Features

### Memory
- `context.resume` — loads recent entries, active discussions, and graph status. Pass `rootPath` to sandbox file/git tools to your project directory.
- `context.save` — store decisions, bugs, notes, code snippets, architecture with type tags
- `context.get` / `context.update` / `context.delete` — full CRUD
- `search` — keyword-first, semantic fallback, searches all past context
- `discussion` — threaded plans with steps, status tracking, cross-session continuity
- Auto-deduplication on save
- Auto-compact at 50 entries (oldest entries summarized into a digest)
- Per-project isolation with stable UUIDs

### File & Git Tools (HTTP mode)
Available to web clients (Claude.ai, ChatGPT) only — local AI clients use their native IDE tools directly.

- `read_file`, `write_file`, `patch_file`, `create_dir`, `list_dir`, `delete_file`
- `git_status`, `git_diff`, `git_log`, `git_add`, `git_commit`, `git_push`, `git_pull`, `git_branch`, `git_stash`, `git_reset`, `git_show`

All file and git operations are sandboxed to the registered project root. Enable git tools with `--access-git` or `access_git: true` in config.

### CodeGraph
- `codegraph_build` — AST scan using tree-sitter: functions, classes, imports, edges. Runs locally, no API cost.
- `codegraph_query` — fetch any details about the codebase using natural language: find functions, classes, files, dependencies, callers
- `codegraph_explain` — single node: type, file location, all direct connections (depends_on, used_by)
- `codegraph_path` — shortest path between two concepts
- `codegraph_nodes` — list all nodes of a given type
- `codegraph_report` — full graph analysis: god nodes, clusters, surprising connections

### Multi-AI Support

| AI | Config File | Instruction File |
|----|------------|-----------------|
| Claude Code | `.claude/mcp.json` | `CLAUDE.md` |
| VS Code Copilot | `.vscode/mcp.json` | `CLAUDE.md` |
| Cursor | `.cursor/mcp.json` | `.cursor/rules/context-mcp.mdc` |
| Gemini CLI | `.gemini/settings.json` | `GEMINI.md` |
| Codex CLI | `.codex/config.toml` | `AGENTS.md` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | `.windsurf/rules/context-mcp.md` |
| Claude.ai / ChatGPT | HTTP (`ctx online`) | — |

> The context store lives at `~/.context-mcp/` — not inside any tool, IDE, or session. A decision saved in Claude Code is visible in Cursor. A bug logged from Gemini CLI shows up when you resume in Codex.

---

## Token Reduction

| Scenario | Without context-mcp | With context-mcp |
|----------|-------------------|--------------------|
| Start of conversation | Paste background, re-explain project | `context.resume` → 15 entries, ~750 tokens |
| "What calls function X?" | Read 10 files to trace callers | `codegraph_query` → subgraph, ~400 tokens |
| "What does module Y depend on?" | Read module + all imports | `codegraph_explain` → node + edges, ~200 tokens |
| Understand architecture | Read 20+ files | Graph built once, queried forever |
| Remember last session's decision | Ask user or re-derive | `context.resume` loads it automatically |

Real measured reduction on this project: **162× fewer tokens**, **99.38% reduction** per conversation.

---

## Architecture

```
context-mcp/
├── src/
│   ├── index.js           Stdio MCP server entrypoint
│   ├── server.js          MCP server — registers all tools
│   ├── db.js              JSON store — in-memory cache, debounced writes, project registry
│   ├── guard.js           Path sandboxing — enforces project root on all file/git ops
│   ├── search.js          Keyword + semantic search
│   ├── summarizer.js      Auto-compact summarization
│   ├── cli.js             Interactive CLI (ctx)
│   ├── http.js            HTTP server — OAuth 2.0 + Streamable HTTP transport
│   ├── config.js          Config loader — contextconfig.json + keytar
│   ├── vector.js          Embedding helpers
│   └── tools/
│       ├── context.js     Memory tool (resume/save/get/update/delete)
│       ├── discussion.js  Discussion tool (threaded plans + steps)
│       ├── codegraph.js   CodeGraph tool — bridge to Python subprocess
│       ├── search.js      Search tool
│       ├── fileTools.js   File read/write (HTTP mode, sandboxed to project root)
│       ├── gitTools.js    Git integration (HTTP mode, sandboxed to project root)
│       └── errorCheck.js  Error checking tool
├── codegraph/             Python package — AST extraction + graph queries
│   ├── server.py          MCP server — tool definitions + dispatch
│   ├── scanner.py         File walker + classifier (SKIP/BUILD/CODE/CONFIG/DOC/MEDIA)
│   ├── config.py          File type taxonomy
│   ├── cache.py           AST cache (hash-based, incremental)
│   ├── report.py          Graph report generator
│   ├── extractors/
│   │   ├── ast_extractor.py    Tree-sitter AST (16 languages) + regex fallback
│   │   └── build_extractor.py  Single-node extraction for build files
│   └── graph/
│       ├── builder.py     NetworkX graph construction
│       ├── query.py       Natural language → subgraph traversal
│       └── clustering.py  Community detection
└── ~/.context-mcp/        Data directory (outside repo, never committed)
    ├── contexts.json
    ├── discussions.json
    ├── projects.json      Project registry — includes rootPath per project
    ├── graphs.json        Knowledge graph (nodes, edges, communities)
    └── contextconfig.json OAuth config + server settings
```

---

## License

MIT
