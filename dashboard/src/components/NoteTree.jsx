import React, { useState, useRef } from 'react';

// Build a tree from a flat array of notes.
function buildTree(notes) {
  const byId = new Map();
  for (const n of notes) byId.set(n.id, { ...n, children: [] });
  const roots = [];
  for (const n of byId.values()) {
    if (n.parent_id != null && byId.has(n.parent_id)) {
      byId.get(n.parent_id).children.push(n);
    } else {
      roots.push(n);
    }
  }
  const sortRec = (list) => {
    list.sort((a, b) => a.position - b.position || a.id - b.id);
    list.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

// Flatten a subtree id-set for cycle prevention in drag-and-drop.
function collectIds(node, set) {
  set.add(node.id);
  for (const c of node.children) collectIds(c, set);
}

function NoteNode({
  node,
  depth,
  selectedId,
  expanded,
  onToggle,
  onSelect,
  onAddChild,
  onRename,
  onDelete,
  onMove,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(node.title);
  const [dragOver, setDragOver] = useState(false);
  const hasChildren = node.children.length > 0;
  const isExpanded = expanded.has(node.id);
  const isSelected = Number(selectedId) === node.id;

  const closeMenu = () => setMenuOpen(false);

  const submitRename = async () => {
    const val = draft.trim();
    setRenaming(false);
    if (val && val !== node.title) {
      await onRename(node.id, val);
    } else {
      setDraft(node.title);
    }
  };

  return (
    <div className="note-tree-node">
      <div
        className={`note-tree-row${isSelected ? ' selected' : ''}${dragOver ? ' drag-over' : ''}`}
        style={{ paddingLeft: 8 + depth * 16 }}
        draggable={!renaming}
        onDragStart={(e) => {
          e.stopPropagation();
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', String(node.id));
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          if (!dragOver) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragOver(false);
          const draggedId = Number(e.dataTransfer.getData('text/plain'));
          if (!draggedId || draggedId === node.id) return;
          // Cycle guard: dropping onto own descendant is rejected client-side.
          const descendants = new Set();
          collectIds(node, descendants);
          // `node` is the proposed parent. If draggedId is `node` itself or
          // an ancestor of node, the server would reject; we just fire and catch.
          onMove(draggedId, node.id);
        }}
        onClick={(e) => {
          if (e.target.closest('.note-tree-actions')) return;
          onSelect(node.id);
        }}
      >
        <button
          type="button"
          className="note-tree-chevron"
          onClick={(e) => { e.stopPropagation(); onToggle(node.id); }}
          aria-label={isExpanded ? 'Collapse' : 'Expand'}
          style={{ visibility: hasChildren ? 'visible' : 'hidden' }}
        >
          {isExpanded ? '▾' : '▸'}
        </button>
        {renaming ? (
          <input
            autoFocus
            className="note-tree-rename"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={submitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitRename();
              if (e.key === 'Escape') { setRenaming(false); setDraft(node.title); }
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="note-tree-title" title={node.title}>{node.title}</span>
        )}
        <div className="note-tree-actions">
          <button
            type="button"
            className="note-tree-action"
            title="Add child"
            onClick={(e) => { e.stopPropagation(); onAddChild(node.id); }}
          >
            +
          </button>
          <button
            type="button"
            className="note-tree-action"
            title="More"
            onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
          >
            ⋯
          </button>
          {menuOpen && (
            <div className="note-tree-menu" onMouseLeave={closeMenu}>
              <button type="button" onClick={() => { setRenaming(true); closeMenu(); }}>Rename</button>
              <button type="button" onClick={() => { onDelete(node); closeMenu(); }}>Delete</button>
            </div>
          )}
        </div>
      </div>
      {hasChildren && isExpanded && (
        <div className="note-tree-children">
          {node.children.map((c) => (
            <NoteNode
              key={c.id}
              node={c}
              depth={depth + 1}
              selectedId={selectedId}
              expanded={expanded}
              onToggle={onToggle}
              onSelect={onSelect}
              onAddChild={onAddChild}
              onRename={onRename}
              onDelete={onDelete}
              onMove={onMove}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function NoteTree({
  notes,
  selectedId,
  expanded,
  onToggleExpand,
  onSelect,
  onAddRoot,
  onAddChild,
  onRename,
  onDelete,
  onMove,
}) {
  const tree = buildTree(notes);
  const [rootDragOver, setRootDragOver] = useState(false);

  return (
    <div
      className={`note-tree${rootDragOver ? ' drag-over-root' : ''}`}
      onDragOver={(e) => {
        // Allow drop to root only when the drag originated inside the tree
        if (e.dataTransfer.types.includes('text/plain')) {
          e.preventDefault();
          if (!rootDragOver) setRootDragOver(true);
        }
      }}
      onDragLeave={() => setRootDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setRootDragOver(false);
        const draggedId = Number(e.dataTransfer.getData('text/plain'));
        if (!draggedId) return;
        // Drop on empty tree area = move to root
        if (e.target === e.currentTarget) {
          onMove(draggedId, null);
        }
      }}
    >
      {tree.length === 0 ? (
        <div className="note-tree-empty">
          No notes yet.
        </div>
      ) : (
        tree.map((n) => (
          <NoteNode
            key={n.id}
            node={n}
            depth={0}
            selectedId={selectedId}
            expanded={expanded}
            onToggle={onToggleExpand}
            onSelect={onSelect}
            onAddChild={onAddChild}
            onRename={onRename}
            onDelete={onDelete}
            onMove={onMove}
          />
        ))
      )}
      <button type="button" className="note-tree-add-root" onClick={onAddRoot}>
        + Add note
      </button>
    </div>
  );
}
