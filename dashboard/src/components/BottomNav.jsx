import React from 'react';

const TABS = [
  { id: 'board', label: 'Board' },
  { id: 'my-focus', label: 'Focus' },
  { id: 'agent-queue', label: 'Agents' },
  { id: 'projects', label: 'Projects' },
];

export default function BottomNav({ current, onNav }) {
  return (
    <nav className="bottom-nav" role="tablist" aria-label="Main navigation">
      {TABS.map((t) => {
        const active = current === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={`bottom-nav-item ${active ? 'active' : ''}`}
            onClick={() => onNav(t.id)}
          >
            {t.label}
          </button>
        );
      })}
    </nav>
  );
}
