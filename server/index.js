import express from 'express';
import cors from 'cors';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import db from './db.js';
import { startPrPoller } from './workers/pr-poller.js';
import { registerClient, broadcast, closeAll as closeAllSSE } from './sse.js';

const app = express();
const PORT = process.env.PORT || 3000;
const __dirname = dirname(fileURLToPath(import.meta.url));

app.use(cors());
app.use(express.json({ limit: '5mb' }));

// --- Live events ---

app.get('/api/events', (req, res) => {
  registerClient(req, res);
});

// After any 2xx mutation, broadcast a change event so live dashboards refresh
// without polling. Topic inferred from the URL path.
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  res.on('finish', () => {
    if (res.statusCode < 200 || res.statusCode >= 300) return;
    const p = req.path;
    let topic = 'change';
    if (p.includes('/tasks') || p.includes('/worktree')) topic = 'tasks';
    else if (p.includes('/notes')) topic = 'notes';
    else if (p.includes('/projects')) topic = 'projects';
    else if (p.includes('/comments')) topic = 'comments';
    broadcast(topic);
  });
  next();
});

// --- Projects ---

app.get('/api/projects', (req, res) => {
  const rows = db.prepare('SELECT * FROM projects ORDER BY priority, name').all();
  res.json(rows);
});

app.get('/api/projects/:id', (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  project ? res.json(project) : res.status(404).json({ error: 'not found' });
});

// Look up a project by slug (for CLI). Falls back to 404.
app.get('/api/projects/slug/:slug', (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE slug = ?').get(req.params.slug);
  project ? res.json(project) : res.status(404).json({ error: 'not found' });
});

function slugifyProjectName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

