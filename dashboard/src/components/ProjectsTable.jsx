import React, { useMemo, useState, useEffect } from 'react';

const SORT_KEY = 'ab-projects-sort';

// Priority order for sorting — P0 (Urgent) first, P3 (Low) last.
const PRIORITY_ORDER = { P0: 0, P1: 1, P2: 2, P3: 3 };

const PRIORITY_CLASS = {
  P0: 'priority-urgent',
  P1: 'priority-high',
  P2: 'priority-medium',
  P3: 'priority-low',
};

function loadSort() {
  try {
    const raw = localStorage.getItem(SORT_KEY);
    if (!raw) return { column: 'updated_at', dir: 'desc' };
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.column === 'string' && (parsed.dir === 'asc' || parsed.dir === 'desc')) {
      return parsed;
    }
  } catch {
    // localStorage unavailable or corrupt — fall back to default
  }
  return { column: 'updated_at', dir: 'desc' };
}

function saveSort(sort) {
  try {
    localStorage.setItem(SORT_KEY, JSON.stringify(sort));
  } catch {
    // ignore — localStorage may be unavailable (private mode, quota)
  }
}

function relativeTime(iso) {
  if (!iso) return '—';
  const then = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z').getTime();
  if (Number.isNaN(then)) return '—';
  const diff = Date.now() - then;
  if (diff < 0) return 'just now';
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

function repoLabel(url) {
  if (!url) return '';
  // Trim trailing slash, drop protocol and host, keep owner/repo if GitHub-style
  const trimmed = url.replace(/\/$/, '');
  const m = trimmed.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/);
  if (m) return m[1];
  try {
    const u = new URL(trimmed);
    return u.host + u.pathname;
  } catch {
    return trimmed;
  }
}

const COLUMNS = [
  { key: 'name',       label: 'Name' },
  { key: 'priority',   label: 'Priority' },
  { key: 'status',     label: 'Status' },
  { key: 'category',   label: 'Category' },
  { key: 'lead',       label: 'Lead' },
  { key: 'repo_url',   label: 'Repo' },
  { key: 'updated_at', label: 'Last Activity' },
];

function compare(a, b, column) {
  if (column === 'priority') {
    const ao = PRIORITY_ORDER[a.priority] ?? 99;
    const bo = PRIORITY_ORDER[b.priority] ?? 99;
    return ao - bo;
  }
  if (column === 'updated_at') {
    const at = a.updated_at ? new Date(a.updated_at.replace(' ', 'T') + 'Z').getTime() : 0;
    const bt = b.updated_at ? new Date(b.updated_at.replace(' ', 'T') + 'Z').getTime() : 0;
    return at - bt;
  }
  const av = (a[column] ?? '').toString().toLowerCase();
  const bv = (b[column] ?? '').toString().toLowerCase();
  // Empty values sort last regardless of direction
  if (av === '' && bv !== '') return 1;
  if (bv === '' && av !== '') return -1;
  return av.localeCompare(bv);
}

export default function ProjectsTable({ projects, onProjectClick }) {
  const [sort, setSort] = useState(loadSort);

  useEffect(() => { saveSort(sort); }, [sort]);

  const sorted = useMemo(() => {
    const out = [...projects];
    out.sort((a, b) => {
      const base = compare(a, b, sort.column);
      return sort.dir === 'asc' ? base : -base;
    });
    return out;
  }, [projects, sort]);

  function handleHeaderClick(key) {
    setSort(prev => {
      if (prev.column === key) {
        return { column: key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
      }
      // New column: default ascending, except updated_at which is most useful descending
      return { column: key, dir: key === 'updated_at' ? 'desc' : 'asc' };
    });
  }

  function indicator(key) {
    if (sort.column !== key) return null;
    return <span className="projects-table-sort">{sort.dir === 'asc' ? '▲' : '▼'}</span>;
  }

  if (projects.length === 0) {
    return <div className="projects-empty">No projects yet</div>;
  }

  return (
    <div className="projects-table-wrap">
      <table className="projects-table">
        <thead>
          <tr>
            {COLUMNS.map(c => (
              <th
                key={c.key}
                className={sort.column === c.key ? 'is-sorted' : ''}
                onClick={() => handleHeaderClick(c.key)}
                scope="col"
              >
                <span className="projects-table-head">
                  {c.label}
                  {indicator(c.key)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map(p => (
            <tr key={p.id} onClick={() => onProjectClick(p)}>
              <td className="col-name">
                {p.icon && <span className="projects-table-icon" aria-hidden>{p.icon}</span>}
                <span className="projects-table-name" title={p.name}>{p.name}</span>
              </td>
              <td>
                <span className={`badge ${PRIORITY_CLASS[p.priority] || 'priority-low'}`}>{p.priority}</span>
              </td>
              <td>
                <span className={`badge ${p.status === 'Active' ? 'priority-medium' : 'priority-low'}`}>
                  {p.status}
                </span>
              </td>
              <td className="col-muted">{p.category || '—'}</td>
              <td className="col-muted">—</td>
              <td className="col-muted col-repo">
                {p.repo_url ? (
                  <a
                    href={p.repo_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    title={p.repo_url}
                  >
                    {repoLabel(p.repo_url)}
                  </a>
                ) : '—'}
              </td>
              <td className="col-muted">{relativeTime(p.updated_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
