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

// --- v0.4.0: nested project notes (TSK-25) ---
//
// A project can now have a tree of notes. The existing projects.notes column
// is preserved for rollback; on first boot after upgrade we migrate any
// non-empty projects.notes into a root-level project_notes row.

db.exec(`
  CREATE TABLE IF NOT EXISTS project_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    parent_id INTEGER REFERENCES project_notes(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT 'Untitled',
    content TEXT NOT NULL DEFAULT '',
    position REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_project_notes_project ON project_notes(project_id);
  CREATE INDEX IF NOT EXISTS idx_project_notes_parent ON project_notes(parent_id);
  CREATE INDEX IF NOT EXISTS idx_project_notes_position ON project_notes(project_id, parent_id, position);
`);

// --- v0.6.0: page icons / emoji (TSK-26) ---
//
// Optional single-emoji icon per project and per note. Nullable — existing
// rows stay null and the UI renders a neutral fallback slot. Checks column
// existence before ALTER so re-running the migration is a no-op.
{
  const projectColsForIcon = db.prepare("PRAGMA table_info(projects)").all().map(c => c.name);
  if (!projectColsForIcon.includes('icon')) {
    db.exec("ALTER TABLE projects ADD COLUMN icon TEXT");
  }
  const noteColsForIcon = db.prepare("PRAGMA table_info(project_notes)").all().map(c => c.name);
  if (!noteColsForIcon.includes('icon')) {
    db.exec("ALTER TABLE project_notes ADD COLUMN icon TEXT");
  }
}

// Idempotent seed: for each project with non-empty notes AND zero rows in
// project_notes for that project, insert a single root note. Subsequent runs
// see non-zero count and skip.
{
  const seed = db.transaction(() => {
    const projects = db.prepare(
      "SELECT id, notes FROM projects WHERE notes IS NOT NULL AND TRIM(notes) != ''"
    ).all();
    const existing = db.prepare(
      'SELECT COUNT(*) AS n FROM project_notes WHERE project_id = ?'
    );
    const insert = db.prepare(
      `INSERT INTO project_notes (project_id, parent_id, title, content, position)
       VALUES (?, NULL, 'Notes', ?, 0)`
    );
    for (const p of projects) {
      const { n } = existing.get(p.id);
      if (n === 0) insert.run(p.id, p.notes);
    }
  });
  seed();
}

// --- v0.8.0: decision queue (Focus tab) ---
//
// An agent that hits a gate it can't answer flips `needs_decision = 1` and
// writes the question to `decision_question`. The task stays in whatever
// status it was in — the flag surfaces it in the Focus tab so the human
// can unblock without re-reading the board.
{
  const taskColsForDecision = db.prepare("PRAGMA table_info(tasks)").all().map(c => c.name);
  if (!taskColsForDecision.includes('needs_decision')) {
    db.exec("ALTER TABLE tasks ADD COLUMN needs_decision INTEGER DEFAULT 0");
  }
  if (!taskColsForDecision.includes('decision_question')) {
    db.exec("ALTER TABLE tasks ADD COLUMN decision_question TEXT");
  }
}

export default db;
