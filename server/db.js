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

// --- Phase 1: worktree-aware pipeline migrations ---

// 1a. projects.slug — stored source of truth for branch/path construction
const projCols2 = db.prepare("PRAGMA table_info(projects)").all().map(c => c.name);
if (!projCols2.includes('slug')) {
  db.exec("ALTER TABLE projects ADD COLUMN slug TEXT");
}
db.exec(`
  UPDATE projects
     SET slug = LOWER(REPLACE(REPLACE(name, ' ', '-'), '_', '-'))
   WHERE slug IS NULL OR slug = ''
`);
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_slug ON projects(slug)");

// 1b. Task lifecycle fields
const taskCols2 = db.prepare("PRAGMA table_info(tasks)").all().map(c => c.name);
if (!taskCols2.includes('worktree_path')) {
  db.exec("ALTER TABLE tasks ADD COLUMN worktree_path TEXT");
}
if (!taskCols2.includes('branch_name')) {
  db.exec("ALTER TABLE tasks ADD COLUMN branch_name TEXT");
}
if (!taskCols2.includes('pr_url')) {
  db.exec("ALTER TABLE tasks ADD COLUMN pr_url TEXT");
}
if (!taskCols2.includes('pipeline_stage')) {
  db.exec("ALTER TABLE tasks ADD COLUMN pipeline_stage TEXT");
}

// 1c. Status enum migration: Brainstorming/In Progress/In Review → Planning/Building/Review
// SQLite can't alter a CHECK constraint, so we rebuild the table inside a transaction.
// NOTE: The rebuild preserves all current columns, data, and the two indexes
// (idx_tasks_status, idx_tasks_project). It would NOT preserve triggers, views,
// or FTS indexes if any are ever added. If you add a trigger on `tasks`, also
// recreate it at the end of this migrate() block.
{
  const tasksSql = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='tasks'"
  ).get();
  const needsStatusMigration =
    tasksSql && tasksSql.sql && tasksSql.sql.includes("'Brainstorming'");

  if (needsStatusMigration) {
    const migrate = db.transaction(() => {
      // Rebuild tasks with the new CHECK, preserving every existing column + the new ones.
      db.exec(`
        CREATE TABLE tasks_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
          name TEXT NOT NULL,
          description TEXT DEFAULT '',
          status TEXT DEFAULT 'Backlog' CHECK(status IN ('Backlog','Planning','Building','Review','Done','Cancelled')),
          priority TEXT DEFAULT 'Medium' CHECK(priority IN ('Urgent','High','Medium','Low')),
          assignee TEXT DEFAULT 'Unassigned' CHECK(assignee IN ('Human','Agent','Unassigned')),
          labels TEXT DEFAULT '[]',
          size TEXT DEFAULT '' CHECK(size IN ('','XS','S','M','L','XL')),
          rounds INTEGER DEFAULT 0,
          due_date TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now')),
          worktree_path TEXT,
          branch_name TEXT,
          pr_url TEXT,
          pipeline_stage TEXT
        );
      `);

      db.exec(`
        INSERT INTO tasks_new (
          id, project_id, name, description, status, priority, assignee,
          labels, size, rounds, due_date, created_at, updated_at,
          worktree_path, branch_name, pr_url, pipeline_stage
        )
        SELECT
          id, project_id, name, description,
          CASE status
            WHEN 'Brainstorming' THEN 'Planning'
            WHEN 'In Progress'   THEN 'Building'
            WHEN 'In Review'     THEN 'Review'
            ELSE status
          END AS status,
          priority, assignee, labels, size, rounds, due_date,
          created_at, updated_at,
          worktree_path, branch_name, pr_url, pipeline_stage
        FROM tasks;
      `);

      db.exec(`DROP TABLE tasks;`);
      db.exec(`ALTER TABLE tasks_new RENAME TO tasks;`);

      // Rebuild indexes the original schema had.
      db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);`);
    });
    migrate();
  }
}

export default db;
