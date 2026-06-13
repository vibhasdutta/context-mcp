#!/usr/bin/env node

/**
 * Antigravity IDE PostToolUse hook for context-mcp.
 *
 * Input (stdin JSON): {
 *   toolCall: { name, args },
 *   stepIdx, conversationId, workspacePaths,
 *   error        ← present when the tool invocation failed
 * }
 *
 * Saves failed tool invocations to context-mcp so the next session can see
 * what broke. Exits silently when the tool succeeded or no error is present.
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

  const toolCall = event.toolCall || {};
  const toolName = toolCall.name || '';
  const error = event.error;

  if (!error || !toolName) return;

  const args = toolCall.args || {};
  const argsSnippet = Object.keys(args).length
    ? JSON.stringify(args).slice(0, 200)
    : '';

  const cwd = (event.workspacePaths || [])[0] || process.cwd();
  const project = cwd.replace(/\\/g, '/').replace(/\/$/, '').split('/').pop() || 'default';

  const content = [
    `Tool: ${toolName}`,
    argsSnippet ? `Args: ${argsSnippet}` : null,
    `Error: ${String(error).slice(0, 4000)}`,
  ].filter(Boolean).join('\n\n');

  spawnSync('ctx', [
    'save',
    '--project', project,
    '--type', 'bug',
    '--title', `Failed tool: ${toolName.slice(0, 80)}`,
    '--content', content,
  ], {
    encoding: 'utf8',
    shell: true,
    stdio: 'ignore',
  });
});
