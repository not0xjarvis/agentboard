// Background worker: polls `gh pr list` every 30s for tracked branches that
// don't yet have a pr_url recorded. Populates tasks.pr_url when a PR exists.
//
// Safety:
//   - Never throws out of the loop (unhandled errors inside a task are logged).
//   - If `gh` CLI is not available at startup, logs once and becomes a no-op.
//   - Caps polls per cycle at POLL_BATCH_SIZE.

import { spawn, spawnSync } from 'child_process';

const POLL_INTERVAL_MS = 30_000;
const POLL_BATCH_SIZE = 20;

function isGhAvailable() {
  try {
    const r = spawnSync('gh', ['--version'], { stdio: 'ignore' });
    return r.status === 0;
  } catch {
    return false;
  }
}

function ghPrForBranch(branch) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const p = spawn('gh', ['pr', 'list', '--head', branch, '--json', 'url,state', '--limit', '1']);
    p.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    p.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    p.on('error', () => resolve({ ok: false, error: 'spawn failed' }));
    p.on('close', (code) => {
      if (code !== 0) {
        return resolve({ ok: false, error: stderr.trim() || `exit ${code}` });
      }
      try {
        const parsed = JSON.parse(stdout || '[]');
        const first = Array.isArray(parsed) && parsed.length ? parsed[0] : null;
        resolve({ ok: true, pr: first });
      } catch (e) {
        resolve({ ok: false, error: `parse: ${e.message}` });
      }
    });
  });
}

export function startPrPoller(db) {
  if (!isGhAvailable()) {
    console.warn('[pr-poller] gh CLI not available; PR URL auto-capture disabled');
    return { stop: () => {} };
  }
  console.log('[pr-poller] active, polling every 30s');

  let timer = null;
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const rows = db.prepare(
        `SELECT id, branch_name FROM tasks
          WHERE status IN ('Review','Done')
            AND pr_url IS NULL
            AND branch_name IS NOT NULL
            AND branch_name != ''
          LIMIT ?`
      ).all(POLL_BATCH_SIZE);

      for (const row of rows) {
        const result = await ghPrForBranch(row.branch_name);
        if (!result.ok) {
          console.warn(`[pr-poller] branch=${row.branch_name}: ${result.error}`);
          continue;
        }
        if (result.pr && result.pr.url) {
          try {
            db.prepare(
              "UPDATE tasks SET pr_url = ?, updated_at = datetime('now') WHERE id = ? AND pr_url IS NULL"
            ).run(result.pr.url, row.id);
            console.log(`[pr-poller] TSK-${row.id} ← ${result.pr.url}`);
          } catch (e) {
            console.warn(`[pr-poller] db update failed for TSK-${row.id}: ${e.message}`);
          }
        }
      }
    } catch (e) {
      console.warn(`[pr-poller] cycle error: ${e.message}`);
    } finally {
      running = false;
    }
  };

  // Schedule. Kick off an initial tick after a short delay to let the server settle.
  timer = setInterval(tick, POLL_INTERVAL_MS);
  setTimeout(tick, 3000);

  return {
    stop: () => {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
