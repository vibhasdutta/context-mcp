#!/usr/bin/env node
/**
 * context-mcp CLI
 * Browse, search, add, and manage your context store from the terminal.
 */

import readline from 'node:readline';
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';
import {
  saveContext, getContext,
  deleteContext, deleteProject, listProjects,
  listDiscussions, getStorePath, listGraphs,
} from './db.js';
import { getConfig, getConfigPath, saveConfig, saveSecretToKeytar } from './config.js';
import { randomBytes } from 'node:crypto';
import { search as unifiedSearch } from './search.js';
import { summarizeEntries } from './summarizer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

// ── ANSI color palette ────────────────────────────────────────────────────────
const C = {
  reset:    '\x1b[0m',
  bold:     '\x1b[1m',
  dim:      '\x1b[2m',
  italic:   '\x1b[3m',
  navy:     '\x1b[38;5;19m',
  dblue:    '\x1b[38;5;27m',
  blue:     '\x1b[38;5;33m',
  lblue:    '\x1b[38;5;39m',
  tcyan:    '\x1b[38;5;45m',
  cyan:     '\x1b[38;5;51m',
  green:    '\x1b[38;5;84m',
  yellow:   '\x1b[38;5;220m',
  red:      '\x1b[38;5;203m',
  purple:   '\x1b[38;5;135m',
  gray:     '\x1b[38;5;245m',
  darkgray: '\x1b[38;5;238m',
  white:    '\x1b[38;5;255m',
};

const R         = C.reset;
const color     = (c, t) => `${c}${t}${R}`;
const bold      = t => `${C.bold}${t}${R}`;
const dim       = t => `${C.dim}${t}${R}`;
const italic    = t => `${C.italic}${t}${R}`;
const ok        = t => color(C.green,    t);
const warn      = t => color(C.yellow,   t);
const bad       = t => color(C.red,      t);
const accent    = t => color(C.tcyan,    t);
const muted     = t => color(C.gray,     t);
const faint     = t => color(C.darkgray, t);
const brand     = t => color(C.cyan,     t);
const lblue     = t => color(C.lblue,    t);
const highlight = t => `${C.bold}${C.white}${t}${R}`;

const GRAD = [C.navy, C.dblue, C.blue, C.lblue, C.tcyan, C.cyan];
const gradLine = (text, step) => `${GRAD[Math.min(step, GRAD.length - 1)]}${text}${R}`;

function line(width = 74)  { return color(C.darkgray, '─'.repeat(width)); }
function dline(width = 74) { return color(C.dblue,    '═'.repeat(width)); }

function pill(text, tone = 'tcyan') {
  const cc = C[tone] || C.tcyan;
  return `${cc}\x1b[7m ${text} ${R}`;
}

function safeTags(tags) { return Array.isArray(tags) ? tags : []; }

// ── Logo ──────────────────────────────────────────────────────────────────────

const LOGO_LINES = [
  ' ██████╗ ██████╗ ███╗   ██╗████████╗███████╗██╗  ██╗████████╗',
  '██╔════╝██╔═══██╗████╗  ██║╚══██╔══╝██╔════╝╚██╗██╔╝╚══██╔══╝',
  '██║     ██║   ██║██╔██╗ ██║   ██║   █████╗   ╚███╔╝    ██║   ',
  '██║     ██║   ██║██║╚██╗██║   ██║   ██╔══╝   ██╔██╗    ██║   ',
  '╚██████╗╚██████╔╝██║ ╚████║   ██║   ███████╗██╔╝ ██╗   ██║   ',
  ' ╚═════╝ ╚═════╝ ╚═╝  ╚═══╝   ╚═╝   ╚══════╝╚═╝  ╚═╝   ╚═╝  ',
];

function printBanner() {
  console.log('');
  LOGO_LINES.forEach((l, i) => console.log(gradLine(l, i)));
  console.log('');
  console.log(`  ${bold(lblue('context-mcp'))}  ${faint('v' + pkg.version)}  ${faint('│')}  ${italic(muted('persistent memory + knowledge graph for AI'))}`);
  console.log(`  ${faint('store  ')} ${muted(getStorePath())}`);
  console.log(`  ${faint('config ')} ${muted(getConfigPath())}`);
  console.log('');
}

// ── Section header ────────────────────────────────────────────────────────────

function printSection(title, meta = '') {
  const metaPart = meta ? `  ${faint(meta)}` : '';
  console.log('');
  console.log(`  ${bold(lblue(title.toUpperCase()))}${metaPart}`);
  console.log(`  ${color(C.darkgray, '─'.repeat(62))}`);
}

// ── Help ──────────────────────────────────────────────────────────────────────

function printUsage() {
  printBanner();

  // Terminal commands (ctx ...)
  printSection('Terminal commands', 'run from your shell');
  const cmd = (c, desc) => console.log(`  ${accent(c.padEnd(40))} ${faint(desc)}`);
  cmd('ctx',                           'open interactive mode');
  cmd('ctx list [project]',            'list entries + discussions + graphs');
  cmd('ctx search <query>',            'keyword → semantic fallback search');
  cmd('ctx add',                       'add entry interactively');
  cmd('ctx delete <id-prefix>',        'delete one entry');
  cmd('ctx delete project <name|id>',  'delete all entries for a project');
  cmd('ctx summary [project]',         'summarize recent entries');
  cmd('ctx projects',                  'show all projects + graphs');
  cmd('ctx discuss [project]',         'show discussions');
  cmd('ctx benchmark',                 'token savings report (memory + graph)');
  console.log('');
  cmd('ctx install --initial',         'install / update Node.js + Python (codegraph) deps');
  cmd('ctx install --<platform>',      'write MCP config + skill/rules for an AI platform');
  cmd('ctx install --all',             'install for all platforms at once');
  cmd('ctx online [--port N]',         'start HTTP server for Claude.ai / ChatGPT');
  cmd('ctx online --close',            'stop the running HTTP server');
  cmd('ctx settings',                  'view and edit config (port, host, client id/secret)');
  cmd('ctx update',                    'check for and apply latest version');
  cmd('ctx help',                      'show this screen');
  console.log('');

  // Interactive mode commands (no ctx prefix)
  printSection('Interactive mode', 'type these inside  ctx  (no "ctx" prefix)');
  const icmd = (c, desc) => console.log(`  ${accent(c.padEnd(40))} ${faint(desc)}`);
  icmd('list [project]',               'list entries');
  icmd('search <query>',               'search context');
  icmd('add',                          'add entry');
  icmd('projects',                     'show all projects');
  icmd('discuss [project]',            'show discussions');
  icmd('summary [project]',            'summarize recent entries');
  icmd('benchmark',                    'token savings report');
  icmd('install --<platform>',         'install for a platform');
  icmd('settings',                     'edit config');
  icmd('clear',                        'clear screen');
  icmd('exit / quit / q',              'exit interactive mode');
  console.log('');
}
function clearScreen() {
  // \x1b[2J = clear screen, \x1b[3J = clear scrollback, \x1b[H = cursor home
  process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
}

// ── List (grouped by project) ─────────────────────────────────────────────────

