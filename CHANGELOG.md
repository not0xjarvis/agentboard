# Changelog

## [0.3.0] — 2026-04-24

### Notion-grade markdown editor + light mode

The Notes pane in the project drawer was a plain textarea. Markdown was stored but never rendered. Typing `# Header` showed `# Header`, not a header. If you came from Notion, the regression was the main thing keeping you on Notion.

Replaced with a Milkdown/Crepe editor that renders live. Type `# Heading` and the line styles itself. Type `- [ ] Task` and a checkbox appears, click to toggle. Type `/` and a slash menu opens with heading, list, todo, code, quote, table, divider. Code blocks get syntax highlighting via CodeMirror. Existing markdown notes load and render correctly — no migration needed.

Also: **light mode.** Auto-switches on OS preference, or toggle manually via the ☀︎/🌙 button in the header. The whole app, not just the editor — GitHub-light palette for the kanban, project cards, modals, everything.

The editor saves as plain markdown to the same `notes` column. No schema change, no API change. Round-trips byte-clean (modulo trailing newline normalization). Revertible with `git revert` and your notes still display in the old textarea.

- **Live formatting:** type markdown, see formatted output. Headers, lists, todos, code blocks, blockquotes, tables, links, dividers.
- **Slash menu:** `/` opens block insertion. Notion-style.
- **Font:** system sans-serif (Inter/SF/Segoe), no more Noto Serif. Matches the rest of AB.
- **Readable width:** editor content caps at 780px for comfortable line length, Notion-style.
- **Light mode:** OS-preference-driven with manual toggle. Persisted to localStorage under `ab-theme`.
- **Theme propagation:** Crepe's tokens derive from AB's CSS variables — editor follows whatever theme the rest of the app is using.
- **Mobile:** larger font (16px) and tighter padding on phones.
- **Bundle cost:** main chunk grew from ~250KB to ~1.6MB (517KB gz). Lazy-loading the editor on Notes-tab open is a follow-up — fine for a self-hosted dashboard, worth optimizing if it ever ships externally.

### Itemized changes

- New: `dashboard/src/components/NotesEditor.jsx` — Milkdown/Crepe wrapper, listener-based onChange, mount-once with `key={project.id}` for project switching.
- New: `dashboard/src/components/ThemeToggle.jsx` — ☀︎/🌙 button. Reads OS preference as default, persists manual override to localStorage, applies `data-theme` attribute to `<html>`.
- New deps: `@milkdown/crepe`, `@milkdown/core`, `@milkdown/preset-commonmark`, `@milkdown/preset-gfm`, `@milkdown/plugin-slash`, `@milkdown/plugin-listener`, `@milkdown/react`, `@milkdown/theme-nord`.
- Changed: `ProjectPage.jsx:151` — textarea → NotesEditor; existing debounced save unchanged.
- Changed: `App.jsx` — ThemeToggle rendered in header action bar.
- Changed: `styles/index.css` — light-mode CSS variables scoped to `@media (prefers-color-scheme: light)` and `[data-theme="light"]`; `.notes-editor-milkdown` with font-family override (no serif), 780px content max-width, Notion-style spacing; ProseMirror element styles for headings/lists/code/blockquote; mobile breakpoint.
- Out of scope (later): task notes (separate component), slash command for linking other AB pages, image uploads, lazy-load to shrink bundle.

## [0.2.2] — 2026-04-23

### CLI polish

- `ab --help` and `ab -h` now route to the `help` command instead of printing "Unknown command".
- `ab create` refuses names starting with `-` and exits non-zero. Prevents accidental "--help" tasks from being created when someone runs `ab create --help` expecting usage text.

## [0.2.1] — 2026-04-22

### Mobile-friendly dashboard + post-Phase-1 polish

The board now works properly from a phone over Tailscale. Swipe between columns, add tasks, edit notes — no more desktop-only layout.

- **Mobile redesign:** swipeable kanban (one column per screen, scroll-snap), full-screen modals on phones, 16px form inputs so iOS doesn't auto-zoom on focus, wrapping headers and filter bars, safe-area padding for notched devices, and proper `100dvh` handling so the browser's address bar doesn't eat the UI.
- **PWA metadata:** `viewport-fit=cover`, `theme-color`, and `apple-mobile-web-app-*` tags so adding to home screen gives a native-feeling app shell.
- **Worktree-dirty fix:** `ab claim` now appends `.agentboard-task.json` to the repo's `.git/info/exclude` alongside `.worktrees/`. `ab done` no longer falsely trips the "worktree dirty" check and no longer requires `--dirty` on every clean task.
- **Create-task modal bugfix:** the status dropdown was stuck on old statuses (Brainstorming, In Progress, In Review). Replaced with the current pipeline (Planning, Building, Review).
- **Handover doc:** `docs/HANDOVER.md` added — durable write-up of current state, Phase 2/3 queue, operational TODOs, and the Tailscale URL for mobile access.

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
