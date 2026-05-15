import { execSync } from 'node:child_process';
import { resolve as pathResolve } from 'node:path';
import { saveAutoContext } from '../hooks/autoContext.js';

const MAX_DIFF_LENGTH = 10000;

function runGit(cmd, cwd) {
  const dir = cwd || process.cwd();
  try {
    return execSync(`git ${cmd}`, { cwd: dir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    const msg = ((err.stderr || '') + (err.stdout || '') || err.message || '').trim();
    throw new Error(`git ${cmd.split(' ')[0]} failed: ${msg}`);
  }
}

export const definitions = [
  {
    name: 'git_status',
    description: 'Show working tree status — current branch, staged, unstaged, and untracked files.',
    inputSchema: { type: 'object', properties: { cwd: { type: 'string' } } },
    outputSchema: { type: 'object', properties: { branch: { type: 'string' }, clean: { type: 'boolean' }, staged: { type: 'array' }, unstaged: { type: 'array' }, untracked: { type: 'array' } } },
  },
  {
    name: 'git_diff',
    description: 'Show file changes. Use staged:true for cached diff. Optionally scope to a path.',
    inputSchema: { type: 'object', properties: { staged: { type: 'boolean' }, path: { type: 'string' }, cwd: { type: 'string' } } },
    outputSchema: { type: 'object', properties: { diff: { type: 'string' }, staged: { type: 'boolean' } } },
  },
  {
    name: 'git_log',
    description: 'Show recent commit history — hash, author, date, message.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number' }, path: { type: 'string' }, cwd: { type: 'string' } } },
    outputSchema: { type: 'object', properties: { commits: { type: 'array' }, count: { type: 'number' } } },
  },
  {
    name: 'git_add',
    description: 'Stage files for commit. Pass paths:["."] to stage everything.',
    inputSchema: { type: 'object', properties: { paths: { type: 'array', items: { type: 'string' } }, cwd: { type: 'string' } }, required: ['paths'] },
    outputSchema: { type: 'object', properties: { success: { type: 'boolean' }, staged: { type: 'array' }, message: { type: 'string' } } },
  },
  {
    name: 'git_commit',
    description: 'Commit staged changes. Set all:true to auto-stage tracked modified files first. Auto-saves context entry.',
    inputSchema: { type: 'object', properties: { message: { type: 'string' }, all: { type: 'boolean' }, cwd: { type: 'string' } }, required: ['message'] },
    outputSchema: { type: 'object', properties: { success: { type: 'boolean' }, hash: { type: 'string' }, branch: { type: 'string' }, message: { type: 'string' }, files: { type: 'array' } } },
  },
  {
    name: 'git_push',
    description: 'Push current branch to remote.',
    inputSchema: { type: 'object', properties: { remote: { type: 'string' }, branch: { type: 'string' }, cwd: { type: 'string' } } },
    outputSchema: { type: 'object', properties: { success: { type: 'boolean' }, remote: { type: 'string' }, branch: { type: 'string' }, output: { type: 'string' } } },
  },
  {
    name: 'git_pull',
    description: 'Pull from remote and merge into current branch.',
    inputSchema: { type: 'object', properties: { remote: { type: 'string' }, branch: { type: 'string' }, cwd: { type: 'string' } } },
    outputSchema: { type: 'object', properties: { success: { type: 'boolean' }, remote: { type: 'string' }, output: { type: 'string' } } },
  },
  {
    name: 'git_branch',
    description: 'List, create, or checkout branches.',
    inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['list', 'create', 'checkout'] }, name: { type: 'string' }, cwd: { type: 'string' } } },
  },
  {
    name: 'git_stash',
    description: 'Stash or restore work-in-progress changes.',
    inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['save', 'pop', 'list', 'drop'] }, message: { type: 'string' }, ref: { type: 'string' }, cwd: { type: 'string' } } },
  },
  {
    name: 'git_reset',
    description: 'Unstage files or reset HEAD. Use mode:file + path to restore a single file.',
    inputSchema: { type: 'object', properties: { mode: { type: 'string', enum: ['soft', 'mixed', 'hard', 'file'] }, path: { type: 'string' }, ref: { type: 'string' }, cwd: { type: 'string' } } },
  },
  {
    name: 'git_show',
    description: 'Show full diff and metadata for a specific commit.',
    inputSchema: { type: 'object', properties: { ref: { type: 'string' }, cwd: { type: 'string' } } },
  },
];