app.post('/api/projects', (req, res) => {
  const { name, description, notes, status, category, priority, repo_url, slug } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const effectiveSlug = (slug && slug.trim()) ? slug.trim() : slugifyProjectName(name);
  try {
    const result = db.prepare(
      `INSERT INTO projects (name, description, notes, status, category, priority, repo_url, slug)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      name, description || '', notes || '', status || 'Active',
      category || '', priority || 'P2', repo_url || '', effectiveSlug
    );
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(project);
  } catch (e) {
    res.status(409).json({ error: e.message });
  }
});

app.put('/api/projects/:id', (req, res) => {
  const fields = ['name', 'description', 'notes', 'status', 'category', 'priority', 'repo_url', 'slug', 'icon'];
  const updates = [];
  const values = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) { updates.push(`${f} = ?`); values.push(req.body[f]); }
  }
  if (!updates.length) return res.status(400).json({ error: 'nothing to update' });
  updates.push("updated_at = datetime('now')");
  values.push(req.params.id);
  try {
    db.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  } catch (e) {
    return res.status(409).json({ error: e.message });
  }
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  project ? res.json(project) : res.status(404).json({ error: 'not found' });
});

app.delete('/api/projects/:id', (req, res) => {
  db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

// --- Tasks ---

app.get('/api/tasks', (req, res) => {
  let sql = `SELECT t.*, p.name as project_name, p.slug as project_slug FROM tasks t LEFT JOIN projects p ON t.project_id = p.id`;
  const conditions = [];
  const values = [];
  if (req.query.status) { conditions.push('t.status = ?'); values.push(req.query.status); }
  if (req.query.project_id) { conditions.push('t.project_id = ?'); values.push(req.query.project_id); }
  if (req.query.assignee) { conditions.push('t.assignee = ?'); values.push(req.query.assignee); }
  // Focus mode: tasks that need human action — either an agent flagged a decision,
  // or the task is assigned to a human and still open (not Done/Cancelled).
  if (req.query.focus === '1' || req.query.focus === 'true') {
    conditions.push("(t.needs_decision = 1 OR (t.assignee = 'Human' AND t.status NOT IN ('Done','Cancelled')))");
  }
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY t.needs_decision DESC, CASE t.priority WHEN \'Urgent\' THEN 0 WHEN \'High\' THEN 1 WHEN \'Medium\' THEN 2 WHEN \'Low\' THEN 3 END, t.created_at DESC';
  res.json(db.prepare(sql).all(...values));
});

app.get('/api/tasks/:id', (req, res) => {
  const task = db.prepare(
    'SELECT t.*, p.name as project_name, p.slug as project_slug, p.repo_url as project_repo_url FROM tasks t LEFT JOIN projects p ON t.project_id = p.id WHERE t.id = ?'
  ).get(req.params.id);
  task ? res.json(task) : res.status(404).json({ error: 'not found' });
});

app.post('/api/tasks', (req, res) => {
  const { name, project_id, description, status, priority, assignee, labels, size, due_date } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const result = db.prepare(
    `INSERT INTO tasks (name, project_id, description, status, priority, assignee, labels, size, due_date, rounds)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
  ).run(
    name, project_id || null, description || '', status || 'Backlog',
    priority || 'Medium', assignee || 'Unassigned',
    JSON.stringify(labels || []), size || '', due_date || null
  );
  const task = db.prepare(
    'SELECT t.*, p.name as project_name FROM tasks t LEFT JOIN projects p ON t.project_id = p.id WHERE t.id = ?'
  ).get(result.lastInsertRowid);
  res.status(201).json(task);
});

app.put('/api/tasks/:id', (req, res) => {
  // Round bump: moving back to Planning from Building or Review.
  // Accept legacy names as a one-time safety net until all clients upgrade.
  const current = db.prepare('SELECT status, rounds FROM tasks WHERE id = ?').get(req.params.id);
  let roundBump = 0;
  if (current && req.body.status === 'Planning' && ['Building', 'Review'].includes(current.status)) {
    roundBump = 1;
  }

  const fields = [
    'name', 'project_id', 'description', 'status', 'priority', 'assignee',
    'labels', 'size', 'due_date',
    // Phase 1 additions
    'pr_url', 'pipeline_stage', 'worktree_path', 'branch_name',
    // Focus queue (v0.8.0)
    'needs_decision', 'decision_question',
  ];
  const updates = [];
  const values = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      updates.push(`${f} = ?`);
      values.push(f === 'labels' ? JSON.stringify(req.body[f]) : req.body[f]);
    }
  }
  if (roundBump) {
    updates.push('rounds = rounds + 1');
  }
  if (!updates.length) return res.status(400).json({ error: 'nothing to update' });
  updates.push("updated_at = datetime('now')");
  values.push(req.params.id);
  try {
    db.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const task = db.prepare(
    'SELECT t.*, p.name as project_name FROM tasks t LEFT JOIN projects p ON t.project_id = p.id WHERE t.id = ?'
  ).get(req.params.id);

  // Auto-comment on round increment
  if (roundBump && task) {
    db.prepare('INSERT INTO comments (task_id, author, content) VALUES (?, ?, ?)').run(
      task.id, 'System', `Round ${task.rounds} — back to Planning`
    );
  }

  task ? res.json(task) : res.status(404).json({ error: 'not found' });
});

