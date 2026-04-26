#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from '@modelcontextprotocol/sdk/node_modules/zod/lib/index.mjs';

const BASE_URL = process.env.AGENTBOARD_URL || 'http://localhost:3000';

async function req(path, opts = {}) {
  const res = await fetch(`${BASE_URL}/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 204) return { success: true };
  return res.json();
}

const server = new McpServer({
  name: 'agentboard',
  version: '0.1.0',
});

// --- Tools ---

server.tool('list_projects', 'List all projects', {}, async () => {
  const projects = await req('/projects');
  return { content: [{ type: 'text', text: JSON.stringify(projects, null, 2) }] };
});

server.tool('list_tasks', 'List tasks with optional filters', {
  status: z.enum(['Backlog', 'Planning', 'Building', 'Review', 'Done', 'Cancelled']).optional().describe('Filter by status'),
  project_id: z.number().optional().describe('Filter by project ID'),
  assignee: z.enum(['Human', 'Agent', 'Unassigned']).optional().describe('Filter by assignee'),
}, async ({ status, project_id, assignee }) => {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (project_id) params.set('project_id', project_id);
  if (assignee) params.set('assignee', assignee);
  const tasks = await req(`/tasks?${params}`);
  return { content: [{ type: 'text', text: JSON.stringify(tasks, null, 2) }] };
});

server.tool('get_backlog', 'Get tasks available for agents to pick up (Backlog/Todo, Agent/Unassigned)', {}, async () => {
  const tasks = await req('/backlog');
  return { content: [{ type: 'text', text: tasks.length ? JSON.stringify(tasks, null, 2) : 'No tasks in backlog.' }] };
});

server.tool('create_task', 'Create a new task', {
  name: z.string().describe('Task name'),
  description: z.string().optional().describe('Task description'),
  status: z.enum(['Backlog', 'Planning', 'Building', 'Review', 'Done', 'Cancelled']).optional(),
  priority: z.enum(['Urgent', 'High', 'Medium', 'Low']).optional(),
  assignee: z.enum(['Human', 'Agent', 'Unassigned']).optional(),
  project_id: z.number().optional().describe('Project ID to link to'),
  labels: z.array(z.string()).optional(),
  size: z.enum(['XS', 'S', 'M', 'L', 'XL']).optional(),
}, async (args) => {
  const task = await req('/tasks', { method: 'POST', body: args });
  return { content: [{ type: 'text', text: `Created task TSK-${task.id}: ${task.name}` }] };
});

server.tool('update_task', 'Update an existing task', {
  id: z.number().describe('Task ID'),
  name: z.string().optional(),
  status: z.enum(['Backlog', 'Planning', 'Building', 'Review', 'Done', 'Cancelled']).optional(),
  priority: z.enum(['Urgent', 'High', 'Medium', 'Low']).optional(),
  assignee: z.enum(['Human', 'Agent', 'Unassigned']).optional(),
  project_id: z.number().optional(),
  description: z.string().optional(),
}, async ({ id, ...updates }) => {
  const task = await req(`/tasks/${id}`, { method: 'PUT', body: updates });
  return { content: [{ type: 'text', text: `Updated TSK-${task.id}: status=${task.status}, assignee=${task.assignee}` }] };
});

server.tool('claim_task', 'Claim a task from the backlog and move it to Planning', {
  id: z.number().describe('Task ID to claim'),
  assignee: z.string().optional().describe('Who is claiming: Human or Agent (default: Agent)'),
}, async ({ id, assignee }) => {
  const task = await req(`/tasks/${id}/claim`, { method: 'POST', body: { assignee: assignee || 'Agent' } });
  return { content: [{ type: 'text', text: `Claimed TSK-${task.id}: "${task.name}" → Planning` }] };
});

server.tool('add_comment', 'Add a comment to a task', {
  task_id: z.number().describe('Task ID'),
  content: z.string().describe('Comment text'),
  author: z.string().optional().describe('Comment author (default: Agent)'),
}, async ({ task_id, content, author }) => {
  const comment = await req(`/tasks/${task_id}/comments`, { method: 'POST', body: { content, author: author || 'Agent' } });
  return { content: [{ type: 'text', text: `Comment added to TSK-${task_id}` }] };
});

server.tool('create_project', 'Create a new project', {
  name: z.string().describe('Project name'),
  description: z.string().optional(),
  status: z.enum(['Active', 'Paused', 'Idea', 'Archived']).optional(),
  category: z.enum(['AI Agent', 'Product', 'Tool', 'Idea']).optional(),
  priority: z.enum(['P0', 'P1', 'P2', 'P3']).optional(),
  repo_url: z.string().optional(),
}, async (args) => {
  const project = await req('/projects', { method: 'POST', body: args });
  return { content: [{ type: 'text', text: `Created project #${project.id}: ${project.name}` }] };
});

