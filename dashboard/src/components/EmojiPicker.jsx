import React, { useEffect, useRef, useState } from 'react';

// Curated emoji grid: ~60 common picks across work, objects, signals,
// categories, and food. No heavy dependency — one file, one array.
// Picks tuned for scanability in a project/page list (distinct shapes).
const EMOJIS = [
  // Work / thinking
  '💡', '📝', '📊', '📈', '📉', '📌', '📎', '📚',
  // Tech / build
  '🚀', '🧠', '🔥', '⚡', '🛠️', '🏗️', '🧪', '📦',
  // Goals / status
  '🎯', '✅', '❌', '⚠️', '🔒', '🔑', '🎨', '🧩',
  // Time / people
  '📅', '⏰', '👥', '💬', '📣', '💰', '💳', '📮',
  // Devices / web
  '🖥️', '💻', '📱', '🌐', '🖼️', '📷', '🎥', '🎧',
  // Categories / icons
  '📖', '📁', '🗂️', '🗃️', '🔖', '🏷️', '🧾', '📄',
  // Objects / fun
  '🎮', '🕹️', '🎲', '🏆', '⭐', '✨', '🌟', '💎',
  // Food / nature (personal projects)
  '🍵', '🍎', '☕', '🌿',
];

const COLS = 8;

export default function EmojiPicker({ anchorRect, onPick, onClose, currentIcon }) {
  const containerRef = useRef(null);
  const [focusIdx, setFocusIdx] = useState(() => {
    const i = EMOJIS.indexOf(currentIcon);
    return i >= 0 ? i : 0;
  });

  // Position the popover relative to its anchor, clamped to the viewport.
  const [pos, setPos] = useState({ top: 0, left: 0, ready: false });
  useEffect(() => {
    if (!anchorRect || !containerRef.current) return;
    const el = containerRef.current;
    const width = el.offsetWidth || 280;
    const height = el.offsetHeight || 240;
    const margin = 8;
    let top = anchorRect.bottom + 6;
    let left = anchorRect.left;
    if (left + width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - width - margin);
    }
    if (top + height > window.innerHeight - margin) {
      // Flip above the anchor if it doesn't fit below.
      top = Math.max(margin, anchorRect.top - height - 6);
    }
    setPos({ top, left, ready: true });
  }, [anchorRect]);

  // Click outside / Escape to close.
  useEffect(() => {
    const onDocClick = (e) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target)) onClose();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setFocusIdx((i) => Math.min(EMOJIS.length - 1, i + 1));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setFocusIdx((i) => Math.max(0, i - 1));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusIdx((i) => Math.min(EMOJIS.length - 1, i + COLS));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusIdx((i) => Math.max(0, i - COLS));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        onPick(EMOJIS[focusIdx]);
      }
    };
    // Attach on next tick so the click that opened the picker doesn't immediately close it.
    const t = setTimeout(() => document.addEventListener('mousedown', onDocClick), 0);
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose, onPick, focusIdx]);

  // Keep the focused tile visible.
  useEffect(() => {
    const el = containerRef.current?.querySelector(`[data-idx="${focusIdx}"]`);
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [focusIdx]);

  return (
    <div
      ref={containerRef}
      className="emoji-picker"
      role="dialog"
      aria-label="Pick an icon"
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        visibility: pos.ready ? 'visible' : 'hidden',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="emoji-picker-header">
        <span className="emoji-picker-label">Icon</span>
        {currentIcon && (
          <button
            type="button"
            className="emoji-picker-clear"
            onClick={() => onPick(null)}
            title="Remove icon"
          >
            Remove
          </button>
        )}
      </div>
      <div className="emoji-picker-grid">
        {EMOJIS.map((e, i) => (
          <button
            key={e + i}
            type="button"
            data-idx={i}
            className={`emoji-picker-tile${i === focusIdx ? ' is-focused' : ''}${currentIcon === e ? ' is-current' : ''}`}
            onClick={() => onPick(e)}
            onMouseEnter={() => setFocusIdx(i)}
            aria-label={`Pick ${e}`}
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
