# Changelog

## [0.2.0] — 2026-04-18

### Worktree-aware task pipeline

You can now run multiple agents in parallel, one per task, with zero collisions. Each claim spins up an isolated git worktree so Claude Code sessions on different tasks never step on each other's working tree.

- **New pipeline:** `Backlog → Planning → Building → Review → Done` (+ Cancelled). Ship and QA are sub-stages within Review so the board stays scannable.
- **Claim a task, get a worktree:** `ab claim <id>` atomically claims the task and creates `<project-repo>/.worktrees/tsk-<id>-<slug>/` on a fresh branch. Enter it with `cd $(ab cd <id>)`.
- **Never step on yourself:** concurrent `ab claim` calls on the same task resolve deterministically — one wins, the other gets a clear "already claimed" error.
- **Stage badges:** tasks carry an optional `pipeline_stage` (design, plan, impl, review, ship, qa) that shows on the card so you know what step you're on without opening it.
- **Auto PR capture:** a background poller catches the GitHub PR URL via `gh pr list` within 30 seconds of `/ship` — no need to manually `ab update --pr_url`.
- **Safe GC:** `ab worktree gc` is dry-run by default. Even with `--execute`, it only removes worktrees where the PR is merged, the tree is clean, the task has been Done more than 7 days, and every other safety gate holds. Nothing gets deleted by accident.
- **Per-project dashboard page:** `/project/<slug>` now has Tasks, Notes, and Activity tabs. Project `notes` becomes your project's CLAUDE.md equivalent.
- **Claude Code skill rewritten:** `~/.claude/skills/agentboard/SKILL.md` now teaches agents the full gstack/superpowers pipeline and how to log progress.

### Under the hood

- `projects.slug` is now a stored column with a unique index (not derived), so project renames don't invalidate branch names or paths.
- `tasks` table rebuilt to migrate the status enum. `Brainstorming → Planning`, `In Progress → Building`, `In Review → Review`. Idempotent migration inside a transaction; existing data preserved.
- Atomic CAS on both `/api/tasks/:id/claim` (legacy) and `/api/tasks/:id/claim-atomic`.
- Server routes: `GET /api/worktrees`, `DELETE /api/tasks/:id/worktree`, `GET /api/projects/slug/:slug`, `GET /api/projects/:id/activity`.
- Background worker `server/workers/pr-poller.js` queries `gh pr list` every 30s for tasks in `Review`/`Done` with no `pr_url`. Graceful no-op if `gh` isn't installed.
- Full spec preserved at `docs/PHASE_1_SPEC.md`.

## [0.1.0] — initial

- Express + SQLite backend, React dashboard, CLI (`ab`), MCP server.
- 5-status task pipeline with round-tracking and comment activity log.