// --- Project notes (nested sub-pages, v0.4.0) ---

server.tool(
  'list_project_notes',
  'List all notes for a project (flat array, build tree from parent_id)',
  { project_id: z.number().describe('Project ID') },
  async ({ project_id }) => {
    const notes = await req(`/projects/${project_id}/notes`);
    return { content: [{ type: 'text', text: JSON.stringify(notes, null, 2) }] };
  }
);

server.tool(
  'create_note',
  'Create a note under a project. Pass parent_id to create a child note.',
  {
    project_id: z.number().describe('Project ID'),
    title: z.string().optional().describe('Note title (default: Untitled)'),
    content: z.string().optional().describe('Markdown content'),
    parent_id: z.number().optional().describe('Parent note ID for a child note'),
  },
  async ({ project_id, title, content, parent_id }) => {
    const body = {};
    if (title) body.title = title;
    if (content) body.content = content;
    if (parent_id != null) body.parent_id = parent_id;
    const note = await req(`/projects/${project_id}/notes`, { method: 'POST', body });
    return { content: [{ type: 'text', text: `Created note #${note.id}: ${note.title}` }] };
  }
);

server.tool(
  'get_note',
  'Get one note by ID (title, content, parent_id, position)',
  { id: z.number().describe('Note ID') },
  async ({ id }) => {
    const note = await req(`/notes/${id}`);
    return { content: [{ type: 'text', text: JSON.stringify(note, null, 2) }] };
  }
);

server.tool(
  'update_note',
  'Update a note. Any subset of title, content, parent_id, position.',
  {
    id: z.number().describe('Note ID'),
    title: z.string().optional(),
    content: z.string().optional(),
    parent_id: z.number().nullable().optional().describe('New parent; null to move to root'),
    position: z.number().optional(),
  },
  async ({ id, ...updates }) => {
    const note = await req(`/notes/${id}`, { method: 'PUT', body: updates });
    return { content: [{ type: 'text', text: `Updated note #${note.id}: ${note.title}` }] };
  }
);

server.tool(
  'delete_note',
  'Delete a note. Children are deleted via cascade.',
  { id: z.number().describe('Note ID') },
  async ({ id }) => {
    await req(`/notes/${id}`, { method: 'DELETE' });
    return { content: [{ type: 'text', text: `Deleted note #${id} (and any children).` }] };
  }
);

// --- Focus queue: decisions blocking agents + human to-dos ---

server.tool(
  'block_task',
  'Flag a task as needing a human decision. Use this INSTEAD of asking the user directly when running unattended. The task surfaces in the Focus tab for the human to answer. Status stays unchanged — the agent resumes when the human answers via unblock_task or the UI.',
  {
    id: z.number().describe('Task ID to block on a decision'),
    question: z.string().describe('The question for the human — be specific, include options if you have them'),
  },
  async ({ id, question }) => {
    await req(`/tasks/${id}`, {
      method: 'PUT',
      body: { needs_decision: 1, decision_question: question },
    });
    await req(`/tasks/${id}/comments`, {
      method: 'POST',
      body: { content: `[Decision requested] ${question}`, author: 'Agent' },
    });
    return { content: [{ type: 'text', text: `TSK-${id} blocked on decision. Surfaces in Focus tab. Stop work on this task until unblocked.` }] };
  }
);

server.tool(
  'unblock_task',
  'Clear the needs_decision flag on a task, optionally recording the human answer as a comment. Typically called by the UI when the human answers in the Focus tab, but an agent can call it if it already has an answer.',
  {
    id: z.number().describe('Task ID to unblock'),
    answer: z.string().optional().describe('The answer to record as a comment (from Human)'),
  },
  async ({ id, answer }) => {
    if (answer) {
      await req(`/tasks/${id}/comments`, {
        method: 'POST',
        body: { content: answer, author: 'Human' },
      });
    }
    await req(`/tasks/${id}`, {
      method: 'PUT',
      body: { needs_decision: 0, decision_question: null },
    });
    return { content: [{ type: 'text', text: `TSK-${id} unblocked. Agent can resume.` }] };
  }
);

server.tool(
  'list_focus',
  'List what is currently in the human\'s Focus queue: tasks with needs_decision=1 plus open tasks assigned to Human. Use this to check if the human has answered a prior block_task call.',
  {},
  async () => {
    const tasks = await req('/tasks?focus=1');
    return { content: [{ type: 'text', text: tasks.length ? JSON.stringify(tasks, null, 2) : 'Focus queue is empty.' }] };
  }
);

// --- Start ---

const transport = new StdioServerTransport();
await server.connect(transport);