function cmdList(args) {
  const filterProject  = args[0];
  const entries        = getContext({ project: filterProject, limit: 100 });
  const allDiscussions = listDiscussions({ project: filterProject });
  const allGraphs      = listGraphs();
  const projectRegistry = new Map(listProjects().map(p => [p.name, p]));

  printSection('Context', filterProject ? `project: ${filterProject}` : 'all projects');

  // Build per-project map
  const projects = {};
  for (const entry of entries) {
    const p = entry.project || 'global';
    if (!projects[p]) projects[p] = { contexts: [], discussions: [] };
    projects[p].contexts.push(entry);
  }
  for (const disc of allDiscussions) {
    const p = disc.project || 'global';
    if (!projects[p]) projects[p] = { contexts: [], discussions: [] };
    projects[p].discussions.push(disc);
  }

  const projectNames = Object.keys(projects).sort();

  if (!projectNames.length) {
    console.log(`  ${faint('no entries, discussions, or graphs found')}`);
    console.log('');
    return;
  }

  for (const projectName of projectNames) {
    const pData     = projects[projectName];
    const graph     = _graphForProject(allGraphs, projectName);
    const activeD   = pData.discussions.filter(d => d.status === 'active').length;
    const totalSecs = (pData.contexts.length > 0 ? 1 : 0) + (pData.discussions.length > 0 ? 1 : 0) + (graph ? 1 : 0);
    let   secIdx    = 0;

    const projReg  = projectRegistry.get(projectName);
    const projIdStr = projReg?.id ? faint('  id:' + projReg.id.slice(0, 8)) : '';
    console.log(`\n  ${color(C.dblue, '◆')} ${bold(lblue(projectName))}${projIdStr}  ${faint(`${pData.contexts.length} entries · ${pData.discussions.length} discussions`)}${activeD ? `  ${warn('● ' + activeD + ' active')}` : ''}`);
    console.log(`  ${color(C.darkgray, '│')}`);

    // ── Graph ────────────────────────────────────────────────────────────────
    if (graph) {
      secIdx++;
      const isLast  = secIdx === totalSecs;
      const builtAt = (graph.builtAt || '').slice(0, 10);
      console.log(`  ${color(C.darkgray, isLast ? '└─' : '├─')} ${accent('⬡')} ${muted('graph')}  ${faint(`${graph.nodes}n · ${graph.edges}e · ${graph.communities} clusters · ${builtAt}`)}`);
      if (!isLast) console.log(`  ${color(C.darkgray, '│')}`);
    }

    // ── Context entries ───────────────────────────────────────────────────────
    if (pData.contexts.length) {
      secIdx++;
      const isLast = secIdx === totalSecs;
      console.log(`  ${color(C.darkgray, isLast ? '└─' : '├─')} ${muted('memory')}  ${faint(pData.contexts.length + ' entries')}`);
      pData.contexts.forEach((item, i) => {
        const br   = i === pData.contexts.length - 1 ? '└─' : '├─';
        const date = (item.createdAt || '').slice(0, 10);
        const type = item.type || 'note';
        const id   = item.id.slice(0, 8);
        const tags = safeTags(item.tags);
        const pipe = isLast ? ' ' : '│';
        console.log(`  ${color(C.darkgray, pipe)}  ${color(C.darkgray, br)} ${pill(type)}  ${bold(item.title || '(no title)')}  ${faint('id:' + id)}  ${faint(date)}`);
        if (tags.length) console.log(`  ${color(C.darkgray, pipe)}     ${faint(tags.map(t => '#' + t).join(' '))}`);
      });
      if (!isLast) console.log(`  ${color(C.darkgray, '│')}`);
    }

    // ── Discussions ───────────────────────────────────────────────────────────
    if (pData.discussions.length) {
      secIdx++;
      const isLast = secIdx === totalSecs;
      console.log(`  ${color(C.darkgray, isLast ? '└─' : '├─')} ${muted('discussions')}  ${faint(pData.discussions.length + ' total')}`);
      pData.discussions.forEach((disc, i) => {
        const br    = i === pData.discussions.length - 1 ? '└─' : '├─';
        const sc    = disc.status === 'done' ? 'green' : 'tcyan';
        const steps = disc.stepsSummary?.total ? faint(` ${disc.stepsSummary.done}/${disc.stepsSummary.total}`) : '';
        const pipe  = isLast ? ' ' : '│';
        console.log(`  ${color(C.darkgray, pipe)}  ${color(C.darkgray, br)} ${warn(disc.status === 'active' ? '●' : '○')} ${bold(disc.name)}  ${pill(disc.status, sc)}  ${faint(disc.type || 'plan')}${steps}`);
        if (disc.description) console.log(`  ${color(C.darkgray, pipe)}     ${faint(disc.description)}`);
      });
    }
  }

  // Orphan graphs (no matching project)
  const orphanGraphs = allGraphs.filter(g => !projectNames.some(p => _graphForProject([g], p)));
  if (orphanGraphs.length) {
    console.log(`\n  ${color(C.dblue, '◇')} ${muted('other graphs')}`);
    for (const g of orphanGraphs) {
      const pathShort = g.path.replace(/\\/g, '/').split('/').slice(-2).join('/');
      console.log(`    ${accent('⬡')} ${bold(pathShort)}  ${faint(`${g.nodes}n · ${g.edges}e · ${g.communities} clusters`)}`);
    }
  }

  console.log('');
  console.log(line());
  console.log(faint(`  ${entries.length} entries  ·  ${allDiscussions.length} discussions  ·  ${allGraphs.length} graphs  ·  ${projectNames.length} projects`));
}

// ── Search ────────────────────────────────────────────────────────────────────

function cmdSearch(args) {
  const query = args.join(' ');
  if (!query) { console.log(bad('  usage: ctx search <query>')); return; }

  let results = unifiedSearch({ mode: 'keyword', query, limit: 10 });
  const mode  = results.length ? 'keyword' : 'semantic';
  if (!results.length) results = unifiedSearch({ mode: 'semantic', query, limit: 10 });

  printSection('Search', `${mode} · "${query}"`);
  if (!results.length) { console.log(`  ${faint('no results')}`); return; }

  results.forEach((entry, index) => {
    const score  = entry.similarity !== undefined ? ok(` ${Math.round(entry.similarity * 100)}%`) : '';
    const date   = (entry.createdAt || '').slice(0, 10);
    const id     = entry.id.slice(0, 8);
    const type   = entry.type || 'note';
    const isLast = index === results.length - 1;
    console.log(`  ${color(C.darkgray, isLast ? '└─' : '├─')} ${bold(entry.title || '(no title)')}${score}  ${pill(type)}  ${faint('id:' + id)}  ${faint(date)}`);
  });
  console.log('');
  console.log(line());
}

// ── Projects ──────────────────────────────────────────────────────────────────

function cmdProjects() {
  const projectList = listProjects();
  const graphs      = listGraphs();
  const allDiscs    = listDiscussions({});
  printSection('Projects');
  if (!projectList.length) { console.log(`  ${faint('no projects yet')}`); return; }

  for (const project of projectList) {
    const entries   = getContext({ project: project.name, limit: 3, compact: true }).filter(e => e.status !== 'archived');
    const discs     = allDiscs.filter(d => (d.project || 'global') === project.name);
    const activeD   = discs.filter(d => d.status === 'active');
    const graph     = _graphForProject(graphs, project.name);

    const barLen = Math.min(Math.ceil(project.count / 2), 24);
    const bar    = color(C.dblue, '█'.repeat(barLen)) + color(C.darkgray, '░'.repeat(24 - barLen));

    const idTag = project.id ? faint('  id:' + project.id.slice(0, 8)) : '';
    console.log(`\n  ${color(C.dblue, '◆')} ${bold(lblue(project.name))}${idTag}  ${bar}  ${faint(project.count + ' entries')}`);
    console.log(`  ${color(C.darkgray, '│')}`);

    // Graph status
    if (graph) {
      const builtAt = (graph.builtAt || '').slice(0, 10);
      console.log(`  ${color(C.darkgray, '├─')} ${accent('⬡')} ${muted('graph')}  ${faint(`${graph.nodes}n · ${graph.edges}e · ${graph.communities} clusters · ${builtAt}`)}`);
    } else {
      console.log(`  ${color(C.darkgray, '├─')} ${faint('⬡ no graph')}`);
    }

    // Recent context
    if (entries.length) {
      console.log(`  ${color(C.darkgray, '├─')} ${muted('recent')}`);
      entries.forEach((e, i) => {
        const br   = i === entries.length - 1 && !activeD.length ? '└─' : '├─';
        const type = e.type || 'note';
        const date = (e.createdAt || '').slice(0, 10);
        console.log(`  ${color(C.darkgray, '│')}  ${color(C.darkgray, br)} ${pill(type)}  ${bold(e.title || '(no title)')}  ${faint(date)}`);
      });
    }

    // Active discussions
    if (activeD.length) {
      console.log(`  ${color(C.darkgray, '├─')} ${muted('discussions')}`);
      activeD.forEach((d, i) => {
        const br    = i === activeD.length - 1 ? '└─' : '├─';
        const steps = d.stepsSummary?.total ? faint(` ${d.stepsSummary.done}/${d.stepsSummary.total}`) : '';
        console.log(`  ${color(C.darkgray, '│')}  ${color(C.darkgray, br)} ${warn('●')} ${bold(d.name)}  ${faint(d.type || 'plan')}${steps}`);
      });
    }

    console.log(`  ${color(C.darkgray, '│')}`);
  }

  console.log('');
  console.log(line());
  console.log(faint(`  ${projectList.length} projects  ·  ${projectList.reduce((a, p) => a + p.count, 0)} entries  ·  ${graphs.length} graphs`));
  console.log('');
}

