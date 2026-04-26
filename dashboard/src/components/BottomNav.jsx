import React from 'react';

const TABS = [
  { id: 'board', label: 'Board' },
  { id: 'focus', label: 'Focus' },
  { id: 'projects', label: 'Projects' },
];

export default function BottomNav({ current, onNav, focusCount = 0 }) {
  return (
    <nav className="bottom-nav" role="tablist" aria-label="Main navigation">
      {TABS.map((t) => {
        const active = current === t.id;
        const showBadge = t.id === 'focus' && focusCount > 0;
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
            {showBadge && <span className="bottom-nav-badge">{focusCount}</span>}
          </button>
        );
      })}
    </nav>
  );
}
