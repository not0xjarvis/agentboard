# Agent → Focus Queue Protocol

How AI agents (gstack, OpenClaw, Claude Code, Cursor, Codex, etc.) should route
human-blocking questions into the AgentBoard Focus tab instead of stalling a
terminal prompt no human is watching.

## The problem

Agents running unattended hit gates that need a human decision:

- Product calls: "Should this feature do X or Y?"
- Schema calls: "Nested routes or flat with breadcrumbs?"
- Taste: "Which of these three designs ships?"
- Secrets: "I can't write this env var — you need to SSH in and do it."

The wrong behavior is to call `AskUserQuestion` into thin air and wait. The
human isn't at the terminal. The agent silently burns context until timeout
or the next handoff, and the human never knew they were needed.

The right behavior is to write the question to AgentBoard, mark the task
blocked, and exit. The human sees it in the Focus tab the next time they
glance at their phone.

## The contract

Every AB task has two decision-queue fields:

- `needs_decision` (integer, 0/1) — is this task blocking on a human?
- `decision_question` (text) — what is the agent asking?

The Focus tab surfaces any task with `needs_decision=1`. The human answers
in the UI (which clears the flag and adds a comment), or calls
`ab unblock <id> --answer "..."`.

## Mechanics

Three equivalent ways for an agent to flip the flag. Pick whichever fits the
agent's environment.

### 1. CLI

```bash
ab block <task_id> "Should we use SQLite or Postgres for the queue? I can go
either way but need your call before I commit the schema."
```

That's it. The CLI:
- Sets `needs_decision=1` and `decision_question` on the task.
- Adds a comment from `Agent`: `[Decision requested] <the question>`.

To resume later, the human (or an orchestrator) runs:

```bash
ab unblock <task_id> --answer "SQLite — queue is tiny, port later if needed."
```

That clears the flag and logs the answer as a `Human` comment.

### 2. MCP tool

For agents connected to AB's MCP server:

```
block_task { id: 20, question: "Should we use SQLite or Postgres…" }
unblock_task { id: 20, answer: "SQLite — queue is tiny…" }
list_focus {}
```

Same semantics as the CLI. `list_focus` is useful for an agent polling to see
if the human has unblocked yet.

### 3. Direct HTTP

```
PUT /api/tasks/:id
  { "needs_decision": 1, "decision_question": "…" }

POST /api/tasks/:id/comments
  { "author": "Agent", "content": "[Decision requested] …" }
```

## When a skill should use this instead of AskUserQuestion

Use the Focus queue when all of these are true:

1. **There's an AB task context.** The agent knows which task it's working on
   (e.g., `AB_TASK_ID` env var, or it was spawned from a specific task via
   `ab claim`).
2. **The run is unattended.** No human is watching the terminal. Signals:
   `OPENCLAW_SESSION` env var is set, the agent was launched via cron or a
   scheduled job, or the `--unattended` flag was passed.
3. **The question genuinely can't be inferred.** You have two plausible
   options and no signal to pick between them. If you can make a reasonable
   call and flag it as a decision the human might want to revisit later,
   do that instead.

Fall back to `AskUserQuestion` (the normal interactive prompt) when a human
is clearly at the terminal and expecting to answer.

## When the agent should NOT block

Don't block on:

- **Trivial choices.** Pick one and move on. Describe the choice in a
  comment on the task. The human can revert later if they disagree.
- **Questions with clear answers.** If the codebase conventions answer the
  question, follow them. Don't ask the human to re-litigate established
  patterns.
- **Repeated questions.** If the human already answered a similar question
  on another task, apply the same answer here and note it in a comment.

The Focus tab only works if it stays small. Every spurious `ab block` call
reduces its signal-to-noise ratio. Treat blocking as expensive.

## Crafting the question

Good decision questions are:

- **Specific.** Not "how should I do this?" but "Should the cache TTL be
  60s or 300s? 60s stays fresh but 5x the origin traffic."
- **Scoped.** One question per block. If you need two answers, block once,
  get one answer, then block again for the second.
- **Self-contained.** The human shouldn't have to re-read the task
  description. Restate enough context in the question that it stands alone.
- **Has options when possible.** "A) SQLite  B) Postgres" is easier to
  answer than "What database should I use?"

Bad:
> Should we add caching?

Good:
> Caching layer for the feed endpoint. Current request is ~400ms dominated
> by the DB. Two options: (A) Redis cache with 60s TTL — +1 dependency,
> instant reads, 2min freshness lag. (B) SQLite WAL + in-process cache — no
> new dependency, reads stay ~40ms after warmup, stale-on-write risk if we
> scale to >1 replica. Pick one.

## Flow summary

```
  agent running unattended on task N
              │
              ▼
      hits a gate requiring
         human judgment
              │
              ▼
  ab block N "good question"
              │
              ▼
   task shows in Focus tab
              │
              ▼
     human opens Focus
              │
              ▼
       human answers
       (UI or CLI)
              │
              ▼
  flag clears, Human comment
         added to task
              │
              ▼
   agent resumes, reads the
   comment, continues work
```
