#!/usr/bin/env node

import { spawnSync } from 'child_process';
import { mkdirSync, writeFileSync, appendFileSync, existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const BASE = process.env.AGENTBOARD_URL || 'http://localhost:3000';

async function req(path, opts = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data && data.error ? data.error : `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// Formatting helpers
const PRIORITY_ICON = { Urgent: '!!!', High: '!! ', Medium: '!  ', Low: '   ' };
const STATUS_ICON = {
  Backlog: '○',
  Planning: '◎',
  Building: '◉',
  Review: '◈',
  Done: '●',
  Cancelled: '✕',
  // Legacy values — fallback for safety until migration is everywhere
  Brainstorming: '◎',
  'In Progress': '◉',
  'In Review': '◈',
};
const STAGE_ICON = {
  design: '☯',
  plan:   '✎',
  impl:   '◉',
  review: '⌕',
  ship:   '⇧',
  qa:     '✓',
};

const VALID_STATUSES = ['Backlog', 'Planning', 'Building', 'Review', 'Done', 'Cancelled'];
const VALID_STAGES = ['design', 'plan', 'impl', 'review', 'ship', 'qa'];

function fmtTask(t) {
  const pri = PRIORITY_ICON[t.priority] || '   ';
  const st = STATUS_ICON[t.status] || '?';
  const proj = t.project_name ? ` [${t.project_name}]` : '';
  const who = t.assignee !== 'Unassigned' ? ` @${t.assignee}` : '';
  const rounds = t.rounds > 0 ? ` (R${t.rounds})` : '';
  const stage = t.pipeline_stage ? ` ${STAGE_ICON[t.pipeline_stage] || ''}${t.pipeline_stage}` : '';
  return `  ${pri} ${st} TSK-${String(t.id).padEnd(4)} ${t.name}${proj}${who}${rounds}${stage}`;
}

function fmtProject(p) {
  const slug = p.slug ? ` (${p.slug})` : '';
  return `  ${p.priority} #${String(p.id).padEnd(3)} ${(p.name + slug).padEnd(30)} ${p.status.padEnd(10)} ${p.category}`;
}

function die(msg, code = 1) {
  process.stderr.write(msg + '\n');
  process.exit(code);
}

// Parse --flag value pairs from argv.slice(start).
function parseFlags(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a || !a.startsWith('--')) continue;
    const key = a.replace(/^--/, '');
    // Boolean flag (no value or next is another --)
    const next = args[i + 1];
    if (next === undefined || (typeof next === 'string' && next.startsWith('--'))) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

// Slugify a task name for the branch suffix. Lowercase, alphanumeric+hyphen,
// collapse multiple hyphens, trim to maxLen characters.
function taskSlug(name, maxLen = 40) {
  const s = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return s.length > maxLen ? s.slice(0, maxLen).replace(/-+$/, '') : s;
}

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error };
}

function gitPorcelain(repoPath) {
  const r = sh('git', ['-C', repoPath, 'status', '--porcelain']);
  if (r.code !== 0) {
    throw new Error(`git status failed in ${repoPath}: ${r.stderr.trim()}`);
  }
  return r.stdout.trim();
}

function gitRepoRoot(repoPath) {
  const r = sh('git', ['-C', repoPath, 'rev-parse', '--show-toplevel']);
  if (r.code !== 0) {
    throw new Error(`not a git repository: ${repoPath}`);
  }
  return r.stdout.trim();
}

function appendGcLog(projectRoot, line) {
  try {
    // Log to the AgentBoard server data dir by default. If we can't find it,
    // fall back to ~/.agentboard-gc.log.
    const here = dirname(fileURLToPath(import.meta.url));
    const serverData = resolve(here, '..', 'server', 'data');
    const logDir = existsSync(serverData) ? serverData : (process.env.HOME || '.');
    const logPath = join(logDir, 'gc-log.md');
    appendFileSync(logPath, line + '\n');
  } catch (e) {
    process.stderr.write(`[gc-log] could not write: ${e.message}\n`);
  }
}