export async function handle(name, args, state) {
  switch (name) {
    case 'git_status': {
      const cwd      = args.cwd ? pathResolve(args.cwd) : process.cwd();
      const porcelain = runGit('status --porcelain', cwd);
      const branch   = runGit('rev-parse --abbrev-ref HEAD', cwd);
      const lines    = porcelain ? porcelain.split('\n').filter(Boolean) : [];
      return {
        branch,
        clean:     lines.length === 0,
        staged:    lines.filter(l => l[0] !== ' ' && l[0] !== '?').map(l => l.slice(3)),
        unstaged:  lines.filter(l => l[1] === 'M' || l[1] === 'D').map(l => l.slice(3)),
        untracked: lines.filter(l => l.startsWith('??')).map(l => l.slice(3)),
      };
    }

    case 'git_diff': {
      const cwd    = args.cwd ? pathResolve(args.cwd) : process.cwd();
      const staged = args.staged ? '--cached' : '';
      const scope  = args.path ? `-- "${pathResolve(args.path)}"` : '';
      let diff = runGit(`diff ${staged} ${scope}`.trim(), cwd);
      if (diff.length > MAX_DIFF_LENGTH) diff = diff.slice(0, MAX_DIFF_LENGTH) + '\n…(truncated)';
      return { diff: diff || '(no changes)', staged: !!args.staged };
    }

    case 'git_log': {
      const cwd   = args.cwd ? pathResolve(args.cwd) : process.cwd();
      const limit = args.limit || 10;
      const scope = args.path ? `-- "${pathResolve(args.path)}"` : '';
      const fmt   = '--pretty=format:%H\t%an\t%ad\t%s';
      const raw   = runGit(`log ${fmt} --date=short -n ${limit} ${scope}`.trim(), cwd);
      const commits = raw
        ? raw.split('\n').filter(Boolean).map(line => {
            const [hash, author, date, ...msg] = line.split('\t');
            return { hash: hash.slice(0, 8), author, date, message: msg.join('\t') };
          })
        : [];
      return { commits, count: commits.length };
    }

    case 'git_add': {
      const cwd   = args.cwd ? pathResolve(args.cwd) : process.cwd();
      const paths = Array.isArray(args.paths) ? args.paths : [args.paths || '.'];
      runGit(`add ${paths.map(p => `"${p}"`).join(' ')}`, cwd);
      const status = runGit('status --porcelain', cwd);
      const staged = status
        ? status.split('\n').filter(l => l[0] !== ' ' && l[0] !== '?' && l.trim()).map(l => l.slice(3))
        : [];
      return { success: true, staged, message: `Staged: ${paths.join(', ')}` };
    }

    case 'git_commit': {
      if (!args.message) throw new Error('message is required for git_commit');
      const cwd = args.cwd ? pathResolve(args.cwd) : process.cwd();

      const nameStatus = runGit('diff --cached --name-status', cwd);
      const stagedFiles = nameStatus
        ? nameStatus.split('\n').filter(Boolean).map(l => {
            const [s, ...parts] = l.split('\t');
            return { path: parts.join('\t'), action: s === 'A' ? 'created' : s === 'D' ? 'deleted' : 'modified' };
          })
        : [];

      if (args.all) runGit('add -u', cwd);

      const safeMsg = args.message.replace(/"/g, '\\"').replace(/\r?\n/g, ' ');
      runGit(`commit -m "${safeMsg}"`, cwd);

      const hash   = runGit('rev-parse --short HEAD', cwd);
      const branch = runGit('rev-parse --abbrev-ref HEAD', cwd);

      saveAutoContext({
        title:   `git commit: ${args.message.slice(0, 57)}${args.message.length > 57 ? '...' : ''}`,
        content: `hash: ${hash} | branch: ${branch}\nmessage: ${args.message}\nfiles: ${stagedFiles.map(f => f.path).join(', ')}`,
        type:    'decision',
        files:   stagedFiles,
        tags:    ['git', 'commit', branch],
        state,
      });

      return { success: true, hash, branch, message: args.message, files: stagedFiles };
    }

    case 'git_push': {
      const cwd    = args.cwd ? pathResolve(args.cwd) : process.cwd();
      const remote = args.remote || 'origin';
      const branch = args.branch || runGit('rev-parse --abbrev-ref HEAD', cwd);
      const output = runGit(`push ${remote} ${branch}`, cwd);
      return { success: true, remote, branch, output: output || 'Pushed successfully.' };
    }

    case 'git_pull': {
      const cwd    = args.cwd ? pathResolve(args.cwd) : process.cwd();
      const remote = args.remote || 'origin';
      const branch = args.branch || '';
      const output = runGit(`pull ${remote} ${branch}`.trim(), cwd);
      return { success: true, remote, output: output || 'Already up to date.' };
    }

    case 'git_branch': {
      const cwd    = args.cwd ? pathResolve(args.cwd) : process.cwd();
      const action = args.action || 'list';
      if (action === 'list') {
        const raw      = runGit('branch -a', cwd);
        const branches = raw ? raw.split('\n').map(b => b.trim()).filter(Boolean) : [];
        const current  = branches.find(b => b.startsWith('* '))?.slice(2) || '';
        return { branches: branches.map(b => b.replace(/^\* /, '')), current };
      } else if (action === 'create') {
        if (!args.name) throw new Error('name is required for branch create');
        runGit(`checkout -b "${args.name}"`, cwd);
        return { success: true, branch: args.name, message: `Created and switched to "${args.name}"` };
      } else if (action === 'checkout') {
        if (!args.name) throw new Error('name is required for branch checkout');
        runGit(`checkout "${args.name}"`, cwd);
        return { success: true, branch: args.name, message: `Switched to "${args.name}"` };
      }
      throw new Error(`Unknown branch action: ${action}. Use: list, create, checkout`);
    }

    case 'git_stash': {
      const cwd    = args.cwd ? pathResolve(args.cwd) : process.cwd();
      const action = args.action || 'save';
      if (action === 'save') {
        runGit(args.message ? `stash push -m "${args.message}"` : 'stash push', cwd);
        return { success: true, message: `Stashed changes${args.message ? `: ${args.message}` : '.'}` };
      } else if (action === 'pop') {
        const out = runGit('stash pop', cwd);
        return { success: true, output: out };
      } else if (action === 'list') {
        const raw = runGit('stash list', cwd);
        return { stashes: raw ? raw.split('\n').filter(Boolean) : [] };
      } else if (action === 'drop') {
        const ref = args.ref || 'stash@{0}';
        runGit(`stash drop ${ref}`, cwd);
        return { success: true, message: `Dropped ${ref}` };
      }
      throw new Error(`Unknown stash action: ${action}. Use: save, pop, list, drop`);
    }

    case 'git_reset': {
      const cwd  = args.cwd ? pathResolve(args.cwd) : process.cwd();
      const mode = args.mode || 'mixed';
      if (mode === 'file') {
        if (!args.path) throw new Error('path is required for file mode reset');
        runGit(`checkout -- "${pathResolve(args.path)}"`, cwd);
        return { success: true, message: `Restored "${args.path}" to last committed state.` };
      }
      const ref = args.ref || 'HEAD';
      runGit(`reset --${mode} ${ref}`, cwd);
      return { success: true, mode, ref, message: `Reset --${mode} to ${ref}` };
    }

    case 'git_show': {
      const cwd = args.cwd ? pathResolve(args.cwd) : process.cwd();
      const ref = args.ref || 'HEAD';
      const info = runGit(`show --stat --format="%H%n%an%n%ad%n%s" ${ref}`, cwd);
      let diff = runGit(`show ${ref}`, cwd);
      if (diff.length > MAX_DIFF_LENGTH) diff = diff.slice(0, MAX_DIFF_LENGTH) + '\n…(truncated)';
      return { ref, info, diff };
    }

    default:
      throw new Error(`Unknown git tool: ${name}`);
  }
}
