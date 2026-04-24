import { useEffect, useRef } from 'react';

// Subscribes to /api/events (SSE) and fires `onChange(topic)` on every
// broadcast from the server. Auto-reconnects on drop with exponential
// backoff capped at 10s. Use alongside a slower fallback poll so the UI
// still catches up if SSE is blocked by a proxy.
export function useLiveEvents(onChange) {
  const cbRef = useRef(onChange);
  useEffect(() => { cbRef.current = onChange; }, [onChange]);

  useEffect(() => {
    let es = null;
    let cancelled = false;
    let backoff = 500;

    const connect = () => {
      if (cancelled) return;
      try { es?.close(); } catch { /* noop */ }
      es = new EventSource('/api/events');

      es.addEventListener('open', () => {
        backoff = 500;
      });

      es.addEventListener('change', (ev) => {
        try {
          const data = JSON.parse(ev.data || '{}');
          cbRef.current?.(data.topic || 'change', data);
        } catch {
          cbRef.current?.('change');
        }
      });

      es.addEventListener('error', () => {
        try { es.close(); } catch { /* noop */ }
        if (cancelled) return;
        const delay = Math.min(backoff, 10000);
        backoff = Math.min(backoff * 2, 10000);
        setTimeout(connect, delay);
      });
    };

    connect();

    return () => {
      cancelled = true;
      try { es?.close(); } catch { /* noop */ }
    };
  }, []);
}