// Commands
const commands = {
  async projects() {
    const projects = await req('/projects');
    if (!projects.length) return console.log('No projects.');
    console.log('  PRI ID   NAME                           STATUS     CATEGORY');
    console.log('  ' + '─'.repeat(70));
    projects.forEach(p => console.log(fmtProject(p)));
  },

  async tasks() {
    const params = new URLSearchParams();
    const args = process.argv.slice(3);
    const flags = parseFlags(args);
    for (const [k, v] of Object.entries(flags)) {
      if (v !== true) params.set(k, v);
    }
    const tasks = await req(`/tasks?${params}`);
    if (!tasks.length) return console.log('No tasks found.');
    let current = '';
    for (const t of tasks) {
      if (t.status !== current) {
        current = t.status;
        console.log(`\n  ${current}`);
        console.log('  ' + '─'.repeat(60));
      }
      console.log(fmtTask(t));
    }
    console.log();
  },

  async backlog() {
    const tasks = await req('/backlog');
    if (!tasks.length) return console.log('Backlog is empty. Nothing to pick up.');
    console.log('\n  Available tasks (sorted by priority):');
    console.log('  ' + '─'.repeat(60));
    tasks.forEach(t => console.log(fmtTask(t)));
    console.log(`\n  ${tasks.length} task(s) available. Use: ab claim <id>`);
  },

  async show() {
    const id = process.argv[3];
    if (!id) return console.log('Usage: ab show <task_id>');
    const task = await req(`/tasks/${id}`);
    console.log(`\n  TSK-${task.id}: ${task.name}`);
    console.log('  ' + '─'.repeat(50));
    console.log(`  Status:   ${task.status}`);
    console.log(`  Stage:    ${task.pipeline_stage || '—'}`);
    console.log(`  Priority: ${task.priority}`);
    console.log(`  Assignee: ${task.assignee}`);
    console.log(`  Project:  ${task.project_name || '—'}${task.project_slug ? ` (${task.project_slug})` : ''}`);
    console.log(`  Size:     ${task.size || '—'}`);
    console.log(`  Branch:   ${task.branch_name || '—'}`);
    console.log(`  Worktree: ${task.worktree_path || '—'}`);
    console.log(`  PR:       ${task.pr_url || '—'}`);
    if (task.description) console.log(`\n  ${task.description}`);
    const comments = await req(`/tasks/${id}/comments`);
    if (comments.length) {
      console.log('\n  Activity:');
      comments.forEach(c => {
        console.log(`    ${c.author} (${c.created_at}): ${c.content}`);
      });
    }
    console.log();
  },

  async create() {
    const name = process.argv[3];
    if (!name) return console.log('Usage: ab create "task name" [--project_id N] [--priority High] [--assignee Agent] [--status Backlog]');
    const body = { name };
    const flags = parseFlags(process.argv.slice(4));
    for (const [k, v] of Object.entries(flags)) {
      if (v === true) continue;
      body[k] = k === 'project_id' ? parseInt(v) : v;
    }
    const task = await req('/tasks', { method: 'POST', body });
    console.log(`Created TSK-${task.id}: ${task.name}`);
  },

  // --- NEW: worktree-aware claim ---
  async claim() {
    const id = process.argv[3];
    const assignee = (process.argv[4] && !process.argv[4].startsWith('--')) ? process.argv[4] : 'Agent';
    if (!id) return console.log('Usage: ab claim <task_id> [assignee]');

    // 1. Resolve project from task
    let task;
    try {
      task = await req(`/tasks/${id}`);
    } catch (e) {
      die(`Could not fetch TSK-${id}: ${e.message}`);
    }
    if (!task.project_id) die(`TSK-${id} has no project; cannot create worktree.`);

    const project = await req(`/projects/${task.project_id}`);
    if (!project.repo_url) die(`Project '${project.name}' has no repo_url. Set it with: ab project update ${project.id} --repo_url <path>`);
    if (!project.slug) die(`Project '${project.name}' has no slug. Set it with: ab project update ${project.id} --slug <slug>`);

    // Resolve repo_url to an absolute filesystem path. If it looks like a URL
    // (http / git@), we can't create a worktree — require a local path.
    const repoUrl = project.repo_url;
    const looksRemote = /^(https?:|git@|ssh:|git:)/.test(repoUrl);
    if (looksRemote) {
      die(`Project '${project.name}' repo_url is remote (${repoUrl}). Set it to a local path for worktree support.`);
    }
    const repoPath = repoUrl.startsWith('~')
      ? repoUrl.replace(/^~/, process.env.HOME || '')
      : resolve(repoUrl);

    if (!existsSync(repoPath)) {
      die(`Project '${project.name}' repo_url points to missing path: ${repoPath}`);
    }

    // 2. Preflight: repo must be clean
    let porcelain;
    try {
      porcelain = gitPorcelain(repoPath);
    } catch (e) {
      die(e.message);
    }
    if (porcelain !== '') {
      die(`Project '${project.name}' has uncommitted changes at ${repoPath}. Stash or commit first.`);
    }

    // 3. Compute branch + worktree path
    const branch = `tsk-${task.id}-${taskSlug(task.name, 40)}`;
    let repoRoot;
    try {
      repoRoot = gitRepoRoot(repoPath);
    } catch (e) {
      die(e.message);
    }
    const worktreePath = join(repoRoot, '.worktrees', branch);

    // 4. Atomic CAS claim via server
    let updated;
    try {
      updated = await req(`/tasks/${id}/claim-atomic`, {
        method: 'POST',
        body: { assignee, worktree_path: worktreePath, branch_name: branch },
      });
    } catch (e) {
      if (e.status === 409) {
        die(`TSK-${id} is not claimable (already claimed or wrong status). ${e.message}`);
      }
      die(`Claim failed: ${e.message}`);
    }

    // 5. Create the worktree. If this fails, the DB already reflects the claim;
    // we print a recovery hint and leave it to the user rather than silently rolling back.
    const wtr = sh('git', ['-C', repoPath, 'worktree', 'add', '-b', branch, worktreePath]);
    if (wtr.code !== 0) {
      // Try to roll back the DB claim metadata (worktree_path/branch), but leave status so a
      // human can see what happened.
      try {
        await req(`/tasks/${id}/worktree`, { method: 'DELETE', body: { force: true } });
      } catch { /* best effort */ }
      die(`git worktree add failed:\n${wtr.stderr || wtr.stdout}\nTSK-${id} claim rolled back (status remains Planning; you may need ab status ${id} Backlog).`);
    }

    // 6. Write the agent context file
    try {
      mkdirSync(worktreePath, { recursive: true });
      writeFileSync(
        join(worktreePath, '.agentboard-task.json'),
        JSON.stringify({
          id: task.id,
          name: task.name,
          project_slug: project.slug,
          status: 'Planning',
          pipeline_stage: 'design',
          branch,
          created_at: new Date().toISOString(),
        }, null, 2) + '\n'
      );
    } catch (e) {
      process.stderr.write(`Warning: could not write .agentboard-task.json: ${e.message}\n`);
    }

    console.log(`Claimed TSK-${updated.id} → Planning (stage=design). Worktree: ${worktreePath}`);
    console.log(`  Enter: cd $(ab cd ${updated.id})`);
  },

  // --- NEW: cd helper ---
  async cd() {
    const id = process.argv[3];
    if (!id) die('Usage: ab cd <task_id>');
    const task = await req(`/tasks/${id}`);
    if (!task.worktree_path) die(`TSK-${id} has no worktree_path.`);
    // No trailing newline — intended for shell substitution.
    process.stdout.write(task.worktree_path);
  },

  // --- NEW: next action ---
  async next() {
    const id = process.argv[3];
    if (!id) die('Usage: ab next <task_id>');
    const task = await req(`/tasks/${id}`);
    const suggest = (s) => console.log(s);
    const stage = task.pipeline_stage;
    switch (task.status) {
      case 'Backlog':
        suggest(`ab claim ${task.id}    # atomic claim + worktree → Planning (stage=design)`);
        break;
      case 'Planning':
        if (!stage || stage === 'design') {
          suggest(`/office-hours         # vet the idea; then: ab stage ${task.id} plan`);
        } else if (stage === 'plan') {
          suggest(`superpowers writing-plans → ~/wiki/projects/${task.project_slug || '<slug>'}/tasks/${task.id}/plan.md`);
          suggest(`/autoplan             # CEO + design + eng + DX review of plan`);
          suggest(`ab status ${task.id} Building   # when plan is locked`);
        } else {
          suggest(`ab status ${task.id} Building`);
        }
        break;
      case 'Building':
        suggest(`# commit in the worktree, then:`);
        suggest(`ab status ${task.id} Review`);
        break;
      case 'Review':
        if (stage === 'ship') {
          suggest(`/ship                 # creates the PR; poller will auto-capture pr_url`);
        } else if (stage === 'qa') {
          suggest(`/qa                   # QA pass`);
        } else {
          suggest(`/review               # code review`);
          suggest(`ab stage ${task.id} ship  # when ready to create PR`);
        }
        suggest(`ab done ${task.id} "reason"   # when PR merged and QA passed`);
        break;
      case 'Done':
        suggest(`# Task complete. Worktree ${task.worktree_path ? 'still mounted at ' + task.worktree_path : 'already cleaned'}.`);
        if (task.worktree_path) suggest(`# GC will clean it after 7d if PR merged.`);
        break;
      case 'Cancelled':
        suggest(`# Cancelled. If worktree still mounted: ab worktree remove ${task.id}`);
        break;
      default:
        suggest(`# Unknown state. Run: ab show ${task.id}`);
    }
  },

  // --- NEW: generic status transition ---
  async status() {
    const id = process.argv[3];
    const target = process.argv[4];
    if (!id || !target) die('Usage: ab status <task_id> <Backlog|Planning|Building|Review|Done|Cancelled>');
    if (!VALID_STATUSES.includes(target)) {
      die(`Invalid status '${target}'. One of: ${VALID_STATUSES.join(', ')}`);
    }
    const task = await req(`/tasks/${id}`, { method: 'PUT', body: { status: target } });
    console.log(`TSK-${task.id} → ${task.status}`);
  },

  // --- NEW: pipeline_stage setter ---
  async stage() {
    const id = process.argv[3];
    const stage = process.argv[4];
    if (!id || !stage) die('Usage: ab stage <task_id> <design|plan|impl|review|ship|qa|none>');
    const value = stage === 'none' ? null : stage;
    if (value !== null && !VALID_STAGES.includes(value)) {
      die(`Invalid stage '${stage}'. One of: ${VALID_STAGES.join(', ')}, or 'none' to clear.`);
    }
    const task = await req(`/tasks/${id}`, { method: 'PUT', body: { pipeline_stage: value } });
    console.log(`TSK-${task.id} stage=${task.pipeline_stage || 'none'}`);
  },

  // --- NEW: worktree subcommands ---
  async worktree() {
    const sub = process.argv[3];
    if (!sub) {
      console.log('Usage: ab worktree <list|gc|remove> [...]');
      process.exit(1);
    }
    if (sub === 'list') return worktreeList();
    if (sub === 'gc')   return worktreeGc();
    if (sub === 'remove') return worktreeRemove();
    die(`Unknown subcommand: ab worktree ${sub}`);
  },

  // --- EXTENDED: done with cleanliness check ---
  async done() {
    const id = process.argv[3];
    // Positional comment = first non-flag arg after id.
    let comment;
    const rest = process.argv.slice(4);
    if (rest.length && !rest[0].startsWith('--')) comment = rest.shift();
    const flags = parseFlags(rest);
    if (!id) return console.log('Usage: ab done <task_id> ["comment"] [--dirty]');

    const task = await req(`/tasks/${id}`);
    if (task.worktree_path && !flags.dirty) {
      // Check if worktree is clean
      if (existsSync(task.worktree_path)) {
        try {
          const dirty = gitPorcelain(task.worktree_path);
          if (dirty !== '') {
            die(`Worktree has uncommitted changes at ${task.worktree_path}. Commit, push, or use --dirty.`);
          }
        } catch (e) {
          // If the worktree path isn't a git worktree any more, warn and let it through.
          process.stderr.write(`Warning: cleanliness check failed (${e.message}). Pass --dirty to override.\n`);
          process.exit(1);
        }
      }
    }

    await req(`/tasks/${id}`, { method: 'PUT', body: { status: 'Done' } });
    if (comment) await req(`/tasks/${id}/comments`, { method: 'POST', body: { content: comment, author: 'Agent' } });
    console.log(`TSK-${id} → Done${comment ? ' (comment added)' : ''}${flags.dirty ? ' [dirty override]' : ''}`);
  },

  async review() {
    const id = process.argv[3];
    const comment = process.argv[4];
    if (!id) return console.log('Usage: ab review <task_id> ["comment"]');
    await req(`/tasks/${id}`, { method: 'PUT', body: { status: 'Review' } });
    if (comment) await req(`/tasks/${id}/comments`, { method: 'POST', body: { content: comment, author: 'Agent' } });
    console.log(`TSK-${id} → Review${comment ? ' (comment added)' : ''}`);
  },

  async brainstorm() {
    // Legacy alias → Planning
    const id = process.argv[3];
    const comment = process.argv[4];
    if (!id) return console.log('Usage: ab brainstorm <task_id> ["comment"]  (legacy alias for: ab status <id> Planning)');
    await req(`/tasks/${id}`, { method: 'PUT', body: { status: 'Planning' } });
    if (comment) await req(`/tasks/${id}/comments`, { method: 'POST', body: { content: comment, author: 'Agent' } });
    const t = await req(`/tasks/${id}`);
    console.log(`TSK-${id} → Planning (round ${t.rounds})${comment ? ' (comment added)' : ''}`);
  },

  async plan() {
    const id = process.argv[3];
    const comment = process.argv[4];
    if (!id) return console.log('Usage: ab plan <task_id> ["comment"]');
    await req(`/tasks/${id}`, { method: 'PUT', body: { status: 'Planning' } });
    if (comment) await req(`/tasks/${id}/comments`, { method: 'POST', body: { content: comment, author: 'Agent' } });
    console.log(`TSK-${id} → Planning${comment ? ' (comment added)' : ''}`);
  },

  async progress() {
    // Legacy alias → Building
    const id = process.argv[3];
    const comment = process.argv[4];
    if (!id) return console.log('Usage: ab progress <task_id> ["comment"]  (legacy alias for: ab status <id> Building)');
    await req(`/tasks/${id}`, { method: 'PUT', body: { status: 'Building' } });
    if (comment) await req(`/tasks/${id}/comments`, { method: 'POST', body: { content: comment, author: 'Agent' } });
    console.log(`TSK-${id} → Building${comment ? ' (comment added)' : ''}`);
  },

  async build() {
    const id = process.argv[3];
    const comment = process.argv[4];
    if (!id) return console.log('Usage: ab build <task_id> ["comment"]');
    await req(`/tasks/${id}`, { method: 'PUT', body: { status: 'Building' } });
    if (comment) await req(`/tasks/${id}/comments`, { method: 'POST', body: { content: comment, author: 'Agent' } });
    console.log(`TSK-${id} → Building${comment ? ' (comment added)' : ''}`);
  },

  async update() {
    const id = process.argv[3];
    if (!id) return console.log('Usage: ab update <task_id> --status "Building" [--priority High] [--pr_url ...] [--pipeline_stage impl] [--worktree_path ...] [--branch_name ...]');
    const flags = parseFlags(process.argv.slice(4));
    const body = {};
    for (const [k, v] of Object.entries(flags)) {
      if (v === true) continue;
      body[k] = k === 'project_id' ? parseInt(v) : v;
    }
    if (!Object.keys(body).length) return console.log('Nothing to update. Pass --status, --priority, etc.');
    const task = await req(`/tasks/${id}`, { method: 'PUT', body });
    console.log(`Updated TSK-${task.id}: status=${task.status}, assignee=${task.assignee}`);
  },

  async comment() {
    const id = process.argv[3];
    const content = process.argv[4];
    if (!id || !content) return console.log('Usage: ab comment <task_id> "message"');
    const author = process.argv[5] || 'Agent';
    await req(`/tasks/${id}/comments`, { method: 'POST', body: { content, author } });
    console.log(`Comment added to TSK-${id}`);
  },

  async help() {
    console.log(`
  AgentBoard CLI — worktree-aware

  WORKFLOW COMMANDS
    ab backlog                           Tasks available for pickup (priority sorted)
    ab claim <id> [assignee]             Atomic claim + create git worktree → Planning
    ab cd <id>                           Print worktree path (for: cd $(ab cd N))
    ab next <id>                         Recommended next command for current state
    ab status <id> <target>              Transition status: Backlog|Planning|Building|Review|Done|Cancelled
    ab stage <id> <s>                    Set pipeline_stage: design|plan|impl|review|ship|qa|none
    ab done <id> ["comment"] [--dirty]   Mark Done (refuses if worktree dirty, unless --dirty)

  INSPECTION
    ab projects                          List projects
    ab tasks [--status X] [--assignee X] List tasks
    ab show <id>                         Task details + comments
    ab worktree list [--stale] [--project <slug>]

  CREATE / UPDATE
    ab create "name" [--flags]           Create a task
    ab update <id> --field value         Update any field (incl. pr_url, pipeline_stage, worktree_path, branch_name)
    ab comment <id> "message"            Add a comment

  MAINTENANCE
    ab worktree gc [--execute]           GC candidates (dry-run by default)
    ab worktree remove <id> [--force]    Remove one worktree (must be Done/Cancelled; --force skips checks)

  LEGACY ALIASES
    ab plan <id>       → ab status <id> Planning
    ab build <id>      → ab status <id> Building
    ab brainstorm <id> → ab status <id> Planning (still bumps rounds when from Building/Review)
    ab progress <id>   → ab status <id> Building
    ab review <id>     → ab status <id> Review

  FLOW
    Backlog → Planning → Building → Review → Done
    stages within Review: review → ship → qa
    (back-transitions allowed: Review → Building, Building → Planning, etc.)

  ENV
    AGENTBOARD_URL  Server URL (default: http://localhost:3000)
`);
  },
};

