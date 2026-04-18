# AgentBoard Phase 1: Worktree-Aware Pipeline — Implementation Spec

## Context

Extending `~/Code/agentboard` to support the gstack/superpowers pipeline with per-task git worktrees. Problem solved: parallel agents working on different tasks cannot share one working tree without corrupting each other's work.

See also: `~/.claude/projects/-Users-jarvis/memory/reference_agentboard.md` for project location, run commands, and MCP config.

**Do NOT:** rewrite `cli/ab.js` or `server/db.js`. Extend existing structures only. Keep backward-compatible CLI verbs.

## 1. Schema migration (`server/db.js`)

Apply these migrations *after* the existing migrations block. All operations must be idempotent (guards required).

### 1a. Add `projects.slug`

Source of truth for branch/path construction. Never derived at runtime.

```sql
ALTER TABLE projects ADD COLUMN slug TEXT;
UPDATE projects SET slug = LOWER(REPLACE(REPLACE(name, ' ', '-'), '_', '-'))
  WHERE slug IS NULL OR slug = '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_slug ON projects(slug);
```

### 1b. Task lifecycle fields

```sql
ALTER TABLE tasks ADD COLUMN worktree_path TEXT;
ALTER TABLE tasks ADD COLUMN branch_name TEXT;
ALTER TABLE tasks ADD COLUMN pr_url TEXT;
ALTER TABLE tasks ADD COLUMN pipeline_stage TEXT;
-- Validate pipeline_stage in app: null | 'design' | 'plan' | 'impl' | 'review' | 'ship' | 'qa'
```

### 1c. Status enum migration

Existing CHECK: `('Backlog','Brainstorming','In Progress','In Review','Done','Cancelled')`
New CHECK: `('Backlog','Planning','Building','Review','Done','Cancelled')`

Data mapping:
- `Brainstorming` → `Planning`
- `In Progress` → `Building`
- `In Review` → `Review`

SQLite cannot alter a CHECK constraint. Required pattern (inside a transaction):
1. Create `tasks_new` with the new CHECK
2. `INSERT INTO tasks_new SELECT ... CASE status WHEN 'Brainstorming' THEN 'Planning' ... END ... FROM tasks`
3. Drop `tasks`
4. Rename `tasks_new` to `tasks`
5. Rebuild indexes: `idx_tasks_status`, `idx_tasks_project`

Must preserve all columns including the new ones from 1b.

## 2. CLI additions (`cli/ab.js`)

Extend existing file, don't rewrite. Keep all current commands working.

### 2a. New commands

