#!/usr/bin/env node

/**
 * Gemini CLI BeforeTool hook for context-mcp.
 *
 * Input (stdin JSON): { session_id, cwd, hook_event_name: "BeforeTool",
 *   tool_name, tool_input }
 *
 * This hook is intentionally conservative. It validates the hook pipeline
 * runs before run_shell_command but never blocks (exit 0 with no decision =
 * allow). Keep policy decisions in GEMINI.md or a dedicated security hook
 * if your team needs blocking (print {"decision":"deny","reason":"..."}).
 */

process.stdin.resume();
process.stdin.setEncoding('utf8');

let input = '';
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  try {
    if (input.trim()) JSON.parse(input);
  } catch {
    // Do not interrupt the user's command because hook input changed.
  }
});