// ---------- Worktree subcommand handlers ----------

async function worktreeList() {
  const flags = parseFlags(process.argv.slice(4));
  const qs = new URLSearchParams();
  if (flags.project && flags.project !== true) qs.set('project', flags.project);
  if (flags.stale) qs.set('stale', 'true');
  const rows = await req(`/worktrees${qs.toString() ? '?' + qs : ''}`);
  if (!rows.length) return console.log('No active worktrees.');
  console.log('  ID   STATUS   STAGE   PROJECT              BRANCH                          WORKTREE                               LAST ACTIVITY');
  console.log('  ' + '─'.repeat(150));
  for (const r of rows) {
    const last = r.last_comment_at && r.updated_at
      ? (r.last_comment_at > r.updated_at ? r.last_comment_at : r.updated_at)
      : (r.last_comment_at || r.updated_at || '');
    console.log(
      `  ${String(r.task_id).padEnd(4)} ${String(r.status).padEnd(8)} ${String(r.stage || '—').padEnd(7)} ${String(r.project_slug || r.project_name || '—').padEnd(20)} ${String(r.branch_name || '—').padEnd(30)} ${String(r.worktree_path || '—').padEnd(38)} ${last}`
    );
  }
}

async function worktreeGc() {
  const flags = parseFlags(process.argv.slice(4));
  const execute = !!flags.execute;
  const rows = await req(`/worktrees`);
  // worktrees endpoint excludes Done by default — we need to fetch Done ones explicitly for GC
  // Fetch tasks with status Done + worktree_path via /tasks endpoint.
  const doneTasks = await req('/tasks?status=Done');
  const candidates = [];
  const sevenDaysAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;

  const ts = new Date().toISOString();
  appendGcLog(null, `\n## ${ts} — gc run (${execute ? 'EXECUTE' : 'dry-run'})`);

  for (const t of doneTasks) {
    if (!t.worktree_path) continue;
    if (!t.pr_url) {
      appendGcLog(null, `- TSK-${t.id}: skipped — no pr_url`);
      continue;
    }
    if (!t.branch_name) {
      appendGcLog(null, `- TSK-${t.id}: skipped — no branch_name`);
      continue;
    }
    // Age check
    const updatedMs = t.updated_at ? Date.parse(t.updated_at + 'Z') : 0;
    if (!updatedMs || updatedMs > sevenDaysAgoMs) {
      appendGcLog(null, `- TSK-${t.id}: skipped — age <7d (updated_at=${t.updated_at})`);
      continue;
    }
    // PR merged?
    const pr = sh('gh', ['pr', 'view', t.pr_url, '--json', 'state']);
    if (pr.code !== 0) {
      appendGcLog(null, `- TSK-${t.id}: skipped — gh pr view failed (${pr.stderr.trim() || pr.code})`);
      continue;
    }
    let state = null;
    try { state = JSON.parse(pr.stdout).state; } catch { /* ignore */ }
    if (state !== 'MERGED') {
      appendGcLog(null, `- TSK-${t.id}: skipped — PR state=${state}`);
      continue;
    }
    // Clean worktree?
    if (!existsSync(t.worktree_path)) {
      appendGcLog(null, `- TSK-${t.id}: skipped — worktree path missing on disk`);
      continue;
    }
    let dirty = '(unknown)';
    try {
      dirty = gitPorcelain(t.worktree_path);
    } catch (e) {
      appendGcLog(null, `- TSK-${t.id}: skipped — git status failed: ${e.message}`);
      continue;
    }
    if (dirty !== '') {
      appendGcLog(null, `- TSK-${t.id}: skipped — worktree dirty`);
      continue;
    }
    candidates.push(t);
    appendGcLog(null, `- TSK-${t.id}: candidate (branch=${t.branch_name}, wt=${t.worktree_path})`);
  }

  if (!candidates.length) {
    console.log('No GC candidates found. (All criteria: Done + merged PR + clean worktree + >7d old.)');
    return;
  }

  console.log(`\n  GC candidates (${execute ? 'EXECUTING' : 'DRY-RUN — pass --execute to remove'}):`);
  console.log('  ' + '─'.repeat(80));
  for (const t of candidates) {
    console.log(`  TSK-${t.id}  ${t.branch_name}  ${t.worktree_path}  (updated ${t.updated_at})`);
  }

  if (!execute) {
    console.log(`\n  ${candidates.length} candidate(s). Run with --execute to remove.`);
    return;
  }

  for (const t of candidates) {
    // Infer repo_root from worktree_path: ../../ relative to .worktrees/<branch>
    const parts = t.worktree_path.split('/.worktrees/');
    const repoRoot = parts.length === 2 ? parts[0] : null;
    if (!repoRoot) {
      appendGcLog(null, `- TSK-${t.id}: removed=false — could not infer repo root from ${t.worktree_path}`);
      console.log(`  TSK-${t.id}: skipped (could not derive repo root)`);
      continue;
    }

    const rm = sh('git', ['-C', repoRoot, 'worktree', 'remove', t.worktree_path]);
    if (rm.code !== 0) {
      appendGcLog(null, `- TSK-${t.id}: worktree remove FAILED: ${rm.stderr.trim()}`);
      console.log(`  TSK-${t.id}: worktree remove failed (${rm.stderr.trim()})`);
      continue;
    }
    const br = sh('git', ['-C', repoRoot, 'branch', '-D', t.branch_name]);
    if (br.code !== 0) {
      appendGcLog(null, `- TSK-${t.id}: branch delete failed (best-effort): ${br.stderr.trim()}`);
    }
    try {
      await req(`/tasks/${t.id}/worktree`, { method: 'DELETE', body: { force: true } });
    } catch (e) {
      appendGcLog(null, `- TSK-${t.id}: server metadata clear failed: ${e.message}`);
    }
    appendGcLog(null, `- TSK-${t.id}: removed (branch + worktree + server metadata)`);
    console.log(`  TSK-${t.id}: removed`);
  }
}