// ── Discussions ───────────────────────────────────────────────────────────────

function cmdDiscussions(args) {
  const filterProject = args[0];
  const discussions   = listDiscussions({ project: filterProject });
  printSection('Discussions', filterProject || 'all projects');

  if (!discussions.length) {
    console.log(`  ${faint('no discussions yet')}`);
    return;
  }

  const byType = {};
  for (const disc of discussions) {
    const t = disc.type || 'plan';
    if (!byType[t]) byType[t] = [];
    byType[t].push(disc);
  }

  for (const [type, items] of Object.entries(byType)) {
    console.log(`\n  ${color(C.dblue, '◆')} ${bold(lblue(type.toUpperCase()))}  ${faint(items.length + '')}`);
    items.forEach((disc, i) => {
      const isLast = i === items.length - 1;
      const sc     = disc.status === 'done' ? 'green' : 'tcyan';
      const steps  = disc.stepsSummary?.total
        ? faint(`  ${disc.stepsSummary.done}/${disc.stepsSummary.total} steps`)
        : '';
      const tags   = safeTags(disc.tags).map(t => pill(t, 'purple')).join(' ');
      console.log(`    ${color(C.darkgray, isLast ? '└─' : '├─')} ${bold(disc.name)}  ${pill(disc.status, sc)}${steps}  ${tags}`);
      if (disc.description) console.log(`    ${color(C.darkgray, isLast ? '  ' : '│')}   ${faint(disc.description)}`);
    });
  }

  console.log('');
  console.log(line());
  console.log(faint(`  ${discussions.length} discussion(s)`));
}

// ── Summary ───────────────────────────────────────────────────────────────────

