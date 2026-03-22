import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';

const DATA_DIR = process.env.DATA_DIR || './data';
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(`${DATA_DIR}/agentboard.db`);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    status TEXT DEFAULT 'Active' CHECK(status IN ('Active','Paused','Idea','Archived')),
    category TEXT DEFAULT '',
    priority TEXT DEFAULT 'P2' CHECK(priority IN ('P0','P1','P2','P3')),
    repo_url TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    status TEXT DEFAULT 'Backlog' CHECK(status IN ('Backlog','Brainstorming','In Progress','In Review','Done','Cancelled')),
    priority TEXT DEFAULT 'Medium' CHECK(priority IN ('Urgent','High','Medium','Low')),
    assignee TEXT DEFAULT 'Unassigned' CHECK(assignee IN ('Human','Agent','Unassigned')),
    labels TEXT DEFAULT '[]',
    size TEXT DEFAULT '' CHECK(size IN ('','XS','S','M','L','XL')),
    rounds INTEGER DEFAULT 0,
    due_date TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    author TEXT DEFAULT 'Agent',
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
  CREATE INDEX IF NOT EXISTS idx_comments_task ON comments(task_id);
`);

// Migrations for existing databases
const cols = db.prepare("PRAGMA table_info(projects)").all().map(c => c.name);
if (!cols.includes('notes')) {
  db.exec("ALTER TABLE projects ADD COLUMN notes TEXT DEFAULT ''");
}

const taskCols = db.prepare("PRAGMA table_info(tasks)").all().map(c => c.name);
if (!taskCols.includes('rounds')) {
  db.exec("ALTER TABLE tasks ADD COLUMN rounds INTEGER DEFAULT 0");
}

// Migrate old statuses: Todo → Backlog (todos auto-create backlogs now)
db.exec("UPDATE tasks SET status = 'Backlog' WHERE status = 'Todo'");

export default db;
