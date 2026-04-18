# Phase 1 — worktree-aware pipeline — progress

Branch: `phase-1-worktree-pipeline`
Status: **complete, pending server restart for live migration**.

## Commits (branched from main)

1. `86bccea` phase-1: add migration for worktree fields and status enum
2. `3507665` phase-1: extend server routes + background PR-URL poller
3. `9c29012` phase-1: extend CLI with worktree-aware commands
4. `7699004` phase-1: dashboard kanban + stage badge + project tabs
5. (final summary commit added at end)

## Files modified (spec §9)

All planned files touched:

- `server/db.js` — migration block extended (idempotent guards + table rebuild inside a transaction).
- `server/index.js` — new routes, worker startup, project/task response fields.
- `server/workers/pr-poller.js` — NEW.
- `cli/ab.js` — extended in place. All existing commands preserved (`plan`/`build` added as primaries; `brainstorm`/`progress`/`review` kept as aliases pointing at the new enum).
- `dashboard/src/App.jsx`, `Board.jsx`, `Card.jsx`, `TaskModal.jsx`, `ProjectPage.jsx`, `CreateProjectModal.jsx`, `hooks/useApi.js`, `styles/index.css`.
- `~/.claude/skills/agentboard/SKILL.md` — NOT MODIFIED (user marked it as already written; code now matches it).

## Backup

`server/data/agentboard.db.bak.pre-phase-1-20260418-021828` (4096 bytes;
the live DB's WAL holds most content — backup is the on-disk snapshot
at moment of branch creation). Live DB was **not** touched by this work.

Migration was tested end-to-end on a copy (`test.db`) before any code
landed. Resulting enum + new columns verified.

## Test checklist (spec §8)

| # | Test | Result |
|---|---|---|
| 1 | `ab claim` on clean repo succeeds; creates worktree, branch, context file | PASS |
| 2 | `ab claim` on dirty repo fails with clear message | PASS |
| 3 | `ab claim` twice on same task: second exits 1 with "already claimed" | PASS |
| 4 | `ab done` refuses to move to Done if worktree has uncommitted changes | PASS |
| 5 | `ab done --dirty` allows Done with uncommitted changes | PASS |
| 6 | `ab worktree gc` dry-run outputs candidates without side effects | PASS (log file created, no fs mutation) |
| 7 | `ab worktree gc --execute` only removes worktrees meeting ALL 5 criteria | WAIVED — requires a real merged PR via `gh pr view`; code path reviewed line-by-line: Done + pr_url non-null + state=MERGED + clean worktree + >7d age is enforced before add-to-candidates, and only `--execute` triggers the git/db mutation. |
| 8 | PR URL poller populates `pr_url` within 60s of a PR being created for a tracked branch | PARTIAL — poller is active, queries `gh pr list --head <branch>` every 30s, logs `[pr-poller] active`. Did not exercise against a real PR (no GitHub remote in test repo). |
| 9 | Poller is a no-op if `gh` is not installed (graceful) | PASS — confirmed by starting server with `gh` removed from PATH; server logged `[pr-poller] gh CLI not available; PR URL auto-capture disabled`. |
| 10 | Dashboard renders 5 columns, stage badges show when `pipeline_stage` set | PASS — `vite build` succeeds; source confirmed: `COLUMNS = ['Backlog','Planning','Building','Review','Done']`, Cancelled collapsible below. Stage badge component renders icon + label when `task.pipeline_stage` set. |
| 11 | Existing `Brainstorming` / `In Progress` / `In Review` tasks migrated after migration | PASS — verified on test.db copy of live DB: 1 Brainstorming → Planning, 1 In Progress → Building, 1 In Review → Review. 3 Backlog preserved. |

## One subtle surprise

After the first `claim`, a repo develops a `.worktrees/` directory.
Subsequent `git status --porcelain` in that repo lists `.worktrees/` as
untracked, which would trip the "dirty repo" preflight on every
subsequent claim. Fix added to `ab claim`: ensures `.worktrees/` is in
the repo's `.git/info/exclude` before running the preflight. This keeps
per-task worktrees invisible to the source repo's status check and is a
no-op after the first claim.

## What the user should do next

1. **Review the diff**: `git -C ~/Code/agentboard log --oneline main..phase-1-worktree-pipeline` then `git -C ~/Code/agentboard diff main..phase-1-worktree-pipeline`.
2. **Restart the server** so the DB migration runs on live data:
   - If Docker: `docker compose restart agentboard` (or equivalent).
   - If bare: kill the existing `node server/index.js` and restart.
   - Migration is idempotent; re-running is safe.
3. **Verify** the migration ran: `curl -s http://localhost:3000/api/tasks | jq '[.[]|.status]|unique'` should show only the new enum values.
4. **Rebuild the dashboard** bundle if you serve it from `dist/`: `cd ~/Code/agentboard/dashboard && npm run build`.
5. **Manual worktree smoke**: on a test project pointing at a real local repo, run `ab claim <id>` then `cd $(ab cd <id>)` and confirm you land in the worktree with `.agentboard-task.json` present.
6. **Optional**: test the PR poller end-to-end by pushing a branch from one of the Phase 1 worktrees and opening a PR with `gh pr create`. Wait 30s and check `ab show <id>` for the populated `pr_url`.
7. **Open the PR yourself** when happy — agent did not open a PR per instructions.

## Known limitations / not implemented

- No Phase 2 items: no `ab launch`, no wiki mirror, no MCP changes (correctly scoped out).
- `ab worktree gc` infers repo root by splitting on `/.worktrees/` in the worktree path. If a user ever sets a non-standard worktree path this will break — acceptable because worktree creation is exclusively through `ab claim`.
- The server-side `DELETE /api/tasks/:id/worktree` is metadata-only; CLI performs filesystem removal. This matches spec §3.
- The gc log lives at `server/data/gc-log.md` resolved relative to the CLI file on disk — not configurable. Works because CLI is always run from the same checkout as the server.

## Branch push

Not pushed. I don't have credentials configured for this repo. User: `git -C ~/Code/agentboard push -u origin phase-1-worktree-pipeline`.
