#!/usr/bin/env node

/**
 * Windsurf post_run_command hook for context-mcp.
 *
 * Input (stdin JSON): { hook_event_name: "post_run_command", tool_name,
 *   tool_input: { command }, tool_response: { exit_code, stdout, stderr }, cwd }
 *
 * Saves failed shell commands to context-mcp so the next session can see
 * what broke. Exits silently when the command succeeded or exit code is unknown.
 */

import { spawnSync } from 'node:child_process';

process.stdin.resume();
process.stdin.setEncoding('utf8');

let input = '';
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  let event = {};
  try {
    event = input.trim() ? JSON.parse(input) : {};
  } catch {
    return;
  }

  const toolInput = event.tool_input || {};
  const toolResult = typeof event.tool_response === 'object' && event.tool_response !== null
    ? event.tool_response
    : typeof event.tool_output === 'object' && event.tool_output !== null
      ? event.tool_output
      : {};
  const command = toolInput.command || toolInput.cmd || event.command || '';
  const exitCode = toolResult.exit_code ?? toolResult.exitCode ?? toolResult.code
    ?? event.exit_code ?? event.exitCode;

  if (!command || exitCode === undefined || Number(exitCode) === 0) return;

  const output = String(
    toolResult.stderr || toolResult.stdout || toolResult.output || '',
  ).trim();

  const content = [
    `Command: ${command}`,
    `Exit code: ${exitCode}`,
    output ? `Output:\n${output.slice(0, 4000)}` : null,
  ].filter(Boolean).join('\n\n');

  spawnSync('ctx', [
    'save',
    '--project', (event.cwd || process.cwd()).split(/[\\/]/).pop() || 'default',
    '--type', 'bug',
    '--title', `Failed shell command: ${command.slice(0, 80)}`,
    '--content', content,
  ], { encoding: 'utf8', shell: true, stdio: 'ignore' });
});