app.delete('/api/tasks/:id', (req, res) => {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

// --- Agent convenience endpoints ---

app.get('/api/backlog', (req, res) => {
  const tasks = db.prepare(
    `SELECT t.*, p.name as project_name, p.slug as project_slug FROM tasks t
     LEFT JOIN projects p ON t.project_id = p.id
     WHERE t.status = 'Backlog' AND t.assignee IN ('Agent', 'Unassigned')
     ORDER BY CASE t.priority WHEN 'Urgent' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 WHEN 'Low' THEN 3 END, t.created_at`
  ).all();
  res.json(tasks);
});

app.post('/api/tasks/:id/claim', (req, res) => {
  const { assignee } = req.body;
  // Legacy endpoint: simple claim without worktree. Moves Backlog → Planning.
  // Uses atomic CAS so concurrent claims don't both "succeed".
  const info = db.prepare(
    "UPDATE tasks SET status = 'Planning', assignee = ?, updated_at = datetime('now') WHERE id = ? AND status = 'Backlog'"
  ).run(assignee || 'Agent', req.params.id);

  if (info.changes === 0) {
    const cur = db.prepare('SELECT status FROM tasks WHERE id = ?').get(req.params.id);
    return res.status(409).json({
      error: cur
        ? `TSK-${req.params.id} is not claimable (current status: ${cur.status})`
        : `TSK-${req.params.id} not found`,
    });
  }

  const task = db.prepare(
    'SELECT t.*, p.name as project_name FROM tasks t LEFT JOIN projects p ON t.project_id = p.id WHERE t.id = ?'
  ).get(req.params.id);
  if (task) {
    db.prepare('INSERT INTO comments (task_id, author, content) VALUES (?, ?, ?)').run(
      task.id, assignee || 'Agent', 'Claimed task — moving to Planning'
    );
  }
  res.json(task);
});

// Atomic claim + worktree metadata write.
// Body: { assignee, worktree_path, branch_name }
// Returns 409 if task is not in Backlog (already claimed).
app.post('/api/tasks/:id/claim-atomic', (req, res) => {
  const { assignee, worktree_path, branch_name } = req.body || {};
  const id = req.params.id;

  const info = db.prepare(
    `UPDATE tasks
        SET status = 'Planning',
            assignee = COALESCE(?, assignee),
            pipeline_stage = 'design',
            worktree_path = COALESCE(?, worktree_path),
            branch_name = COALESCE(?, branch_name),
            updated_at = datetime('now')
      WHERE id = ? AND status = 'Backlog'`
  ).run(assignee || null, worktree_path || null, branch_name || null, id);

  if (info.changes === 0) {
    const cur = db.prepare('SELECT status FROM tasks WHERE id = ?').get(id);
    return res.status(409).json({
      error: cur
        ? `TSK-${id} is not claimable (current status: ${cur.status})`
        : `TSK-${id} not found`,
    });
  }

  db.prepare('INSERT INTO comments (task_id, author, content) VALUES (?, ?, ?)').run(
    id, assignee || 'Agent',
    `Claimed — worktree at ${worktree_path || '(no worktree)'} on branch ${branch_name || '(no branch)'}`
  );

  const task = db.prepare(
    'SELECT t.*, p.name as project_name, p.slug as project_slug, p.repo_url as project_repo_url FROM tasks t LEFT JOIN projects p ON t.project_id = p.id WHERE t.id = ?'
  ).get(id);
  res.json(task);
});

// List worktrees across all tasks.
// Query: ?project=<slug>&stale=true
app.get('/api/worktrees', (req, res) => {
  const { project, stale } = req.query;
  const conditions = [
    't.worktree_path IS NOT NULL',
    "t.status NOT IN ('Done','Cancelled')",
  ];
  const values = [];
  if (project) {
    conditions.push('p.slug = ?');
    values.push(project);
  }

  let sql = `
    SELECT t.id as task_id, t.name, p.slug as project_slug, p.name as project_name,
           t.status, t.pipeline_stage as stage, t.branch_name, t.worktree_path,
           t.updated_at,
           (SELECT MAX(created_at) FROM comments WHERE task_id = t.id) as last_comment_at
      FROM tasks t
      LEFT JOIN projects p ON t.project_id = p.id
     WHERE ${conditions.join(' AND ')}
     ORDER BY t.updated_at DESC
  `;

  let rows = db.prepare(sql).all(...values);

  if (String(stale) === 'true') {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    rows = rows.filter(r => {
      const u = r.updated_at ? Date.parse(r.updated_at + 'Z') : 0;
      const c = r.last_comment_at ? Date.parse(r.last_comment_at + 'Z') : 0;
      const last = Math.max(u || 0, c || 0);
      return last && last < cutoff;
    });
  }

  res.json(rows);
});

// Clear worktree metadata on a task. Filesystem removal is done by the CLI.
// Accept `force` from either JSON body or query string (not all HTTP clients
// send bodies on DELETE).
app.delete('/api/tasks/:id/worktree', (req, res) => {
  const id = req.params.id;
  const force = !!((req.body && req.body.force) || req.query.force === 'true');
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!task) return res.status(404).json({ error: 'not found' });

  db.prepare(
    "UPDATE tasks SET worktree_path = NULL, branch_name = NULL, updated_at = datetime('now') WHERE id = ?"
  ).run(id);

  db.prepare('INSERT INTO comments (task_id, author, content) VALUES (?, ?, ?)').run(
    id, 'System',
    `Worktree metadata cleared${force ? ' (force)' : ''}. CLI performs filesystem removal.`
  );

  const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  res.json(updated);
});

// --- Project notes (nested sub-pages) ---
//
// Tree of notes per project. Flat list returned — client builds the tree
// from parent_id. `position` is a float so reorders don't require a full
// renumber (insert between two nodes by averaging their positions).

// Defense-in-depth: reject a reparent that would create a cycle. Walks up
// the chain from the proposed new parent; if we hit the node itself, it's
// a descendant of `noteId` and the move must be rejected.
function wouldCreateCycle(noteId, newParentId) {
  if (newParentId == null) return false;
  if (Number(newParentId) === Number(noteId)) return true;
  const getParent = db.prepare(
    'SELECT parent_id, project_id FROM project_notes WHERE id = ?'
  );
  let cur = getParent.get(newParentId);
  let guard = 0;
  while (cur && cur.parent_id != null) {
    if (Number(cur.parent_id) === Number(noteId)) return true;
    if (++guard > 1000) return true; // pathological; treat as cycle
    cur = getParent.get(cur.parent_id);
  }
  return false;
}

app.get('/api/projects/:id/notes', (req, res) => {
  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'project not found' });
  const rows = db.prepare(
    `SELECT id, project_id, parent_id, title, content, position, icon, created_at, updated_at
       FROM project_notes
      WHERE project_id = ?
      ORDER BY position, id`
  ).all(req.params.id);
  res.json(rows);
});

