// Parse an /ab/... mention URL into a navigation target.
// Returns null for anything else, so the caller can skip unknown shapes.
export function parseMentionUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const m = /^\/ab\/(projects\/([a-z0-9-]+)|notes\/(\d+))\/?$/.exec(url);
  if (!m) return null;
  if (m[2]) return { kind: 'project', slug: m[2] };
  if (m[3]) return { kind: 'note', id: Number(m[3]) };
  return null;
}
