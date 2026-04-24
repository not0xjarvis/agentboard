# Changelog

## [0.5.0] — 2026-04-24

### Projects table view

You can now scan projects as a sortable table instead of grid cards. Useful when you have more than a handful of projects and want to compare priority, status, or last-touched time at a glance.

- **Table view:** Projects tab gains a Grid / Table toggle above the list. Table shows Name, Priority, Status, Category, Repo, and Last Activity as columns. Click any header to sort, click again to reverse. Your view and sort choice persist across reloads.
- **Defaults:** Grid stays the default for first-time visitors. Default sort is most recently updated first. Empty values sort to the bottom regardless of direction.
- **Clickable rows:** clicking a row opens the project detail page just like clicking a card. Repo links open in a new tab without navigating away.
- **Mobile:** the table scrolls horizontally on narrow screens with a sticky header so the column labels stay visible.
- **Theme:** table inherits AB CSS variables so light and dark modes both work.

## [0.4.0] — 2026-04-24

### Nested sub-pages per project

Projects had exactly one notes field. If you were coming from Notion with a project that had "Design", "API spec", "Competitor research", and "Pricing" as sub-pages, you had to flatten the whole thing into one markdown blob. This was the single biggest reason people stayed on Notion.

Fixed. Every project now has a tree of notes. Open a project, hit the Notes tab, and there's a sidebar on the left with your pages; the Milkdown editor fills the right. Click any node to edit it. Hover any node for a `+` (add child) and `⋯` (rename, delete). Drag a note onto another to reparent. Create child notes as deep as you want. Delete a parent and the children cascade with a confirm prompt that tells you exactly how many pages you'll lose.

Every selected note is reflected in the URL as `?note=<id>`, so you can bookmark a specific sub-page or share the link with another agent. Expanded/collapsed state is remembered per project in localStorage so the tree stays the way you left it.

- **Tree sidebar:** 260px wide on desktop, indented by depth, chevrons for expand/collapse, accent highlight on the selected node.
- **Mobile:** tree collapses into a slide-over sheet; a hamburger button at the top of the editor opens it. Single-column on phones; everything fits in 375px.
- **Drag to reorder:** HTML5 drag-and-drop. Drop a note onto another to make it a child. Drop onto empty tree space to move it back to root. Cycles are rejected server-side with a clear error.
- **URL state:** `?note=<id>` tracks the selected note. Refresh the page and the same note is still selected.
- **Save on switch:** typing in one note then clicking another flushes the pending save before the editor swaps.
- **Empty state:** projects with no notes show a "Create your first note" CTA instead of a blank editor.

### Existing notes auto-migrate

If your project already had content in the `projects.notes` column, first boot after upgrade copies it into a root-level note titled "Notes". The migration is idempotent (running twice doesn't duplicate) and leaves the original `projects.notes` column intact for rollback. Projects with empty `notes` get nothing; you create the first note yourself.

### API

Five new endpoints, all accept/return JSON:

```
GET    /api/projects/:id/notes      List tree as a flat array (build the tree from parent_id)
POST   /api/projects/:id/notes      Create a note (body: title?, parent_id?, position?, content?)
GET    /api/notes/:id               One note
PUT    /api/notes/:id                Update any subset of title, content, parent_id, position
DELETE /api/notes/:id                Delete (cascades to children)
POST   /api/notes/:id/move          Reparent + reposition in one call
```

Reparenting validates that the new parent belongs to the same project and that the move wouldn't create a cycle. Position is a float so you can insert between two siblings without renumbering.

### CLI

```
ab notes list <project-slug>              Indented tree
ab notes create <slug|parent-id> "Title"  Create at root (slug) or as a child (numeric parent)
ab notes show <id>                        Print content
ab notes edit <id>                        Open in $EDITOR, save on exit
ab notes rm <id> [--force]                Delete (confirms descendant count unless --force)
ab notes mv <id> --parent <id|root>       Reparent
```

### MCP tools

Five new tools matching the API: `list_project_notes`, `create_note`, `get_note`, `update_note`, `delete_note`. Agents can now build out a project's knowledge tree without touching the UI.

### Itemized changes

- New: `server/db.js`: `project_notes` table with `(project_id, parent_id, title, content, position, created_at, updated_at)` and three indexes; idempotent migration that copies non-empty `projects.notes` into a root note on first boot.
- New: `server/index.js`: five REST routes plus `wouldCreateCycle` defense-in-depth check.
- New: `dashboard/src/components/NoteTree.jsx`: recursive tree with drag-drop, chevrons, hover actions, inline rename, per-node `⋯` menu.
- New: `dashboard/src/components/ProjectNotes.jsx`: tree + editor pair with debounced save, flush-on-switch, URL state via `?note=<id>`, localStorage-backed expand state, mobile slide-over.
- Changed: `dashboard/src/components/ProjectPage.jsx`: Notes tab now renders `ProjectNotes` below the existing description editor; the single-textarea notes save was removed (content lives in the tree now).
- Changed: `dashboard/src/hooks/useApi.js`: six new API helpers for notes.
- Changed: `cli/ab.js`: `ab notes` subcommand family.
- Changed: `mcp-server/index.js`: five new tools.
- Changed: `dashboard/src/styles/index.css`: tree node styles, sidebar layout, mobile sheet transform, empty state.

### Out of scope (deferred)

- Per-note icons (TSK-26)
- @-mentions between notes (TSK-28)
- Block-level comments, inline database embeds, templates
- Virtualized tree (fine at <100 nodes; revisit if anyone breaks that)

## [0.3.0] — 2026-04-24

### Mobile navigation + editable project description

Opening a project on mobile was a trap. The top tabs (Board / My Focus / Agent Queue / Projects) disappeared, leaving only a tiny `← Back` button buried inside a row of badges. Getting back to the main board took two taps at best, and new users never found the back button at all.

Also: once a project was created, there was no way to edit its description from the UI. Only notes were editable.

Fixed both. On phones (≤640px), a persistent bottom nav replaces the top tabs — Board / Focus / Agents / Projects, always visible, always one tap away, even from inside a project. The project detail header splits the title row (Back + name) from the badge row (slug, status, category, priority) so nothing collides on a 375px screen. Description is now an editable textarea on the Notes tab with debounced auto-save, same pattern as notes. Desktop layout unchanged.

- **Bottom nav (mobile only):** 4-button fixed strip with safe-area padding. Top tabs hidden on `≤640px`; shown again on desktop.
- **Cross-context nav:** tapping Board from inside a project clears the project and jumps straight to the main board. No more "back then tab."
- **Header reflow:** project name gets its own row. Badges wrap onto a second row instead of crowding the name.
- **Editable description:** Notes tab now shows Description as a 2-row textarea above the markdown editor. 800ms debounce, saves via the existing `PUT /api/projects/:id`.
- **Saving indicator:** shared between notes and description, rendered next to whichever field you're editing.

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