app.post('/api/projects/:id/notes', (req, res) => {
  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'project not found' });
  const { title, parent_id, content, position } = req.body || {};

  // Validate parent: must exist and belong to this project.
  if (parent_id != null) {
    const parent = db.prepare(
      'SELECT id, project_id FROM project_notes WHERE id = ?'
    ).get(parent_id);
    if (!parent) return res.status(400).json({ error: 'parent_id not found' });
    if (parent.project_id !== project.id) {
      return res.status(400).json({ error: 'parent_id belongs to a different project' });
    }
  }

  // Compute default position (max + 1 among siblings) if not provided.
  let pos = position;
  if (typeof pos !== 'number') {
    const row = db.prepare(
      `SELECT COALESCE(MAX(position), -1) AS m
         FROM project_notes
        WHERE project_id = ? AND (parent_id IS ?)`
    ).get(project.id, parent_id == null ? null : Number(parent_id));
    pos = Number(row.m) + 1;
  }

  const result = db.prepare(
    `INSERT INTO project_notes (project_id, parent_id, title, content, position)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    project.id,
    parent_id == null ? null : Number(parent_id),
    (title && String(title).trim()) || 'Untitled',
    content || '',
    pos
  );
  const note = db.prepare('SELECT * FROM project_notes WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(note);
});

app.get('/api/notes/:id', (req, res) => {
  const note = db.prepare('SELECT * FROM project_notes WHERE id = ?').get(req.params.id);
  note ? res.json(note) : res.status(404).json({ error: 'not found' });
});

app.put('/api/notes/:id', (req, res) => {
  const id = Number(req.params.id);
  const cur = db.prepare('SELECT * FROM project_notes WHERE id = ?').get(id);
  if (!cur) return res.status(404).json({ error: 'not found' });

  const body = req.body || {};
  const fields = [];
  const values = [];

  if (body.title !== undefined) {
    fields.push('title = ?');
    values.push((String(body.title).trim()) || 'Untitled');
  }
  if (body.content !== undefined) {
    fields.push('content = ?');
    values.push(String(body.content));
  }
  if (body.icon !== undefined) {
    // Nullable; empty string also clears the icon.
    const raw = body.icon == null ? null : String(body.icon);
    fields.push('icon = ?');
    values.push(raw && raw.length ? raw : null);
  }
  if (body.position !== undefined) {
    if (typeof body.position !== 'number' || Number.isNaN(body.position)) {
      return res.status(400).json({ error: 'position must be a number' });
    }
    fields.push('position = ?');
    values.push(body.position);
  }
  if (body.parent_id !== undefined) {
    const newParent = body.parent_id == null ? null : Number(body.parent_id);
    if (newParent != null) {
      const parent = db.prepare(
        'SELECT id, project_id FROM project_notes WHERE id = ?'
      ).get(newParent);
      if (!parent) return res.status(400).json({ error: 'parent_id not found' });
      if (parent.project_id !== cur.project_id) {
        return res.status(400).json({ error: 'parent_id belongs to a different project' });
      }
      if (wouldCreateCycle(id, newParent)) {
        return res.status(400).json({ error: 'move would create a cycle' });
      }
    }
    fields.push('parent_id = ?');
    values.push(newParent);
  }

  if (!fields.length) return res.status(400).json({ error: 'nothing to update' });
  fields.push("updated_at = datetime('now')");
  values.push(id);
  db.prepare(`UPDATE project_notes SET ${fields.join(', ')} WHERE id = ?`).run(...values);

  const note = db.prepare('SELECT * FROM project_notes WHERE id = ?').get(id);
  res.json(note);
});

app.delete('/api/notes/:id', (req, res) => {
  const info = db.prepare('DELETE FROM project_notes WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'not found' });
  res.status(204).end();
});

// Convenience: move = parent_id + position in one call. Same semantics as PUT.
app.post('/api/notes/:id/move', (req, res) => {
  const id = Number(req.params.id);
  const cur = db.prepare('SELECT * FROM project_notes WHERE id = ?').get(id);
  if (!cur) return res.status(404).json({ error: 'not found' });

  const { parent_id, position } = req.body || {};
  const newParent = parent_id === undefined ? cur.parent_id : (parent_id == null ? null : Number(parent_id));

  if (newParent != null) {
    const parent = db.prepare(
      'SELECT id, project_id FROM project_notes WHERE id = ?'
    ).get(newParent);
    if (!parent) return res.status(400).json({ error: 'parent_id not found' });
    if (parent.project_id !== cur.project_id) {
      return res.status(400).json({ error: 'parent_id belongs to a different project' });
    }
    if (wouldCreateCycle(id, newParent)) {
      return res.status(400).json({ error: 'move would create a cycle' });
    }
  }

  let pos = position;
  if (typeof pos !== 'number') {
    const row = db.prepare(
      `SELECT COALESCE(MAX(position), -1) AS m
         FROM project_notes
        WHERE project_id = ? AND (parent_id IS ?) AND id != ?`
    ).get(cur.project_id, newParent, id);
    pos = Number(row.m) + 1;
  }

  db.prepare(
    `UPDATE project_notes
        SET parent_id = ?, position = ?, updated_at = datetime('now')
      WHERE id = ?`
  ).run(newParent, pos, id);

  const note = db.prepare('SELECT * FROM project_notes WHERE id = ?').get(id);
  res.json(note);
});

// --- Comments ---

app.get('/api/tasks/:id/comments', (req, res) => {
  res.json(db.prepare('SELECT * FROM comments WHERE task_id = ? ORDER BY created_at').all(req.params.id));
});

app.post('/api/tasks/:id/comments', (req, res) => {
  const { author, content } = req.body;
  if (!content) return res.status(400).json({ error: 'content required' });
  const result = db.prepare(
    'INSERT INTO comments (task_id, author, content) VALUES (?, ?, ?)'
  ).run(req.params.id, author || 'Agent', content);
  res.status(201).json(db.prepare('SELECT * FROM comments WHERE id = ?').get(result.lastInsertRowid));
});

// Recent activity across a project (comments joined with task + project).
app.get('/api/projects/:id/activity', (req, res) => {
  const rows = db.prepare(
    `SELECT c.id, c.task_id, c.author, c.content, c.created_at,
            t.name as task_name, t.status as task_status
       FROM comments c
       JOIN tasks t ON c.task_id = t.id
      WHERE t.project_id = ?
      ORDER BY c.created_at DESC
      LIMIT 100`
  ).all(req.params.id);
  res.json(rows);
});

// --- Cross-page search (for @-mentions) ---
//
// Single query over projects.name and project_notes.title. `limit` caps the
// total, split evenly across the two types. Ordered by match position first
// (prefix > substring), then length (shorter = more specific).

app.get('/api/search', (req, res) => {
  const q = String(req.query.q || '').trim();
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);

  if (!q) return res.json({ projects: [], notes: [] });

  // Escape LIKE wildcards so a query like "50%" doesn't become a wildcard.
  const escaped = q.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  const like = `%${escaped}%`;
  const half = Math.ceil(limit / 2);

  const projects = db.prepare(
    `SELECT id, slug, name
       FROM projects
      WHERE name LIKE ? ESCAPE '\\'
      ORDER BY INSTR(LOWER(name), LOWER(?)), LENGTH(name), name
      LIMIT ?`
  ).all(like, q, half);

  const notes = db.prepare(
    `SELECT n.id, n.project_id, n.title, p.slug AS project_slug, p.name AS project_name
       FROM project_notes n
       JOIN projects p ON n.project_id = p.id
      WHERE n.title LIKE ? ESCAPE '\\'
      ORDER BY INSTR(LOWER(n.title), LOWER(?)), LENGTH(n.title), n.title
      LIMIT ?`
  ).all(like, q, half);

  res.json({ projects, notes });
});

// --- Health ---

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// --- Serve frontend ---

// Local dev: server/ sits next to dashboard/, so dist is one level up.
// Container (Dockerfile): WORKDIR is /app, dist is copied to /app/dashboard/dist.
// Check for index.html (not just the directory) so an empty/stale dist
// folder doesn't win over a valid sibling layout.
const distPath = [
  join(__dirname, '..', 'dashboard', 'dist'),
  join(__dirname, 'dashboard', 'dist'),
].find((p) => existsSync(join(p, 'index.html')));
if (distPath) {
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(join(distPath, 'index.html'));
    }
  });
}

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`AgentBoard running on port ${PORT}`);
});

// Start background PR URL poller; capture the handle so we can stop it
// during graceful shutdown.
const prPoller = startPrPoller(db);

// Graceful shutdown for `restart: unless-stopped` and any other supervisor
// that sends SIGTERM. Docker's default grace period before SIGKILL is 10s,
// so each step has its own short bound. Order: stop accepting new work
// (server.close) -> stop background pollers -> end SSE streams with a
// goodbye event so dashboards reconnect cleanly -> checkpoint and close
// the SQLite WAL via db.close.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] received ${signal}, draining...`);

  // Hard deadline: if anything below hangs, force-exit before Docker SIGKILLs.
  const killTimer = setTimeout(() => {
    console.warn('[shutdown] timeout reached, force-exiting');
    process.exit(1);
  }, 8000);
  killTimer.unref();

  // Stop accepting new HTTP connections; existing ones get a chance to drain.
  server.close((err) => {
    if (err) console.warn(`[shutdown] server.close: ${err.message}`);
  });

  // Stop the PR poller's setInterval so it doesn't fire mid-shutdown.
  prPoller.stop?.();

  // Tell every connected SSE client we're going away so their reconnect
  // backoff fires immediately instead of waiting for TCP timeout.
  closeAllSSE();

  // Checkpoint the WAL and release the DB file. better-sqlite3 is sync.
  try {
    db.close();
  } catch (e) {
    console.warn(`[shutdown] db.close: ${e.message}`);
  }

  clearTimeout(killTimer);
  console.log('[shutdown] complete');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
