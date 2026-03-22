#!/usr/bin/env node

const BASE = process.env.AGENTBOARD_URL || 'http://localhost:3000';

async function req(path, opts = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) { console.error(`Error: ${data.error}`); process.exit(1); }
  return data;
}

// Formatting helpers
const PRIORITY_ICON = { Urgent: '!!!', High: '!! ', Medium: '!  ', Low: '   ' };
const STATUS_ICON = { Backlog: '○', Todo: '◎', 'In Progress': '◉', 'In Review': '◈', Done: '●', Cancelled: '✕' };

function fmtTask(t) {
  const pri = PRIORITY_ICON[t.priority] || '   ';
  const st = STATUS_ICON[t.status] || '?';
  const proj = t.project_name ? ` [${t.project_name}]` : '';
  const who = t.assignee !== 'Unassigned' ? ` @${t.assignee}` : '';
  return `  ${pri} ${st} TSK-${String(t.id).padEnd(4)} ${t.name}${proj}${who}`;
}

function fmtProject(p) {
  return `  ${p.priority} #${String(p.id).padEnd(3)} ${p.name.padEnd(25)} ${p.status.padEnd(10)} ${p.category}`;
}

// Commands
const commands = {
  async projects() {
    const projects = await req('/projects');
    if (!projects.length) return console.log('No projects.');
    console.log('  PRI ID   NAME                      STATUS     CATEGORY');
    console.log('  ' + '─'.repeat(65));
    projects.forEach(p => console.log(fmtProject(p)));
  },

  async tasks() {
    const params = new URLSearchParams();
    const args = process.argv.slice(3);
    for (let i = 0; i < args.length; i += 2) {
      const flag = args[i]?.replace('--', '');
      if (flag && args[i + 1]) params.set(flag, args[i + 1]);
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
    console.log(`  Priority: ${task.priority}`);
    console.log(`  Assignee: ${task.assignee}`);
    console.log(`  Project:  ${task.project_name || '—'}`);
    console.log(`  Size:     ${task.size || '—'}`);
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
    const args = process.argv.slice(4);
    for (let i = 0; i < args.length; i += 2) {
      const key = args[i]?.replace('--', '');
      if (key && args[i + 1]) {
        body[key] = key === 'project_id' ? parseInt(args[i + 1]) : args[i + 1];
      }
    }
    const task = await req('/tasks', { method: 'POST', body });
    console.log(`Created TSK-${task.id}: ${task.name}`);
  },

  async claim() {
    const id = process.argv[3];
    const assignee = process.argv[4] || 'Agent';
    if (!id) return console.log('Usage: ab claim <task_id> [assignee]');
    const task = await req(`/tasks/${id}/claim`, { method: 'POST', body: { assignee } });
    console.log(`Claimed TSK-${task.id}: "${task.name}" → In Progress (${task.assignee})`);
  },

  async done() {
    const id = process.argv[3];
    const comment = process.argv[4];
    if (!id) return console.log('Usage: ab done <task_id> ["comment"]');
    await req(`/tasks/${id}`, { method: 'PUT', body: { status: 'Done' } });
    if (comment) await req(`/tasks/${id}/comments`, { method: 'POST', body: { content: comment, author: 'Agent' } });
    console.log(`TSK-${id} → Done${comment ? ' (comment added)' : ''}`);
  },

  async review() {
    const id = process.argv[3];
    const comment = process.argv[4];
    if (!id) return console.log('Usage: ab review <task_id> ["comment"]');
    await req(`/tasks/${id}`, { method: 'PUT', body: { status: 'In Review' } });
    if (comment) await req(`/tasks/${id}/comments`, { method: 'POST', body: { content: comment, author: 'Agent' } });
    console.log(`TSK-${id} → In Review${comment ? ' (comment added)' : ''}`);
  },

  async update() {
    const id = process.argv[3];
    if (!id) return console.log('Usage: ab update <task_id> --status "In Progress" [--priority High] [--assignee Agent]');
    const body = {};
    const args = process.argv.slice(4);
    for (let i = 0; i < args.length; i += 2) {
      const key = args[i]?.replace('--', '');
      if (key && args[i + 1]) {
        body[key] = key === 'project_id' ? parseInt(args[i + 1]) : args[i + 1];
      }
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
  AgentBoard CLI

  COMMANDS
    ab projects                          List all projects
    ab tasks [--status X] [--assignee X] List tasks (with optional filters)
    ab backlog                           Show tasks available for agents
    ab show <id>                         Show task details + comments
    ab create "name" [--flags]           Create a task
    ab claim <id> [assignee]             Claim task → In Progress
    ab done <id> ["comment"]             Mark task → Done
    ab review <id> ["comment"]           Mark task → In Review
    ab update <id> --field value         Update task fields
    ab comment <id> "message"            Add a comment

  EXAMPLES
    ab backlog                           See what's available
    ab claim 3                           Pick up task #3
    ab comment 3 "implementing auth"     Log progress
    ab review 3 "ready for review"       Hand off to human
    ab done 3 "auth flow complete"       Mark complete

  ENV
    AGENTBOARD_URL  Server URL (default: http://localhost:3000)
`);
  },
};

const cmd = process.argv[2] || 'help';
if (commands[cmd]) {
  commands[cmd]().catch(e => { console.error(e.message); process.exit(1); });
} else {
  console.log(`Unknown command: ${cmd}. Run 'ab help' for usage.`);
}