function cmdSummary(args) {
  const project = args[0];
  const entries = getContext({ project, limit: 50 });
  printSection('Summary', project || 'global');
  if (!entries.length) { console.log(`  ${faint('no entries to summarize')}`); return; }

  const md = summarizeEntries(entries, { project: project || 'global' });
  const rendered = md
    .replace(/^## (.+)/gm,     (_, t) => `\n${bold(lblue(t))}`)
    .replace(/^### (.+)/gm,    (_, t) => `\n${accent(t)}`)
    .replace(/\*\*(.+?)\*\*/g, (_, t) => bold(t))
    .replace(/`([^`]+)`/g,     (_, t) => warn(t))
    .replace(/^- /gm,          '  • ');
  console.log(rendered.trim());
  console.log('');
}

// ── Benchmark ────────────────────────────────────────────────────────────────


function _walkBytes(dirPath) {
  const walkScript =
    `const fs=require('fs'),path=require('path');` +
    `function walk(d,t=0){try{for(const f of fs.readdirSync(d)){` +
    `const p=path.join(d,f);try{const s=fs.statSync(p);` +
    `if(s.isDirectory()&&!['node_modules','.git','codegraph-cache','.venv','venv','__pycache__','dist','build','.next'].includes(f))t+=walk(p);` +
    `else if(s.isFile()&&/\\.(js|jsx|ts|tsx|py|json|md|yaml|yml|toml|sh|bash|env|txt|css|html|sql|go|rs|java|rb|php|c|cpp|h)$/.test(f)&&!/^(package-lock|uv\.lock|yarn\.lock|Pipfile\.lock|poetry\.lock)$/.test(path.basename(f,path.extname(f))+path.extname(f)))t+=s.size;}catch{}}}catch{}return t;}` +
    `console.log(walk(${JSON.stringify(dirPath)}));`;
  const res = spawnSync('node', ['-e', walkScript], { encoding: 'utf8', timeout: 8000 });
  return res.stdout ? parseInt(res.stdout.trim()) : null;
}

function _sampleQueryTokens(graphPath) {
  const questions = ['what does the server do', 'how is the graph built', 'what calls save'];
  const sizes = [];
  for (const q of questions) {
    const req = JSON.stringify({ tool: 'codegraph_query', args: { path: graphPath, question: q, token_budget: 2000 } });
    const res = spawnSync('uv', ['run', 'python', '-m', 'codegraph'],
      { input: req, encoding: 'utf8', cwd: process.cwd(), timeout: 12000 });
    if (res.stdout) { try { const r = JSON.parse(res.stdout); if (!r.error) sizes.push(res.stdout.length); } catch {} }
  }
  return { avgTok: sizes.length ? Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length / 4) : 472, measured: sizes.length > 0 };
}

function cmdBenchmark() {
  const graphs   = listGraphs();
  const projects = listProjects();
  printSection('Benchmark', 'real token savings');

  const RESUME_LIMIT = 15;
  const COMPACT_AT   = 50;

  // ── Measure entry sizes from actual stored data ──────────────────────────────
  const allEntries   = getContext({ limit: 500, compact: false });
  const totalEntries = allEntries.length;
  let avgFullTok = 155, avgCompactTok = 50;
  if (allEntries.length) {
    const fullSizes    = allEntries.map(e => JSON.stringify(e).length);
    const compactSizes = allEntries.map(e =>
      ([e.title || '', (e.content || '').slice(0, 200), (e.tags || []).join(' ')].join(' ')).length);
    avgFullTok    = Math.round(fullSizes.reduce((a, b) => a + b, 0) / fullSizes.length / 4);
    avgCompactTok = Math.round(compactSizes.reduce((a, b) => a + b, 0) / compactSizes.length / 4);
  }

  // ── Run graph queries once, reuse in both sections ────────────────────────────
  let avgQueryTok = 472, queryMeasured = false;
  if (graphs.length) {
    const r = _sampleQueryTokens(graphs[0].path);
    avgQueryTok   = r.avgTok;
    queryMeasured = r.measured;
  }

  // ── Corpus size (run once) ────────────────────────────────────────────────────
  let corpusToks = null;
  if (graphs.length) {
    const bytes = _walkBytes(graphs[0].path);
    if (bytes) corpusToks = Math.round(bytes / 4);
  }

  // ── Memory ───────────────────────────────────────────────────────────────────
  // Without context-mcp: AI reads all entries at full size every conversation
  // With context-mcp:    AI loads min(15, N) entries as compact previews via resume
  console.log(`\n  ${bold(lblue('Memory'))}  ${faint('measured from actual stored entries')}`);
  if (totalEntries) {
    const resumeCount   = Math.min(RESUME_LIMIT, totalEntries);
    const withoutMemTok = totalEntries * avgFullTok;         // load all entries full
    const withMemTok    = resumeCount  * avgCompactTok;      // resume: compact previews only
    const memSaved      = withoutMemTok - withMemTok;
    const memReduction  = (withoutMemTok / withMemTok).toFixed(1);
    const memPct        = ((1 - withMemTok / withoutMemTok) * 100).toFixed(1);

    console.log(`    ${faint('avg entry size (full):   ')} ${muted(avgFullTok)} tok  ${faint('(measured)')}`);
    console.log(`    ${faint('avg entry size (compact):')} ${muted(avgCompactTok)} tok  ${faint('(measured)')}`);
    console.log(`    ${faint('stored:                  ')} ${muted(totalEntries)} entries  ${faint('across')} ${muted(projects.length)} project(s)`);
    console.log(`    ${faint('without — load all full: ')} ${warn('~' + withoutMemTok.toLocaleString('en-US'))} tokens`);
    console.log(`    ${faint('with    — resume compact:')} ${ok('~' + withMemTok.toLocaleString('en-US'))} tokens  ${faint(`(${resumeCount} of ${totalEntries} entries)`)}`);
    console.log(`    ${faint('saved per chat:          ')} ${ok('~' + memSaved.toLocaleString('en-US'))} tokens  ${highlight(memReduction + '×')}  ${ok(memPct + '%')} reduction`);
    console.log(`    ${faint('auto-compact at:         ')} ${faint(COMPACT_AT + ' entries → oldest summarized to 1')}`);
    console.log('');
    for (const p of projects) {
      const pToks  = p.count * avgFullTok;
      const barLen = Math.min(Math.ceil(p.count / 2), 24);
      const bar    = color(C.dblue, '█'.repeat(barLen)) + color(C.darkgray, '░'.repeat(24 - barLen));
      console.log(`    ${color(C.darkgray, '·')} ${muted(p.name.padEnd(22))} ${bar}  ${faint(p.count + ' entries · ~' + pToks.toLocaleString('en-US') + ' tok full')}`);
    }
  } else {
    console.log(`    ${faint('no entries yet')}`);
  }

  // ── CodeGraph ─────────────────────────────────────────────────────────────────
  // Without context-mcp: AI reads all source files to answer structural questions
  // With context-mcp:    AI calls codegraph_query → focused NODE/EDGE subgraph
  console.log(`\n  ${bold(lblue('CodeGraph'))}  ${faint('measured from live graph queries')}`);
  if (!graphs.length) {
    console.log(`    ${faint('no graphs — run codegraph_build first')}`);
  } else {
    for (const g of graphs) {
      const pathShort  = g.path.replace(/\\/g, '/').split('/').slice(-2).join('/');
      const builtAt    = (g.builtAt || '').slice(0, 10);
      const graphReduce = corpusToks ? (corpusToks / avgQueryTok).toFixed(0) + '×' : null;
      const graphPct    = corpusToks ? ((1 - avgQueryTok / corpusToks) * 100).toFixed(2) : null;

      console.log(`\n    ${accent('⬡')} ${bold(pathShort)}  ${faint(builtAt)}`);
      console.log(`      ${faint('nodes:')} ${muted(g.nodes)}  ${faint('edges:')} ${muted(g.edges)}  ${faint('clusters:')} ${muted(g.communities)}`);
      if (corpusToks) console.log(`      ${faint('without — read all files:')} ${warn('~' + corpusToks.toLocaleString('en-US'))} tokens  ${faint('(all source + config + doc files)')}`);
      console.log(`      ${faint('with    — graph query:   ')} ${ok('~' + avgQueryTok.toLocaleString('en-US'))} tokens  ${faint(queryMeasured ? '(avg of 3 live queries)' : '(calibrated fallback)')}`);
      if (graphReduce) console.log(`      ${faint('saved per query:         ')} ${highlight(graphReduce)}  ${ok(graphPct + '%')} fewer tokens`);
    }
  }

  // ── Combined ──────────────────────────────────────────────────────────────────
  // Without: read all files (no graph) + load all entries full (no memory system)
  // With:    compact resume (memory) + one graph query (codegraph)
  if (graphs.length) {
    const resumeCount   = Math.min(RESUME_LIMIT, totalEntries);
    const withMemTok    = resumeCount * avgCompactTok;
    const withMcp       = withMemTok + avgQueryTok;
    const withoutMemTok = totalEntries * avgFullTok;
    const withoutMcp    = withoutMemTok + (corpusToks || graphs[0].nodes * 80);
    const totalRed      = withoutMcp > 0 ? (withoutMcp / withMcp).toFixed(0) : '—';
    const totalPct      = withoutMcp > 0 ? ((1 - withMcp / withoutMcp) * 100).toFixed(2) : '—';

    console.log(`\n  ${bold(lblue('Combined'))}  ${faint('per conversation')}`);
    console.log(`    ${faint('without context-mcp:  ')} ${warn('~' + withoutMcp.toLocaleString('en-US'))} tokens  ${faint('(all entries full + all files read directly)')}`);
    console.log(`    ${faint('with context-mcp:     ')} ${ok('~' + withMcp.toLocaleString('en-US'))} tokens  ${faint('(compact resume + 1 graph query)')}`);
    console.log(`    ${faint('total reduction:      ')} ${highlight(totalRed + '×')}  ${ok(totalPct + '%')} fewer tokens`);
  }

  console.log('');
  console.log(line());
  console.log(faint('  token estimate: chars ÷ 4  ·  corpus = all source/config/doc files (excl. lock files, .venv, node_modules)'));
}


// ── Install ───────────────────────────────────────────────────────────────────

const TPLS = join(__dirname, 'templates');

function _tpl(name) {
  const p = join(TPLS, name);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

function _writeFile(filePath, content, label) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, content, 'utf8');
  console.log(`  ${ok('✓')} ${label.padEnd(28)} ${faint(filePath.replace(/\\/g, '/'))}`);
}

// Entries ctx install writes into project roots — add to user's global gitignore if one exists
const _GLOBAL_GITIGNORE_ENTRIES = [
  // Installed instruction files
  'CLAUDE.md',
  'GEMINI.md',
  'AGENTS.md',
  // AI/IDE platform config folders (context-mcp specific — safe to ignore globally)
  '.claude/',
  '.cursor/',
  '.vscode/',
  '.gemini/',
  '.codex/',
  '.windsurf/',
  // Build outputs and session artifacts
  'codegraph-cache/',
  '.mcp.json',
];

// Match a graph to a project by exact last-path-component comparison (not substring)
function _graphForProject(graphs, projectName) {
  const norm = p => (p || '').toLowerCase().replace(/\\/g, '/').replace(/\/$/, '');
  const name = projectName.toLowerCase();
  return graphs.find(g => norm(g.path).split('/').pop() === name) || null;
}

const _PROJECT_GITIGNORE_ENTRIES = [
  '.claude/', '.cursor/', '.vscode/', '.gemini/', '.codex/',
  'codegraph-cache/', '.mcp.json', 'CLAUDE.md', 'GEMINI.md', 'AGENTS.md',
];

function _updateProjectGitignore(projectDir) {
  const giPath = join(projectDir, '.gitignore');
  const existing = existsSync(giPath) ? readFileSync(giPath, 'utf8') : '';
  const lines = existing.split(/\r?\n/);
  const missing = _PROJECT_GITIGNORE_ENTRIES.filter(e => !lines.includes(e));
  if (!missing.length) return;
  const block = '\n# context-mcp — written by ctx install\n' + missing.join('\n') + '\n';
  writeFileSync(giPath, (existing ? existing.trimEnd() : '') + block, 'utf8');
  console.log(`  ${ok('✓')} ${'project .gitignore'.padEnd(28)} ${faint(giPath.replace(/\\/g, '/'))}`);
  for (const e of missing) console.log(`      ${faint('+ ' + e)}`);
}

function _updateGlobalGitignore() {
  // Resolve global gitignore path: git config > ~/.gitignore_global > ~/.gitignore
  let giPath = null;
  const gitCfg = spawnSync('git', ['config', '--global', 'core.excludesFile'], { encoding: 'utf8' });
  if (gitCfg.status === 0 && gitCfg.stdout.trim()) {
    const resolved = gitCfg.stdout.trim().replace(/^~/, homedir());
    if (existsSync(resolved)) giPath = resolved;
  }
  if (!giPath) {
    for (const candidate of [join(homedir(), '.gitignore_global'), join(homedir(), '.gitignore')]) {
      if (existsSync(candidate)) { giPath = candidate; break; }
    }
  }
  if (!giPath) return; // no global gitignore — skip silently

  const existing = readFileSync(giPath, 'utf8');
  const lines = existing.split(/\r?\n/);
  const missing = _GLOBAL_GITIGNORE_ENTRIES.filter(e => !lines.includes(e));
  if (!missing.length) return;

  const block = '\n# context-mcp — written by ctx install\n' + missing.join('\n') + '\n';
  writeFileSync(giPath, existing.trimEnd() + block, 'utf8');
  console.log(`  ${ok('✓')} ${'global gitignore'.padEnd(28)} ${faint(giPath.replace(/\\/g, '/'))}`);
  for (const e of missing) console.log(`      ${faint('+ ' + e)}`);
}

function _writeCommands(baseDir) {
  const cmdsDir = join(TPLS, 'commands');
  const destDir = join(baseDir, '.claude', 'commands');
  for (const [name, label] of [
    ['context-resume.md', '/context-resume'],
    ['graph-build.md',    '/graph-build'],
    ['save-context.md',   '/save-context'],
  ]) {
    const src = join(cmdsDir, name);
    if (existsSync(src)) {
      _writeFile(join(destDir, name), readFileSync(src, 'utf8'), label);
    }
  }
}

const MCP_SERVER_CMD = { command: 'npx', args: ['-y', 'context-mcp-server@latest'] };

const PLATFORMS = {
  claude: {
    label: 'Claude Code',
    restartNote: 'Type /context-resume in Claude Code to start using context-mcp.',
    install(dir, scope) {
      // Install as a skill (global, works across all projects) instead of a flat CLAUDE.md
      const skillSrc = join(TPLS, 'skills', 'SKILL.md');
      const skillDest = join(homedir(), '.claude', 'skills', 'context-mcp', 'SKILL.md');
      if (existsSync(skillSrc)) {
        _writeFile(skillDest, readFileSync(skillSrc, 'utf8'), '~/.claude/skills/context-mcp/');
      }
      // Slash commands are always user-global (not project-scoped)
      _writeCommands(homedir());
      // Register via claude CLI so the server is trusted immediately (no manual trust prompt)
      const scopeFlag = scope === 'global' ? 'user' : 'project';
      const reg = spawnSync(
        'claude', ['mcp', 'add', '--scope', scopeFlag, 'context-mcp', '--', 'npx', '-y', 'context-mcp-server@latest'],
        { encoding: 'utf8', shell: true },
      );
      if (reg.status === 0) {
        console.log(`  ${ok('✓')} ${'registered via claude mcp add'.padEnd(28)} ${faint('scope: ' + scopeFlag)}`);
      } else {
        console.log(`  ${faint('ℹ')} claude CLI not found — open Claude Code and trust context-mcp when prompted`);
      }
    },
  },
  cursor: {
    label: 'Cursor',
    restartNote: 'Restart Cursor to load the new MCP server.',
    install(dir, scope) {
      const mcpJson = JSON.stringify({ mcpServers: { 'context-mcp': MCP_SERVER_CMD } }, null, 2);
      _writeFile(join(dir, '.cursor', 'mcp.json'), mcpJson, '.cursor/mcp.json');
      if (scope === 'project') {
        const mdc = _tpl('cursor-rules.mdc');
        if (mdc) _writeFile(join(dir, '.cursor', 'rules', 'context-mcp.mdc'), mdc, '.cursor/rules/context-mcp.mdc');
      }
      // Try to enable via cursor CLI (enable/disable only — no add command)
      const reg = spawnSync(
        'cursor', ['agent', 'mcp', 'enable', 'context-mcp'],
        { encoding: 'utf8', shell: true },
      );
      if (reg.status === 0) {
        console.log(`  ${ok('✓')} ${'enabled via cursor agent mcp'.padEnd(28)}`);
      }
    },
  },
  vscode: {
    label: 'VS Code Copilot',
    restartNote: 'Reload VS Code window (Ctrl+Shift+P → "Reload Window").',
    install(dir) {
      const mcpJson = JSON.stringify({
        servers: { 'context-mcp': { type: 'stdio', ...MCP_SERVER_CMD } },
      }, null, 2);
      _writeFile(join(dir, '.vscode', 'mcp.json'), mcpJson, '.vscode/mcp.json');
    },
  },
  gemini: {
    label: 'Gemini CLI',
    restartNote: 'Restart your Gemini CLI session.',
    install(dir, scope) {
      const cfg = JSON.stringify({ mcpServers: { 'context-mcp': MCP_SERVER_CMD } }, null, 2);
      _writeFile(join(dir, '.gemini', 'settings.json'), cfg, '.gemini/settings.json');
      if (scope === 'project') {
        const md = _tpl('GEMINI.md');
        if (md) _writeFile(join(dir, 'GEMINI.md'), md, 'GEMINI.md');
      }
    },
  },
  codex: {
    label: 'Codex CLI',
    restartNote: 'Restart your Codex CLI session.',
    install(dir, scope) {
      const toml = `[[mcp_servers]]\nname    = "context-mcp"\ncommand = "npx"\nargs    = ["-y", "context-mcp-server@latest"]\n`;
      _writeFile(join(dir, '.codex', 'config.toml'), toml, '.codex/config.toml');
      if (scope === 'project') {
        const md = _tpl('AGENTS.md');
        if (md) _writeFile(join(dir, 'AGENTS.md'), md, 'AGENTS.md');
      }
      // Register via codex CLI so server is active immediately
      const reg = spawnSync(
        'codex', ['mcp', 'add', 'context-mcp', '--', 'npx', '-y', 'context-mcp-server@latest'],
        { encoding: 'utf8', shell: true },
      );
      if (reg.status === 0) {
        console.log(`  ${ok('✓')} ${'registered via codex mcp add'.padEnd(28)}`);
      } else {
        console.log(`  ${faint('ℹ')} codex CLI not found — server will load on next Codex session`);
      }
    },
  },
  windsurf: {
    label: 'Windsurf',
    restartNote: 'Restart Windsurf to load the updated MCP config.',
    install(dir) {
      const rules = _tpl('windsurf-rules.md');
      if (rules) _writeFile(join(dir, '.windsurf', 'rules', 'context-mcp.md'), rules, '.windsurf/rules/context-mcp.md');
      const globalCfgPath = join(homedir(), '.codeium', 'windsurf', 'mcp_config.json');
      let existing = {};
      try { existing = JSON.parse(readFileSync(globalCfgPath, 'utf8')); } catch {}
      existing.mcpServers = existing.mcpServers || {};
      existing.mcpServers['context-mcp'] = { command: 'npx', args: ['-y', 'context-mcp-server@latest'] };
      _writeFile(globalCfgPath, JSON.stringify(existing, null, 2), '~/.codeium/windsurf/mcp_config.json');
    },
  },
};

async function cmdInstall(args) {
  const flags = new Set(args.map(a => a.replace(/^--/, '')));
  const all     = flags.has('all');
  const initial = flags.has('initial');
  const keys  = all ? Object.keys(PLATFORMS) : Object.keys(PLATFORMS).filter(k => flags.has(k));

  if (initial) {
    printSection('Install', 'install / update');
    console.log('');

    const __dirname_init = dirname(fileURLToPath(import.meta.url));
    const pkgRootInit = join(__dirname_init, '..');

    // Node.js packages
    console.log(`  ${bold(lblue('Node.js packages'))}`);
    const npmInstall = spawnSync('npm', ['install', '--omit=dev'], {
      cwd: pkgRootInit, encoding: 'utf8', shell: true,
    });
    if (npmInstall.status !== 0) {
      console.log(`  ${bad('✗')} npm install failed:\n${faint((npmInstall.stderr || npmInstall.stdout || '').trim())}`);
    } else {
      console.log(`  ${ok('✓')} Node.js dependencies installed`);
    }
    console.log('');

    // Python / uv (codegraph)
    console.log(`  ${bold(lblue('Python Codegraph'))}`);
    const uvCheck2 = spawnSync('uv', ['--version'], { encoding: 'utf8', shell: true });
    if (uvCheck2.error || uvCheck2.status !== 0) {
      console.log(`  ${bad('✗')} uv not found — install from ${accent('https://docs.astral.sh/uv/')} to enable codegraph`);
    } else {
      console.log(`  ${ok('✓')} uv found: ${faint(uvCheck2.stdout.trim())}`);
      // On Windows, an existing .venv contains a lib64 junction that uv can't remove — wipe it first
      if (process.platform === 'win32') {
        const venvPath = join(pkgRootInit, '.venv');
        spawnSync('cmd', ['/c', 'rmdir', '/s', '/q', venvPath], { encoding: 'utf8' });
      }
      const sync2 = spawnSync('uv', ['--directory', pkgRootInit, 'sync', '--no-dev'], { encoding: 'utf8' });
      if (sync2.status !== 0) {
        console.log(`  ${bad('✗')} uv sync failed:\n${faint((sync2.stderr || sync2.stdout || '').trim())}`);
      } else {
        console.log(`  ${ok('✓')} Python environment ready — codegraph enabled`);
      }
    }
    console.log('');
    return;
  }

  if (!keys.length) {
    printSection('Install');
    console.log(`  ${muted('Usage:')}  ctx install ${faint('[--initial] [--claude] [--cursor] [--vscode] [--gemini] [--codex] [--windsurf] [--all]')}`);
    console.log('');
    console.log(`  ${accent('--initial      ')}  ${faint('Install / update Node.js + Python (codegraph) deps')}`);
    console.log('');
    console.log(`  Writes MCP config file + AI instruction file for each selected platform.`);
    console.log(`  Files are written into the ${accent('current directory')} (your project root).`);
    console.log('');
    for (const [k, p] of Object.entries(PLATFORMS)) {
      console.log(`    ${accent(('--' + k).padEnd(14))}  ${faint(p.label)}`);
    }
    console.log(`    ${accent('--all          ')}  ${faint('All platforms at once')}`);
    console.log('');
    return;
  }

  // ── Scope prompt (skip for windsurf-only installs — it's always global) ──────
  const nonWindsurf = keys.filter(k => k !== 'windsurf');
  let scope = 'project';
  let baseDir = process.cwd();

  if (nonWindsurf.length > 0) {
    const rl  = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = q => new Promise(resolve => rl.question(`  ${accent('›')} ${muted(q)} `, resolve));

    printSection('Install', keys.map(k => PLATFORMS[k].label).join(', '));
    console.log('');
    console.log(`  ${muted('Install scope:')}`);
    console.log(`  ${accent('1.')} For this project  ${faint('(writes config into current directory)')}`);
    console.log(`  ${accent('2.')} Globally          ${faint('(writes config to your home directory)')}`);
    console.log('');
    const answer = (await ask('Choose (1/2) [1]:')).trim();
    rl.close();
    console.log('');

    if (answer === '2') {
      scope = 'global';
      baseDir = homedir();
    }
  } else {
    printSection('Install', keys.map(k => PLATFORMS[k].label).join(', '));
    console.log('');
  }

  for (const key of keys) {
    const platform = PLATFORMS[key];
    console.log(`  ${bold(lblue(platform.label))}`);
    const dir = key === 'windsurf' ? process.cwd() : baseDir;
    try {
      platform.install(dir, scope);
    } catch (err) {
      console.log(`  ${bad('✗')} failed: ${err.message}`);
    }
    if (platform.restartNote) {
      console.log(`  ${faint('→ ' + platform.restartNote)}`);
    }
    console.log('');
  }

  const destLabel = scope === 'global' ? homedir().replace(/\\/g, '/') : process.cwd().replace(/\\/g, '/');
  console.log(line());
  console.log(faint(`  ${keys.length} platform(s) installed  ·  scope: ${scope}  ·  ${destLabel}`));
  console.log('');

  // ── Project .gitignore — add context-mcp entries for this project ──────────
  _updateProjectGitignore(process.cwd());

  // ── Global gitignore — add context-mcp runtime files if global gitignore exists ──
  _updateGlobalGitignore();
  console.log('');

  // ── Python / uv setup (codegraph) ─────────────────────────────────────────
  console.log(`  ${bold(lblue('Python Codegraph'))}`);
  const uvCheck = spawnSync('uv', ['--version'], { encoding: 'utf8' });
  if (uvCheck.error || uvCheck.status !== 0) {
    console.log(`  ${bad('✗')} uv not found — install it from ${accent('https://docs.astral.sh/uv/')} to enable codegraph`);
    console.log('');
    return;
  }
  console.log(`  ${ok('✓')} uv found: ${faint(uvCheck.stdout.trim())}`);

  // Package root is one level up from src/
  const __dirname_cli = dirname(fileURLToPath(import.meta.url));
  const pkgRoot = join(__dirname_cli, '..');
  const sync = spawnSync('uv', ['--directory', pkgRoot, 'sync', '--no-dev'], { encoding: 'utf8' });
  if (sync.status !== 0) {
    console.log(`  ${bad('✗')} uv sync failed:\n${faint((sync.stderr || sync.stdout || '').trim())}`);
  } else {
    console.log(`  ${ok('✓')} Python environment ready — codegraph enabled`);
  }
  console.log('');
}

// ── Online ────────────────────────────────────────────────────────────────────

function _httpPidFile(port) {
  const dataDir = process.env.CONTEXT_MCP_DIR || join(homedir(), '.context-mcp');
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  return join(dataDir, `http-${port}.pid`);
}

// Check if something is actually listening on the port (cross-platform, reliable)
function _isPortListening(port) {
  const script = `const n=require('net'),s=n.createConnection({port:${port},host:'localhost'});s.setTimeout(500);s.on('connect',()=>{s.destroy();process.exit(0);});s.on('error',()=>process.exit(1));s.on('timeout',()=>{s.destroy();process.exit(1);});`;
  const r = spawnSync(process.execPath, ['-e', script], { timeout: 2000 });
  return r.status === 0;
}

function _storedPid(port) {
  const pidPath = _httpPidFile(port);
  if (!existsSync(pidPath)) return null;
  const pid = parseInt(readFileSync(pidPath, 'utf8').trim() || '0');
  return pid || null;
}

// Returns { status: 'running', pid } | { status: 'none' }
function _checkExistingHttpServer(port) {
  if (!_isPortListening(port)) {
    // Clean up stale PID file if present
    try { unlinkSync(_httpPidFile(port)); } catch {}
    return { status: 'none' };
  }
  const pid = _storedPid(port);
  return { status: 'running', pid };
}

function cmdOnline(args) {
  const portIdx = args.indexOf('--port');
  const port    = portIdx !== -1 && args[portIdx + 1] ? args[portIdx + 1] : null;
  const hostIdx = args.indexOf('--host');
  const host    = hostIdx !== -1 && args[hostIdx + 1] ? args[hostIdx + 1] : null;
  const git     = args.includes('--access-git');
  const restart = args.includes('--restart');
  const close   = args.includes('--close');

  let cfg;
  try { cfg = getConfig(); } catch { cfg = { client_id: 'context-mcp', client_secret: '(unavailable)', port: 3100, host: 'localhost' }; }

  const resolvedPort = port || cfg.port || 3100;
  const resolvedHost = host || cfg.host || 'localhost';

  printSection('Online', `HTTP MCP server → Claude.ai / ChatGPT`);
  console.log('');

  if (close) {
    const existing2 = _checkExistingHttpServer(resolvedPort);
    if (existing2.status === 'running') {
      if (existing2.pid) {
        try { process.kill(existing2.pid); } catch {}
      }
      try { unlinkSync(_httpPidFile(resolvedPort)); } catch {}
      const pidStr = existing2.pid ? `pid ${existing2.pid}  ·  ` : '';
      console.log(`  ${ok('✓')} ${bold('server stopped')}  ${faint(pidStr + 'port ' + resolvedPort)}\n`);
    } else {
      console.log(`  ${warn('–')} no server running on port ${resolvedPort}\n`);
    }
    return;
  }

  // Check if a server is already running on this port
  const existing = _checkExistingHttpServer(resolvedPort);
  if (existing.status === 'running') {
    if (!restart) {
      const pidStr = existing.pid ? `pid ${existing.pid}  ·  ` : '';
      console.log(`  ${ok('✓')} ${bold('already running')}  ${faint(pidStr + 'port ' + resolvedPort)}`);
      console.log(`  ${faint('Run')} ${accent('ctx online --restart')} ${faint('to force a restart')}\n`);
      return;
    }
    if (existing.pid) { try { process.kill(existing.pid); } catch {} }
    try { unlinkSync(_httpPidFile(resolvedPort)); } catch {}
    const stopMsg = existing.pid ? `stopped pid ${existing.pid}` : `port ${resolvedPort} was in use`;
    console.log(`  ${warn('⚠')} restarting  ${faint('(' + stopMsg + ')')}`);
    console.log('');
  }

  // Credentials
  console.log(`  ${faint('client id')}      ${accent(cfg.client_id)}`);
  console.log(`  ${faint('client secret')}  ${ok(cfg.client_secret)}`);
  console.log(`  ${faint('config')}         ${faint(getConfigPath())}`);
  console.log('');
  console.log(`  ${faint('endpoint')}  ${accent(`http://${resolvedHost}:${resolvedPort}`)}`);
  console.log(`  ${faint('oauth')}     ${faint('POST')} ${accent(`http://${resolvedHost}:${resolvedPort}/oauth/token`)}`);
  console.log('');
  console.log(`  ${faint('To connect Claude.ai / ChatGPT:')}`);
  console.log(`    ${faint('Settings → Integrations → Add MCP Connector')}`);
  console.log(`    ${faint('URL:')} ${accent(`http://${resolvedHost}:${resolvedPort}`)}`);
  console.log(`    ${faint('Use the client id and secret above when prompted')}`);
  console.log('');

  // Build args for the HTTP server
  const httpBin = join(__dirname, 'http.js');
  const spawnArgs = ['--port', String(resolvedPort)];
  if (host) spawnArgs.push('--host', resolvedHost);
  if (git)  spawnArgs.push('--access-git');

  // Spawn detached so HTTP server runs in background
  const child = spawn(process.execPath, [httpBin, ...spawnArgs], {
    detached: true,
    stdio:    'ignore',
    env:      { ...process.env },
  });
  child.unref();

  // Persist PID so next invocation can kill it
  try { writeFileSync(_httpPidFile(resolvedPort), String(child.pid)); } catch {}

  console.log(`  ${ok('✓')} ${bold('HTTP server started')}  ${faint('pid ' + child.pid + '  ·  port ' + resolvedPort)}`);
  console.log(`  ${faint('Run')} ${accent('ctx online')} ${faint('again to restart  ·  or')} ${faint('kill ' + child.pid)}\n`);
}

// ── Settings ─────────────────────────────────────────────────────────────────

async function cmdSettings(existingRl) {
  const rl  = existingRl || readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = q => new Promise(resolve => rl.question(`  ${accent('›')} ${muted(q)} `, resolve));

  printSection('Settings', getConfigPath());

  const FIELDS = [
    { key: 'client_id',     label: 'Client ID',     desc: 'OAuth client identifier' },
    { key: 'client_secret', label: 'Client Secret', desc: 'OAuth client secret (keep private)' },
    { key: 'port',          label: 'HTTP Port',      desc: 'Port for ctx online server', coerce: Number },
    { key: 'host',          label: 'Host',           desc: 'Bind address for ctx online server' },
    { key: 'access_git',    label: 'Access Git',     desc: 'Allow git tools (true/false)', coerce: v => v === 'true' },
  ];

  let cfg;
  try { cfg = getConfig(); } catch { cfg = {}; }

  // Display current values
  console.log('');
  FIELDS.forEach((f, i) => {
    const val = cfg[f.key];
    const display = f.key === 'client_secret' ? val?.slice(0, 8) + '...' : String(val ?? '');
    console.log(`  ${faint((i + 1) + '.')} ${muted(f.label.padEnd(16))} ${accent(display)}  ${faint(f.desc)}`);
  });
  console.log('');
  console.log(`  ${faint('Enter a number to edit, or press Enter to exit.')}`);
  console.log('');

  const choice = (await ask('Edit field (1-' + FIELDS.length + '):')).trim();

  const idx = parseInt(choice) - 1;
  if (isNaN(idx) || idx < 0 || idx >= FIELDS.length) {
    if (!existingRl) rl.close();
    console.log(`  ${faint('no changes made')}`);
    return;
  }

  const field = FIELDS[idx];
  const current = cfg[field.key];
  const newValRaw = (await ask(`${field.label} [${current}]:`)).trim();
  if (!existingRl) rl.close();

  if (!newValRaw) {
    console.log(`  ${faint('no changes made')}`);
    return;
  }

  const newVal = field.coerce ? field.coerce(newValRaw) : newValRaw;
  cfg[field.key] = newVal;
  saveConfig(cfg);
  console.log(`  ${ok('✓')} ${bold(field.label)} updated to ${accent(String(newVal))}`);
}

// ── Add ───────────────────────────────────────────────────────────────────────

async function cmdAdd(existingRl) {
  const rl  = existingRl || readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = q => new Promise(resolve => rl.question(`  ${accent('›')} ${muted(q)} `, resolve));

  printSection('Add Entry');
  const title   = await ask('Title (optional):');
  const content = await ask('Content:');
  const project = await ask('Project (blank = global):');
  const tagsRaw = await ask('Tags (comma-separated):');
  const type    = await ask('Type (note/decision/code/bug/architecture/config/error):');

  if (!existingRl) rl.close();
  if (!content.trim()) { console.log(`  ${bad('✗')} content required`); return; }

  const entry = saveContext({
    title:   title.trim(),
    content: content.trim(),
    project: project.trim() || 'global',
    tags:    tagsRaw.split(',').map(t => t.trim()).filter(Boolean),
    type:    type.trim() || 'note',
    source:  'cli',
  });

  console.log(`  ${ok('✓')} ${bold(entry.title || '(no title)')}  ${faint('id:' + entry.id.slice(0, 8))}`);
}

// ── Delete ────────────────────────────────────────────────────────────────────

function cmdDelete(args) {
  if (args[0] === 'project') {
    const nameOrId = args.slice(1).join(' ');
    if (!nameOrId) {
      console.log(`  ${bad('✗')} usage: ctx delete project <name|id>`);
      const projects = listProjects();
      if (projects.length) {
        console.log('');
        for (const p of projects) {
          const idStr = p.id ? faint(p.id.slice(0, 8)) : faint('built-in');
          console.log(`  ${faint('·')} ${muted(p.name)}  ${idStr}  ${faint(p.count + ' entries')}`);
        }
      }
      return;
    }
    const { deletedEntries, deletedDiscussions } = deleteProject(nameOrId);
    if (!deletedEntries && !deletedDiscussions) {
      // Try to give a helpful hint — list available projects
      const projects = listProjects();
      console.log(`  ${bad('✗')} no project matching "${nameOrId}"`);
      if (projects.length) {
        console.log(`  ${faint('available:')}`);
        for (const p of projects) {
          const idStr = p.id ? faint('  ' + p.id.slice(0, 8)) : faint('  built-in');
          console.log(`    ${muted(p.name)}${idStr}  ${faint(p.count + ' entries')}`);
        }
      }
    } else {
      const label = nameOrId.length === 36 ? nameOrId.slice(0, 8) : nameOrId;
      console.log(`  ${ok('✓')} deleted project "${label}"  ${faint(deletedEntries + ' entries removed')}`);
    }
    return;
  }

  const partial = args[0];
  if (!partial) {
    console.log(`  ${bad('✗')} usage: ctx delete <id-prefix>`);
    console.log(`  ${faint('       ctx delete project <name|id>')}`);
    return;
  }

  const entries = getContext({ limit: 1000 });
  const matches = entries.filter(e => e.id.startsWith(partial));

  if (!matches.length) {
    console.log(`  ${bad('✗')} no entry with id starting "${partial}"`);
    return;
  }
  if (matches.length > 1) {
    console.log(`  ${warn('!')} "${partial}" matches ${matches.length} entries — be more specific:`);
    for (const m of matches) console.log(`    ${faint(m.id.slice(0, 8))}  ${m.title || '(no title)'}`);
    return;
  }

  const match = matches[0];
  const { deleted } = deleteContext({ id: match.id });
  if (deleted) {
    console.log(`  ${ok('✓')} deleted ${bold(match.title || '(no title)')}  ${faint('id:' + match.id.slice(0, 8))}`);
  } else {
    console.log(`  ${bad('✗')} delete failed`);
  }
}
// ── Compact header (shown after screen clear in interactive mode) ─────────────

function printCompactHeader(cmdLabel = '') {
  const tag = cmdLabel ? `  ${faint('›')} ${muted(cmdLabel)}` : '';
  console.log(`\n  ${bold(lblue('context-mcp'))}  ${faint('v' + pkg.version)}${tag}\n`);
}

// ── Interactive mode ──────────────────────────────────────────────────────────

async function interactive() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  clearScreen();
  printBanner();

  const ask = () => new Promise(resolve => rl.question(`\n  ${color(C.dblue, '◆')} ${lblue('context')} ${faint('›')} `, resolve));

  while (true) {
    const input = (await ask()).trim();
    if (!input) continue;
    const [cmd, ...rest] = input.split(/\s+/);

    const runCmd = async () => {
      switch (cmd.toLowerCase()) {
        case 'exit': case 'quit': case 'q':
          rl.close(); printBye(); process.exit(0); break;
        case 'list': case 'ls':
          clearScreen(); printCompactHeader('list'); cmdList(rest); break;
        case 'search':
          clearScreen(); printCompactHeader('search'); cmdSearch(rest); break;
        case 'projects':
          clearScreen(); printCompactHeader('projects'); cmdProjects(); break;
        case 'discuss': case 'discussions':
          clearScreen(); printCompactHeader('discussions'); cmdDiscussions(rest); break;
        case 'summary':
          clearScreen(); printCompactHeader('summary'); cmdSummary(rest); break;
        case 'benchmark': case 'bench':
          clearScreen(); printCompactHeader('benchmark'); cmdBenchmark(); break;
        case 'install':
          clearScreen(); printCompactHeader('install'); await cmdInstall(rest); break;
        case 'online':
          clearScreen(); printCompactHeader('online'); cmdOnline(rest); break;
        case 'settings': case 'config':
          clearScreen(); printCompactHeader('settings'); await cmdSettings(rl); break;
        case 'add':
          clearScreen(); printCompactHeader('add'); await cmdAdd(rl); break;
        case 'delete': case 'del': case 'rm':
          clearScreen(); printCompactHeader('delete'); cmdDelete(rest); break;
        case 'help': case '?':
          clearScreen(); printUsage(); break;
        case 'clear': case 'cls':
          clearScreen(); printBanner(); break;
        default:
          console.log(`\n  ${bad('✗')} unknown command ${faint(cmd)}  ${dim('type help')}`);
      }
    };

    await runCmd();
  }
}

function printBye() {
  console.log(`\n  ${ok('✓')} ${bold(lblue('goodbye'))}  ${faint('keep building')}\n`);
}

// ── Update check ──────────────────────────────────────────────────────────────

async function checkForUpdate() {
  try {
    const result = spawnSync(
      'npm', ['view', 'context-mcp-server', 'version', '--json'],
      { encoding: 'utf8', timeout: 3000, shell: true },
    );
    if (result.status !== 0 || !result.stdout) return;
    const parsed = JSON.parse(result.stdout.trim());
    const latest = typeof parsed === 'string' ? parsed : String(parsed);
    const current = pkg.version;
    if (latest && latest !== current) {
      console.log(`  ${warn('↑')} ${bold('Update available')}  ${faint(current)} ${accent('→')} ${ok(latest)}  ${faint('run:')} ${accent('npm i -g context-mcp-server@latest')}`);
      console.log('');
    }
  } catch {}
}

// ── CLI entry point ───────────────────────────────────────────────────────────

(async () => {
  const [, , cmd, ...rest] = process.argv;

  switch ((cmd || '').toLowerCase()) {
    case 'list': case 'ls':
      cmdList(rest); break;
    case 'search':
      cmdSearch(rest); break;
    case 'projects':
      cmdProjects(); break;
    case 'discuss': case 'discussions':
      cmdDiscussions(rest); break;
    case 'summary':
      cmdSummary(rest); break;
    case 'benchmark': case 'bench':
      cmdBenchmark(); break;
    case 'install':
      await cmdInstall(rest);
      process.exit(0);
      break;
    case 'update': {
      printSection('Update');
      console.log('');
      const upd = spawnSync(
        'npm', ['install', '-g', 'context-mcp-server@latest'],
        { encoding: 'utf8', shell: true, stdio: 'inherit' },
      );
      if (upd.status === 0) {
        console.log(`\n  ${ok('✓')} ${bold('context-mcp updated to latest')}`);
      } else {
        console.log(`\n  ${bad('✗')} update failed — try: ${accent('npm i -g context-mcp-server@latest')}`);
      }
      console.log('');
      break;
    }
    case 'online':
      cmdOnline(rest); break;
    case 'settings': case 'config':
      await cmdSettings(); break;
    case 'add':
      await cmdAdd(); break;
    case 'delete': case 'del': case 'rm':
      cmdDelete(rest); break;
    case 'help': case '--help': case '-h':
      await checkForUpdate();
      printUsage();
      break;
    case '--version': case '-v':
      console.log(pkg.version); break;
    default:
      await checkForUpdate();
      await interactive();
  }
})();