async function worktreeRemove() {
  const id = process.argv[4];
  if (!id) die('Usage: ab worktree remove <task_id> [--force]');
  const flags = parseFlags(process.argv.slice(5));
  const force = !!flags.force;

  const task = await req(`/tasks/${id}`);
  if (!task.worktree_path) die(`TSK-${id} has no worktree_path.`);

  if (!force) {
    if (!['Done', 'Cancelled'].includes(task.status)) {
      die(`TSK-${id} status=${task.status}. Only Done or Cancelled tasks are removable (use --force to override).`);
    }
    if (existsSync(task.worktree_path)) {
      let dirty;
      try { dirty = gitPorcelain(task.worktree_path); } catch (e) { die(`git status failed: ${e.message}`); }
      if (dirty !== '') die(`Worktree is dirty at ${task.worktree_path}. Commit/discard, or use --force.`);
    }
  }

  const ts = new Date().toISOString();
  appendGcLog(null, `\n## ${ts} — manual remove TSK-${id}${force ? ' (--force)' : ''}`);

  if (existsSync(task.worktree_path)) {
    const parts = task.worktree_path.split('/.worktrees/');
    const repoRoot = parts.length === 2 ? parts[0] : null;
    if (repoRoot) {
      const args = ['-C', repoRoot, 'worktree', 'remove'];
      if (force) args.push('--force');
      args.push(task.worktree_path);
      const rm = sh('git', args);
      if (rm.code !== 0) {
        appendGcLog(null, `- TSK-${id}: worktree remove FAILED: ${rm.stderr.trim()}`);
        die(`git worktree remove failed: ${rm.stderr.trim()}`);
      }
      if (task.branch_name) {
        const brArgs = ['-C', repoRoot, 'branch'];
        brArgs.push(force ? '-D' : '-d');
        brArgs.push(task.branch_name);
        const br = sh('git', brArgs);
        if (br.code !== 0) {
          appendGcLog(null, `- TSK-${id}: branch delete best-effort: ${br.stderr.trim()}`);
        }
      }
    } else {
      appendGcLog(null, `- TSK-${id}: could not infer repo root from ${task.worktree_path}`);
    }
  }

  await req(`/tasks/${id}/worktree`, { method: 'DELETE', body: { force } });
  appendGcLog(null, `- TSK-${id}: removed`);
  console.log(`TSK-${id}: worktree removed.`);
}

// ---------- Dispatcher ----------

const cmd = process.argv[2] || 'help';
if (commands[cmd]) {
  commands[cmd]().catch(e => { console.error(e.message || e); process.exit(1); });
} else {
  console.log(`Unknown command: ${cmd}. Run 'ab help' for usage.`);
}