```
ab claim <id> [assignee]
  Atomic claim + worktree creation.

  Behavior:
  1. Resolve project from task.project_id; read project.repo_url and project.slug.
  2. Preflight: in repo_url, run `git status --porcelain`. If not empty:
       print "Project '<name>' has uncommitted changes at <repo_url>. Stash or commit first."
       exit 1
  3. Atomic CAS:
       UPDATE tasks SET status='Planning', assignee=?, pipeline_stage='design'
         WHERE id=? AND status='Backlog'
     If 0 rows affected: print "TSK-<id> is not claimable (already claimed or wrong status). Current status: <s>" exit 1
  4. Compute branch: tsk-<id>-<slug(task.name, max 40 chars)>
     Slug rule: lowercase, alphanumeric + hyphens only, collapse runs of hyphens
  5. Compute worktree_path: <repo_root>/.worktrees/<branch>
  6. Run: git worktree add -b <branch> <worktree_path>
  7. Write <worktree_path>/.agentboard-task.json:
       { id, name, project_slug, status, pipeline_stage, branch, created_at }
  8. UPDATE tasks SET worktree_path=?, branch_name=? WHERE id=?
  9. Print: "Claimed TSK-<id> → Planning (stage=design). Worktree: <path>\n  Enter: cd $(ab cd <id>)"

ab cd <id>
  Print task.worktree_path to stdout (no trailing newline for shell substitution).
  Exit 1 if worktree_path is null with message to stderr.

ab next <id>
  Read task; print status- and stage-specific next action. See section 5 SKILL.md for canonical mapping.

ab status <id> <target>
  General-purpose status transition. Allowed targets: Backlog, Planning, Building, Review, Done, Cancelled.
  Allows back-transitions (e.g., Review → Building if code needs rework).
  Updates updated_at.

ab stage <id> <stage>
  Set pipeline_stage to: design | plan | impl | review | ship | qa | null (use "none" on CLI for null).

ab worktree list [--stale] [--project <slug>]
  Default: rows where worktree_path IS NOT NULL AND status NOT IN ('Done', 'Cancelled').
  --stale: additionally filter to tasks with no status/comment activity in >24h.
  --project: filter to one project's slug.
  Output columns: task_id, name, project, status, stage, branch, worktree_path, last_activity.

ab worktree gc [--execute]
  DRY RUN BY DEFAULT. Prints candidates + exits 0 without filesystem changes.

  Candidate criteria (ALL must hold):
    - task.status = 'Done'
    - task.pr_url IS NOT NULL
    - `gh pr view <pr_url> --json state` returns state='MERGED'
    - `git -C <worktree_path> status --porcelain` is empty
    - task.updated_at is older than 7 days

  With --execute: for each candidate, run in order:
    1. git worktree remove <worktree_path>
    2. git branch -D <branch_name>  (best-effort; log failures, don't abort)
    3. UPDATE tasks SET worktree_path=NULL, branch_name=NULL WHERE id=?

  Always appends to data/gc-log.md: timestamp, task_id, action (candidate|removed|skipped), reason.

ab worktree remove <id> [--force]
  Manual single-task removal. Fails loud if:
    - worktree is dirty (uncommitted tracked changes, `git status --porcelain` non-empty)
    - task.status NOT IN ('Done', 'Cancelled') without --force
  --force skips both checks. Still logs to gc-log.md.
```

### 2b. Extensions to existing commands

```
ab done <id> ["comment"]
  EXTEND: before setting Done, check worktree for uncommitted tracked changes.
  If dirty: print "Worktree has uncommitted changes at <path>. Commit, push, or use --dirty." exit 1
  Accept new flag: --dirty (skip cleanliness check, proceed anyway)
  Does NOT auto-remove worktree. That's GC's job.

ab update <id> ...
  ACCEPT new flags: --pr_url, --pipeline_stage, --worktree_path, --branch_name
  Existing flags unchanged.
```

### 2c. Help text

Update `ab help` output to include new commands and new state machine.

## 3. Server endpoint additions (`server/index.js`)

All return JSON. Errors use `{error: "<message>"}` (existing convention). Use existing CORS + express middleware.

```
POST   /api/tasks/:id/claim-atomic
  Body: { assignee, worktree_path, branch_name }
  Atomic UPDATE with WHERE status='Backlog'. Returns 409 + error if row count = 0.
  Returns the updated task on success.

GET    /api/worktrees?project=<slug>&stale=true
  Returns [{ task_id, name, project_slug, status, stage, branch_name, worktree_path, updated_at, last_comment_at }]
  stale=true filters to rows where GREATEST(updated_at, last_comment_at) < now - 24h.

DELETE /api/tasks/:id/worktree
  Body: { force: bool }
  Updates task: SET worktree_path=NULL, branch_name=NULL.
  Filesystem removal is the CLI's job, not the server's — but server logs the intent.
```

## 4. PR URL background worker

New file: `server/workers/pr-poller.js`
Started from `index.js` at server startup.

```
Loop every 30 seconds:
  1. SELECT id, branch_name FROM tasks
       WHERE status IN ('Review','Done') AND pr_url IS NULL AND branch_name IS NOT NULL
       LIMIT 20
  2. For each row:
       - spawn `gh pr list --head <branch_name> --json url,state --limit 1`
       - on result with PR: UPDATE tasks SET pr_url = <url> WHERE id = ?
       - on error: console.warn, never throw
  3. Rate: max 20 polls per cycle (prevent GitHub API rate limits)

At startup:
  - Check `gh --version`; if not found, log once: "[pr-poller] gh CLI not available; PR URL auto-capture disabled"
  - Otherwise log: "[pr-poller] active, polling every 30s"
```

