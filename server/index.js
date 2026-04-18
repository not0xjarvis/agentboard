import express from 'express';
import cors from 'cors';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import db from './db.js';
import { startPrPoller } from './workers/pr-poller.js';

const app = express();
const PORT = process.env.PORT || 3000;
const __dirname = dirname(fileURLToPath(import.meta.url));

app.use(cors());
app.use(express.json({ limit: '5mb' }));

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
  const fields = ['name', 'description', 'notes', 'status', 'category', 'priority', 'repo_url', 'slug'];
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
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY CASE t.priority WHEN \'Urgent\' THEN 0 WHEN \'High\' THEN 1 WHEN \'Medium\' THEN 2 WHEN \'Low\' THEN 3 END, t.created_at DESC';
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
  db.prepare(
    "UPDATE tasks SET status = 'Planning', assignee = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(assignee || 'Agent', req.params.id);
  const task = db.prepare(
    'SELECT t.*, p.name as project_name FROM tasks t LEFT JOIN projects p ON t.project_id = p.id WHERE t.id = ?'
  ).get(req.params.id);
  if (task) {
    db.prepare('INSERT INTO comments (task_id, author, content) VALUES (?, ?, ?)').run(
      task.id, assignee || 'Agent', 'Claimed task — moving to Planning'
    );
  }
  task ? res.json(task) : res.status(404).json({ error: 'not found' });
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
app.delete('/api/tasks/:id/worktree', (req, res) => {
  const id = req.params.id;
  const force = !!(req.body && req.body.force);
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

// --- Health ---

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// --- Serve frontend ---

const distPath = join(__dirname, '..', 'dashboard', 'dist');
if (existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(join(distPath, 'index.html'));
    }
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`AgentBoard running on port ${PORT}`);
  // Start background PR URL poller
  startPrPoller(db);
});
