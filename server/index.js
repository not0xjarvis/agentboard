import express from 'express';
import cors from 'cors';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import db from './db.js';

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

app.post('/api/projects', (req, res) => {
  const { name, description, notes, status, category, priority, repo_url } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const result = db.prepare(
      `INSERT INTO projects (name, description, notes, status, category, priority, repo_url)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(name, description || '', notes || '', status || 'Active', category || '', priority || 'P2', repo_url || '');
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(project);
  } catch (e) {
    res.status(409).json({ error: e.message });
  }
});

app.put('/api/projects/:id', (req, res) => {
  const fields = ['name', 'description', 'notes', 'status', 'category', 'priority', 'repo_url'];
  const updates = [];
  const values = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) { updates.push(`${f} = ?`); values.push(req.body[f]); }
  }
  if (!updates.length) return res.status(400).json({ error: 'nothing to update' });
  updates.push("updated_at = datetime('now')");
  values.push(req.params.id);
  db.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  project ? res.json(project) : res.status(404).json({ error: 'not found' });
});

app.delete('/api/projects/:id', (req, res) => {
  db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

// --- Tasks ---

app.get('/api/tasks', (req, res) => {
  let sql = `SELECT t.*, p.name as project_name FROM tasks t LEFT JOIN projects p ON t.project_id = p.id`;
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
    'SELECT t.*, p.name as project_name FROM tasks t LEFT JOIN projects p ON t.project_id = p.id WHERE t.id = ?'
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
  // Detect round increment: moving back to Brainstorming from In Review or In Progress
  const current = db.prepare('SELECT status, rounds FROM tasks WHERE id = ?').get(req.params.id);
  let roundBump = 0;
  if (current && req.body.status === 'Brainstorming' && ['In Review', 'In Progress'].includes(current.status)) {
    roundBump = 1;
  }

  const fields = ['name', 'project_id', 'description', 'status', 'priority', 'assignee', 'labels', 'size', 'due_date'];
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
  db.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const task = db.prepare(
    'SELECT t.*, p.name as project_name FROM tasks t LEFT JOIN projects p ON t.project_id = p.id WHERE t.id = ?'
  ).get(req.params.id);

  // Auto-comment on round increment
  if (roundBump && task) {
    db.prepare('INSERT INTO comments (task_id, author, content) VALUES (?, ?, ?)').run(
      task.id, 'System', `Round ${task.rounds} — back to brainstorming`
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
    `SELECT t.*, p.name as project_name FROM tasks t
     LEFT JOIN projects p ON t.project_id = p.id
     WHERE t.status = 'Backlog' AND t.assignee IN ('Agent', 'Unassigned')
     ORDER BY CASE t.priority WHEN 'Urgent' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 WHEN 'Low' THEN 3 END, t.created_at`
  ).all();
  res.json(tasks);
});

app.post('/api/tasks/:id/claim', (req, res) => {
  const { assignee } = req.body;
  // Claiming moves to Brainstorming (first step after Backlog)
  db.prepare(
    "UPDATE tasks SET status = 'Brainstorming', assignee = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(assignee || 'Agent', req.params.id);
  const task = db.prepare(
    'SELECT t.*, p.name as project_name FROM tasks t LEFT JOIN projects p ON t.project_id = p.id WHERE t.id = ?'
  ).get(req.params.id);
  if (task) {
    db.prepare('INSERT INTO comments (task_id, author, content) VALUES (?, ?, ?)').run(
      task.id, assignee || 'Agent', 'Claimed task — starting brainstorm'
    );
  }
  task ? res.json(task) : res.status(404).json({ error: 'not found' });
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
});