## 5. Claude Code skill file

Target path: `~/.claude/skills/agentboard/SKILL.md`

(Content provided separately — see that file.)

## 6. Dashboard UI changes (`dashboard/`)

Minimal:
- Kanban column headers: Backlog, Planning, Building, Review, Done (5 columns). Cancelled is a collapsible section below the board or filter-only.
- Task card: add small stage badge if `pipeline_stage` is set. Suggested icons: `◉ impl`, `⇧ ship`, `✓ qa`, `✎ plan`, `☯ design`, `⌕ review`.
- Project detail route `/project/:slug`: three tabs — Tasks (kanban filtered to that project), Notes (existing `project.notes` field), Activity (recent comments across tasks).

Do NOT redesign. Match existing visual style.

## 7. Weekly GC cron

User adds to their OpenClaw HEARTBEAT.md:

```yaml
- schedule: "0 9 * * 0"  # Sunday 09:00
  task: "Run `ab worktree gc` (dry-run) and iMessage me the candidate list. If I reply 'yes', run `ab worktree gc --execute`."
```

GC is DRY-RUN BY DEFAULT. No automatic filesystem modifications.

## 8. Test checklist (minimum)

Before declaring done:

- [ ] `ab claim` on clean repo succeeds; creates worktree, branch, context file
- [ ] `ab claim` on dirty repo fails with clear message
- [ ] `ab claim` twice on same task: second call exits 1 with "already claimed"
- [ ] `ab done` refuses to move to Done if worktree has uncommitted changes
- [ ] `ab done --dirty` allows Done with uncommitted changes
- [ ] `ab worktree gc` dry-run outputs candidates without side effects
- [ ] `ab worktree gc --execute` only removes worktrees meeting ALL 5 criteria
- [ ] PR URL poller populates `pr_url` within 60s of a PR being created for a tracked branch
- [ ] Poller is a no-op if `gh` is not installed (graceful)
- [ ] Dashboard renders 5 columns, stage badges show when `pipeline_stage` set
- [ ] Existing `Brainstorming` / `In Progress` / `In Review` tasks migrated to new statuses after migration

## 9. Files modified

```
server/db.js                          extend migrations block
server/index.js                       add routes + start worker
server/workers/pr-poller.js           NEW
cli/ab.js                             extend commands (keep existing)
dashboard/src/...                     kanban column reduction + stage badge + project detail route
~/.claude/skills/agentboard/SKILL.md  REWRITE (old backed up as SKILL.md.bak.YYYYMMDD)
```

## 10. Out of scope for Phase 1

- `ab launch` (spawn new Claude Code session inside worktree) — Phase 2
- Wiki two-way mirror (markdown source of truth for tasks) — Phase 3
- MCP server changes — future
- Shared dependency caches across worktrees — never (fragile)
- Auto-GC without dry-run — never (user explicitly excluded "deleting important things")
- Symphony-style autonomous task dispatch — Phase 2 or later

## 11. Key design decisions (for reference)

1. **`projects.slug` is stored, not derived.** Renames don't invalidate paths.
2. **Branch naming `tsk-<id>-<slug>`.** Task ID provides uniqueness; slug is cosmetic.
3. **Worktrees live at `<repo>/.worktrees/<branch>`.** Per-project locality.
4. **Plan files live in wiki, not repo.** `~/wiki/projects/<slug>/tasks/<id>/plan.md`. Survives cleanup, queryable by heartbeats.
5. **Atomic CAS on claim.** Single UPDATE with WHERE status='Backlog' prevents races.
6. **GC is dry-run by default.** Explicit `--execute` required. All actions logged.
7. **PR URL captured by polling, not by agent discipline.** Background worker queries `gh`.
8. **Ship and QA are `pipeline_stage` values inside status=Review, not separate statuses.** Keeps kanban scannable.
