// Minimal Server-Sent Events hub.
// One process-wide set of active response streams; broadcast() pushes a
// named event to every connected client. Routes call broadcast() after any
// mutation so dashboards refresh in real time.

const clients = new Set();

export function registerClient(req, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering if any
  res.flushHeaders?.();

  // Initial comment so the client knows the stream is live.
  res.write(': connected\n\n');

  clients.add(res);

  // Heartbeat every 20s keeps intermediaries from closing the stream.
  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      /* will be cleaned up on close */
    }
  }, 20000);

  const cleanup = () => {
    clearInterval(heartbeat);
    clients.delete(res);
    try { res.end(); } catch { /* already closed */ }
  };

  req.on('close', cleanup);
  req.on('aborted', cleanup);
  res.on('error', cleanup);
}

export function broadcast(topic, payload = null) {
  const line = `event: change\ndata: ${JSON.stringify({ topic, payload, ts: Date.now() })}\n\n`;
  for (const res of clients) {
    try {
      res.write(line);
    } catch {
      // Client gone; the close handler will remove it. Best effort here.
    }
  }
}

export function clientCount() {
  return clients.size;
}

// closeAll ends every active SSE stream with a `goodbye` event so connected
// dashboards see a clean disconnect (and their backoff-reconnect logic kicks
// in) instead of ECONNRESET when the server shuts down.
export function closeAll() {
  for (const res of clients) {
    try {
      res.write('event: goodbye\ndata: {"reason":"server shutting down"}\n\n');
      res.end();
    } catch {
      /* already closed; the per-client cleanup handler removes it */
    }
  }
  clients.clear();
}
