# context-mcp

Persistent memory and codebase knowledge graph for AI coding assistants — delivered as a single MCP server.

One shared context store. Works across Claude Code, Cursor, Gemini CLI, Codex, Windsurf, VS Code Copilot, and any MCP-compatible tool. Save context from one AI, pick it up in another. Your memory follows the project, not the tool.

---

## The Problem

Every conversation with an AI assistant starts from zero. The AI re-reads files it already read yesterday, re-discovers architecture it already understood, re-derives decisions that were already made. You repeat context. You paste the same background. You explain the same things.

This gets worse as projects grow. A codebase with 50 files means the AI either reads all of them every time (burning thousands of tokens) or misses context and gives wrong answers.

---

## What context-mcp Solves

**1. You lose context between conversations.**
AI assistants have no memory. Every new chat is a blank slate. context-mcp gives the AI a persistent store of decisions, bugs, notes, and architecture — loaded automatically at conversation start.

**2. Context is siloed to one tool.**
You fix a bug with Claude Code, then open Cursor and it knows nothing about it. You run Gemini CLI and have to explain the whole project again. context-mcp stores everything in `~/.context-mcp/` — a single shared store on your machine. Any AI that connects to this MCP server gets the same context, regardless of which tool saved it.

**3. File changes from anywhere are automatically reflected.**
Edit a file in VSCode, make changes through the web, modify from any tool — the knowledge graph sees the file as changed on next build. The context store is on disk, not tied to any session or IDE.

**4. Structural understanding costs too many tokens.**
Reading 20 files to answer "what calls this function?" is wasteful. context-mcp builds a knowledge graph of your codebase once, then answers structural questions in ~500 tokens instead of ~50,000.

**5. Repeated enrichment is expensive.**
AI-written descriptions of your code nodes are computed once and stored permanently. They survive file changes, rebuilds, and new conversations — never paid for twice.

---

## Installation

context-mcp has two packages:

| Package | What it does | Install via |
|---------|-------------|------------|
| `context-mcp` | Main MCP server — memory, search, CLI, file/git tools | npm |
| `codegraph-mcp` | Python subprocess — AST graph, queries, community detection | uv / pip |

Both are required for CodeGraph tools. Memory tools work with npm alone.

### npm

```bash
npm install -g context-mcp
```

Or run without installing:

```bash
npx context-mcp@latest
```

Installs three commands:

| Command | What it runs |
|---------|-------------|
| `context-mcp` | Stdio MCP server (for local AI clients) |
| `context-mcp-http` | HTTP MCP server with OAuth 2.0 (for web clients) |
| `ctx` | Interactive CLI — browse, search, manage context |

### uv (Python — CodeGraph)

```bash
# Install uv if you don't have it
curl -Ls https://astral.sh/uv/install.sh | sh   # macOS / Linux
winget install astral-sh.uv                      # Windows

# Install codegraph-mcp
uv tool install codegraph-mcp
```

Or run directly without installing:

```bash
uvx codegraph-mcp
```

Or with pip:

```bash
pip install codegraph-mcp
```

Requires Python ≥ 3.11 and Node.js ≥ 18.

---

## Platform Setup

The easiest way to set up any platform is with `ctx install`:

```bash
ctx install --claude      # Claude Code
ctx install --cursor      # Cursor
ctx install --vscode      # VS Code Copilot
ctx install --gemini      # Gemini CLI
ctx install --codex       # Codex CLI
ctx install --windsurf    # Windsurf
ctx install --all         # all platforms at once
```

Run this from your project root. It writes the MCP config file and AI instruction file for each platform directly into your project.

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
      "args": ["-y", "context-mcp@latest"]
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
      "args": ["-y", "context-mcp@latest"]
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
      "args": ["-y", "context-mcp@latest"]
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
      "args": ["-y", "context-mcp@latest"]
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
args    = ["-y", "context-mcp@latest"]
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
      "args": ["-y", "context-mcp@latest"]
    }
  }
}
```

---

### Claude.ai / ChatGPT (HTTP mode)

Web-based AI clients connect over HTTP with OAuth 2.0, not stdio. Use `ctx online` to start the HTTP server.

**Step 1 — Start the HTTP server:**

```bash
ctx online
```

This starts the server in the background, shows your OAuth credentials, and prints the endpoint URL. Run it again to see if it's already running — it won't start a second copy.

```bash
ctx online --restart   # force restart even if already running
ctx online --port 3200 # use a different port
```

Or start directly without the CLI:

```bash
context-mcp-http --port 3100 --host localhost --access-git
```

**Step 2 — Add as a remote MCP connector in Claude.ai:**

1. Go to Claude.ai → Settings → Integrations → Add MCP Connector
2. Enter your server URL (e.g. `http://localhost:3100`)
3. When prompted for credentials, use the **Client ID** and **Client Secret** shown by `ctx online`

The server auto-generates credentials on first run. Open `http://localhost:3100` in a browser to see a connection guide page with your current credentials.

**View or edit config:**

```bash
ctx settings
```

Shows all config values (port, host, client ID, secret) and lets you edit them interactively.

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
ctx delete project <name|id>         # delete all entries for a project (by name or UUID)

