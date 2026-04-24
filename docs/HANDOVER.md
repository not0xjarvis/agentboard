# AgentBoard — Handover

Current state and next steps, written for a fresh Claude Code session (or the user returning after a break).

Last updated: 2026-04-22

---

## Where things stand

**Phase 1 shipped and merged.** v0.2.0 on `main`. PR #1 merged. Running at http://localhost:3000 on the Mac mini via `node index.js` out of `~/Code/agentboard/server/` (not a LaunchAgent — runs as a foreground process adopted by launchd).

**What Phase 1 delivered:**
- Pipeline: `Backlog → Planning → Building → Review → Done` (+ Cancelled), plus `pipeline_stage` sub-marker (`design | plan | impl | review | ship | qa`)
- `ab claim <id>` — atomic CAS, creates per-task git worktree at `<repo>/.worktrees/tsk-<id>-<slug>/`, writes `.agentboard-task.json` context file
- `ab cd <id>`, `ab next <id>`, `ab status <id> <target>`, `ab stage <id> <stage>`
- `ab worktree list [--stale]`, `ab worktree gc [--execute]` (dry-run by default), `ab worktree remove <id> [--force]`
- `ab done <id>` refuses if worktree dirty (use `--dirty` to override)
- Background PR URL poller (`server/workers/pr-poller.js`) — captures PR URL via `gh pr list` within 30s of a PR opening on a tracked branch
- Dashboard: 5 kanban columns + stage badges + `/project/:slug` detail page with Tasks / Notes / Activity tabs
- Server routes: `POST /api/tasks/:id/claim-atomic`, `GET /api/worktrees`, `DELETE /api/tasks/:id/worktree`, `GET /api/projects/slug/:slug`, `GET /api/projects/:id/activity`
- Claude Code skill at `~/.claude/skills/agentboard/SKILL.md` teaching agents the full pipeline

Reference files in this repo:
- `docs/PHASE_1_SPEC.md` — the original spec we implemented against
- `docs/PHASE_1_PROGRESS.md` — what got tested, what was waived

---

## Known issues to fix

### 1. PR URL poller never exercised end-to-end

We tested with no real PRs against agentboard branches. Poller runs and logs activity but we haven't seen it populate a `pr_url` in production. First live PR on a claimed task will validate (or break) this.

### 2. `ab worktree gc` unverified on real merged PR

Dry-run works, `--execute` code path reviewed line-by-line, but no actual merged PR has aged >7 days to test removal. Will get its first real test once any Phase 1 task goes through the full lifecycle.

---

## Operational TODOs (small, blocking nothing)