# Server
ctx online                           # start HTTP server (idempotent — safe to re-run)
ctx online --restart                 # force stop + restart
ctx online --port 3200               # use a different port
ctx settings                         # view and edit config interactively

# Tools
ctx install --claude                 # write MCP config for Claude Code
ctx install --cursor                 # write MCP config for Cursor
ctx install --vscode                 # write MCP config for VS Code
ctx install --gemini                 # write MCP config for Gemini CLI
ctx install --all                    # install for all platforms at once
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
  "public_url": null
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `client_id` | `"context-mcp"` | OAuth client ID shown to web clients |
| `client_secret` | auto-generated | OAuth secret — keep private |
| `port` | `3100` | HTTP server port (overridable with `--port`) |
| `host` | `"localhost"` | HTTP bind host (overridable with `--host`) |
| `access_git` | `false` | Enable git tools (overridable with `--access-git`) |
| `public_url` | `null` | Saved public URL shown in `ctx online` output |

Edit any field interactively with `ctx settings`.

The data directory itself is controlled by the `CONTEXT_MCP_DIR` env variable or `--data-dir` flag. Default: `~/.context-mcp/`.

---

## Features

### Memory
- `context.resume` — one call loads recent entries, active discussions, and graph status
- `context.save` — store decisions, bugs, notes, code snippets, architecture with type tags
- `context.get` / `context.update` / `context.delete` — full CRUD
- `search` — keyword-first, semantic fallback, searches all past context
- `discussion` — threaded plans with steps, status tracking, cross-session continuity
- Auto-deduplication on save
- Auto-compact at 50 entries (oldest entries summarized into a digest)
- Per-project isolation

### CodeGraph
- `codegraph_build` — AST scan: functions, classes, imports, edges. No API, no cost, runs locally
- `codegraph_extract` — returns changed files with their node lists for AI enrichment
- `codegraph_add_nodes` — stores AI-written descriptions in permanent semantic cache
- `codegraph_query` — natural language structural question → NODE/EDGE subgraph with `token_budget` control
- `codegraph_explain` — single node lookup: description, what it depends on, what uses it
- `codegraph_path` — shortest path between two concepts in the graph
- `codegraph_nodes` — list all nodes of a given type
- `codegraph_report` — full graph analysis: god nodes, clusters, surprising connections

### Multi-AI Support

| AI | Config File | Instruction File |
|----|------------|-----------------|
| Claude Code | `.claude/mcp.json` | `CLAUDE.md` |
| Claude VSCode | `.vscode/mcp.json` | `CLAUDE.md` |
| Cursor | `.cursor/mcp.json` | `.cursor/rules/context-mcp.mdc` |
| Gemini CLI | `.gemini/settings.json` | `GEMINI.md` |
| Codex CLI | `.codex/config.toml` | `AGENTS.md` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | `.windsurf/rules/context-mcp.md` |
| Claude.ai / ChatGPT | HTTP (`ctx online`) | — |

> **The context store lives at `~/.context-mcp/` on your machine — not inside any tool, IDE, or session.** Any AI connecting to this server reads and writes the same store. A decision saved in Claude Code is visible in Cursor. A bug logged from Gemini CLI shows up when you resume in Codex.

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
│   ├── search.js          Keyword + semantic search
│   ├── summarizer.js      Auto-compact summarization
│   ├── cli.js             Interactive CLI (ctx) — 256-color UI
│   ├── http.js            HTTP server — OAuth 2.0 + Streamable HTTP transport
│   ├── config.js          Config loader — contextconfig.json + keytar
│   ├── vector.js          Embedding helpers
│   └── tools/
│       ├── context.js     Memory tool (resume/save/get/update/delete)
│       ├── discussion.js  Discussion tool (threaded plans + steps)
│       ├── codegraph.js   CodeGraph tool — bridge to Python subprocess
│       ├── search.js      Search tool
│       ├── fileTools.js   File read/write helpers
│       ├── gitTools.js    Git integration
│       └── errorCheck.js  Error checking tool
├── codegraph/             Python package (published separately as codegraph-mcp)
│   ├── server.py          Dispatcher — reads JSON from stdin, routes to tools
│   ├── scanner.py         File walker + classifier
│   ├── cache.py           Two-layer cache (ast.json + semantic.json)
│   ├── report.py          Graph report generator
│   ├── extractors/
│   │   ├── ast_extractor.py   AST node + edge extraction
│   │   ├── doc_extractor.py   Markdown / text extraction
│   │   ├── image_extractor.py Image metadata extraction
│   │   └── audio_extractor.py Audio metadata extraction
│   └── graph/
│       ├── builder.py     NetworkX graph construction
│       ├── query.py       Natural language → subgraph traversal
│       └── clustering.py  Community detection
└── ~/.context-mcp/        Data directory (outside repo, never committed)
    ├── contexts.json      Context entries
    ├── discussions.json   Discussions
    ├── projects.json      Project registry with stable UUIDs
    ├── graphs.json        Graph metadata
    └── contextconfig.json OAuth config + server settings
```

Data stored in `~/.context-mcp/` — separate from the project, never committed.

---

## License

MIT