- [x] **SelfStack** → `/Users/jarvis/Code/self-stack` (not `selfstack-registry` — that's the app-discovery registry, a separate project)
- [x] Created new projects with repo_url set: **Vibe Leaderboard** (id=4), **Meridian** (id=5), **Binder** (id=6)
- [x] Created **FitCheck** (id=7) as a stub — no repo_url yet. Repo lives at `git@github.com:not0xjarvis/fitcheck.git`. Needs to be cloned locally and repo_url set before tasks can be claimed. (Was called "FitKey" in the previous handover; renamed.)
- [ ] Write real project `notes` content for each project (replaces CLAUDE.md for agents). Highest value on the ones that will see agent work: Meridian, Binder, Vibe Leaderboard.
- [ ] Clone FitCheck locally, then `curl -X PUT http://localhost:3000/api/projects/7 -H 'Content-Type: application/json' -d '{"repo_url":"/Users/jarvis/Code/fitcheck"}'`.

### Tailscale / mobile access

AgentBoard is reachable from any device on the tailnet at **http://100.116.1.55:3000** (mac mini's tailscale IP). The server already binds `0.0.0.0` — no config change needed. Bookmark this on the phone.

---

## Phase 2 — deferred on purpose, ready when you are

These were explicitly scoped out of Phase 1. Add when you've proven Phase 1 patterns in daily use.

### 2a. `ab launch` — spawn Claude Code session inside worktree

`ab launch <id>` should:
1. Do everything `ab claim` does (atomic claim + worktree + context file)
2. Then spawn a new `claude` process with cwd set to the worktree
3. The spawned session reads `.agentboard-task.json` on startup and knows what task it's on

This is the Symphony equivalent — one command to fleet-of-agents-chewing-through-backlog. Skip until you've actually been running >1 agent in parallel and found yourself wishing for this.

### 2b. Wiki two-way mirror for tasks

Tasks should have a markdown source of truth at `~/wiki/projects/<slug>/tasks/<id>/` — task body, plan (post-autoplan), decisions, links to PR.

**Why:** durability (survive worktree GC), grep-ability (heartbeats query wiki directly instead of hitting AgentBoard API), mobile access (Obsidian on phone).

**How:** file watcher in server process. On task write → emit markdown. On markdown edit (via Obsidian, vim, etc.) → reconcile to DB. Conflict resolution: DB wins on field collisions, markdown wins on body/notes. This is the bigger piece — plan ~1 day of work.

### 2c. Symphony-inspired agent queue

Tag a task with `agent-ready`. Run `ab agent claim` (global, not per-task). The CLI:
1. Finds oldest task tagged `agent-ready` not yet claimed
2. Does `ab launch` on it
3. Reports back when the agent's session ends

Pairs with 2a. Lets you batch work and walk away.

---

## Phase 3 — HEARTBEAT integrations (already designed, waiting on Phase 2 stability)

These cron jobs were scoped during the Phase 1 design session but held back until AgentBoard settles. Spec in `~/.openclaw/workspace/HEARTBEAT.md` under "Deferred until AgentBoard matures":

- **`new-task-watcher`** (hourly): diff `ab tasks --status Backlog --json` across projects, iMessage on new items
- **`project-status`** (Monday 08:00 PT): `ab activity --since 7d --per-project --json`, write to `~/wiki/reports/YYYY-MM-DD/`, iMessage TL;DR
- **`left-off-journal`** (Friday 17:00 PT): per-project "where did I leave off" (last commit, open PR, last wiki note), append to shared iCloud note
- **`cross-project-pulse`** (Sunday 19:00 PT): flag any project untouched 14+ days
- **`worktree-gc`** (Sunday 09:30 PT): dry-run `ab worktree gc`, iMessage candidates

Add these after you've used Phase 1 for 1-2 weeks without surprises. Once added, they need the `ab activity` CLI verb that doesn't exist yet — plan for a small CLI extension before wiring them.

---

## Missing CLI verbs (for Phase 3 wiring)

- `ab activity --since <duration> [--json] [--per-project]` — comment + status-change timeline
- `ab tasks --status Backlog --json` (partially exists as `ab backlog`, needs `--json` flag for structured output)
- `ab stats` — roll-up counts per project (open/done/in-progress by status)

---

## Key references

- **Repo:** `~/Code/agentboard/` — git-tracked, origin = `github.com:not0xjarvis/agentboard`
- **Running:** `http://localhost:3000` — started via `cd ~/Code/agentboard/server && DATA_DIR=./data node index.js` (no LaunchAgent, process adopted by launchd after terminal close)
- **DB backup:** `server/data/agentboard.db.bak.pre-phase-1-20260418-021828`
- **Claude Code skill:** `~/.claude/skills/agentboard/SKILL.md`
- **Memory (cross-session):**
  - `~/.claude/projects/-Users-jarvis/memory/reference_agentboard.md`
  - `~/.claude/projects/-Users-jarvis/memory/reference_macos_tcc_cli.md` (relevant if any AgentBoard tool later needs Calendar/Contacts/etc)
- **Phase 1 PR:** https://github.com/not0xjarvis/agentboard/pull/1 (merged)
- **Commit range for Phase 1:** `main` commit `653acd3` (merge) — diff vs main's prior tip contains all Phase 1 work

## How to restart the server if it stops

```bash
cd ~/Code/agentboard/server
DATA_DIR=./data nohup node index.js > /tmp/agentboard.log 2>&1 &
```

Then verify: `curl http://localhost:3000/api/health` → `{"status":"ok"}`.

To make it a real LaunchAgent (survives reboots without you starting it manually) — not done yet, low priority since the mini rarely reboots.

---

## If you're picking this up cold

Open with: `ab tasks --status Building` to see what was in flight. Read `PHASE_1_SPEC.md` if you need context on why the pipeline looks the way it does. Read `PHASE_1_PROGRESS.md` for what was verified vs waived.

If you're a new agent session: `~/.claude/skills/agentboard/SKILL.md` is the teaching doc — it's authoritative over anything in this handover.
