import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../hooks/useApi.js';
import NoteTree from './NoteTree.jsx';
import NotesEditor from './NotesEditor.jsx';

const EXPAND_KEY = (projectId) => `ab-notes-expand-${projectId}`;

function readExpanded(projectId) {
  try {
    const raw = localStorage.getItem(EXPAND_KEY(projectId));
    if (!raw) return new Set();
    return new Set(JSON.parse(raw).map(Number));
  } catch {
    return new Set();
  }
}

function writeExpanded(projectId, set) {
  try {
    localStorage.setItem(EXPAND_KEY(projectId), JSON.stringify([...set]));
  } catch { /* ignore */ }
}

function getNoteIdFromUrl() {
  try {
    const p = new URLSearchParams(window.location.search);
    const v = p.get('note');
    return v ? Number(v) : null;
  } catch { return null; }
}

function setNoteIdInUrl(id) {
  try {
    const p = new URLSearchParams(window.location.search);
    if (id == null) p.delete('note'); else p.set('note', String(id));
    const qs = p.toString();
    const url = window.location.pathname + (qs ? `?${qs}` : '');
    window.history.replaceState(null, '', url);
  } catch { /* ignore */ }
}

export default function ProjectNotes({ project, onMentionNavigate, initialNoteId }) {
  const [notes, setNotes] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [expanded, setExpanded] = useState(() => readExpanded(project.id));
  const [editorContent, setEditorContent] = useState('');
  const [editorLoading, setEditorLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mobileTreeOpen, setMobileTreeOpen] = useState(false);

  const saveTimeoutRef = useRef(null);
  const pendingSaveRef = useRef(null); // { id, content } for the note whose content is still buffered
  const currentNoteRef = useRef(null); // the note we're currently editing

  // Initial load + react to project change
  const reload = useCallback(async () => {
    const rows = await api.listNotes(project.id);
    setNotes(rows);
    return rows;
  }, [project.id]);

  // First load: pick the selected note from explicit prop, URL, or the first root note.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rows = await reload();
      if (cancelled) return;
      const fromProp = initialNoteId && rows.some((n) => n.id === initialNoteId) ? initialNoteId : null;
      const urlId = getNoteIdFromUrl();
      const fromUrl = urlId && rows.some((n) => n.id === urlId) ? urlId : null;
      setSelectedId(fromProp ?? fromUrl ?? (rows[0]?.id ?? null));
    })();
    return () => { cancelled = true; };
  }, [project.id, reload, initialNoteId]);

  // Persist expanded state per project.
  useEffect(() => {
    writeExpanded(project.id, expanded);
  }, [project.id, expanded]);

  // Load content for the selected note. Flush any pending save first.
  useEffect(() => {
    let cancelled = false;
    if (selectedId == null) {
      setEditorContent('');
      currentNoteRef.current = null;
      setNoteIdInUrl(null);
      return;
    }

    // Flush any pending save for the note we're switching away from.
    const flush = async () => {
      if (pendingSaveRef.current && saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
        const { id, content } = pendingSaveRef.current;
        pendingSaveRef.current = null;
        try {
          await api.updateNote(id, { content });
        } catch { /* best effort */ }
      }
    };

    setEditorLoading(true);
    (async () => {
      await flush();
      const note = await api.getNote(selectedId).catch(() => null);
      if (cancelled) return;
      if (!note) {
        setSelectedId(null);
        return;
      }
      currentNoteRef.current = note;
      setEditorContent(note.content || '');
      setEditorLoading(false);
      setNoteIdInUrl(note.id);
    })();
    return () => { cancelled = true; };
  }, [selectedId]);

  // Editor change handler: debounced PUT.
  const handleContentChange = (md) => {
    setEditorContent(md);
    const id = currentNoteRef.current?.id;
    if (!id) return;
    pendingSaveRef.current = { id, content: md };
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      saveTimeoutRef.current = null;
      const payload = pendingSaveRef.current;
      pendingSaveRef.current = null;
      if (!payload) return;
      setSaving(true);
      try {
        await api.updateNote(payload.id, { content: payload.content });
      } finally {
        setSaving(false);
      }
    }, 800);
  };

  // Flush on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      if (pendingSaveRef.current) {
        const { id, content } = pendingSaveRef.current;
        api.updateNote(id, { content }).catch(() => {});
      }
    };
  }, []);

  const toggleExpand = (id) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleAddRoot = async () => {
    const title = window.prompt('Note title', 'Untitled');
    if (title == null) return;
    const note = await api.createNote(project.id, { title: title || 'Untitled' });
    await reload();
    setSelectedId(note.id);
  };

  const handleAddChild = async (parentId) => {
    const title = window.prompt('Child note title', 'Untitled');
    if (title == null) return;
    const note = await api.createNote(project.id, { title: title || 'Untitled', parent_id: parentId });
    setExpanded((prev) => new Set(prev).add(parentId));
    await reload();
    setSelectedId(note.id);
  };

  const handleRename = async (id, title) => {
    await api.updateNote(id, { title });
    await reload();
  };

  const handleDelete = async (node) => {
    const descendantCount = countDescendants(notes, node.id);
    const msg = descendantCount
      ? `Delete "${node.title}" and ${descendantCount} nested note${descendantCount === 1 ? '' : 's'}? This cannot be undone.`
      : `Delete "${node.title}"?`;
    if (!window.confirm(msg)) return;
    await api.deleteNote(node.id);
    const rows = await reload();
    if (selectedId === node.id) {
      // Also clear if a descendant was selected.
      setSelectedId(rows[0]?.id ?? null);
    }
  };

  const handleSetIcon = async (id, icon) => {
    // Optimistic: flip the icon in local state so the tree updates immediately.
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, icon } : n)));
    if (currentNoteRef.current && currentNoteRef.current.id === id) {
      currentNoteRef.current = { ...currentNoteRef.current, icon };
    }
    try {
      await api.updateNote(id, { icon });
    } catch {
      // Refetch to reconcile.
      reload();
    }
  };

  const handleMove = async (draggedId, newParentId) => {
    // Don't move onto self.
    if (draggedId === newParentId) return;
    try {
      await api.moveNote(draggedId, { parent_id: newParentId });
      await reload();
    } catch (e) {
      // Server will reject cycles; surface quietly.
      console.warn('Move rejected:', e.message);
    }
  };

  const handleSelect = (id) => {
    setSelectedId(id);
    setMobileTreeOpen(false);
  };

  const selectedNote = currentNoteRef.current && currentNoteRef.current.id === selectedId
    ? currentNoteRef.current
    : notes.find((n) => n.id === selectedId);

  return (
    <div className="project-notes">
      <div className={`project-notes-sidebar${mobileTreeOpen ? ' mobile-open' : ''}`}>
        <div className="project-notes-sidebar-header">
          <span>Pages</span>
          <button
            type="button"
            className="note-tree-mobile-close"
            onClick={() => setMobileTreeOpen(false)}
            aria-label="Close tree"
          >
            ×
          </button>
        </div>
        <NoteTree
          notes={notes}
          selectedId={selectedId}
          expanded={expanded}
          onToggleExpand={toggleExpand}
          onSelect={handleSelect}
          onAddRoot={handleAddRoot}
          onAddChild={handleAddChild}
          onRename={handleRename}
          onDelete={handleDelete}
          onMove={handleMove}
          onSetIcon={handleSetIcon}
        />
      </div>

      <div className="project-notes-main">
        {notes.length === 0 ? (
          <div className="project-notes-empty">
            <div className="project-notes-empty-title">No notes yet</div>
            <div className="project-notes-empty-sub">
              Create nested pages for design docs, specs, decisions — anything you'd put in Notion.
            </div>
            <button type="button" className="btn btn-primary" onClick={handleAddRoot}>
              Create your first note
            </button>
          </div>
        ) : !selectedNote ? (
          <div className="project-notes-empty">
            <div className="project-notes-empty-sub">Select a note from the sidebar.</div>
          </div>
        ) : (
          <>
            <div className="project-notes-header">
              <button
                type="button"
                className="project-notes-mobile-toggle"
                onClick={() => setMobileTreeOpen(true)}
                aria-label="Open tree"
              >
                ☰
              </button>
              {selectedNote.icon && (
                <span className="project-notes-title-icon" aria-hidden title={selectedNote.icon}>
                  {selectedNote.icon}
                </span>
              )}
              <input
                className="project-notes-title"
                value={selectedNote.title}
                onChange={(e) => {
                  // Optimistic rename on the input, debounced save.
                  const val = e.target.value;
                  setNotes((prev) => prev.map((n) => (n.id === selectedNote.id ? { ...n, title: val } : n)));
                  if (saveTimeoutRef.current) { /* editor save handled separately */ }
                }}
                onBlur={async (e) => {
                  const val = e.target.value.trim() || 'Untitled';
                  if (val !== selectedNote.title) {
                    await api.updateNote(selectedNote.id, { title: val });
                    await reload();
                  }
                }}
              />
              {saving && <span className="saving-indicator">Saving...</span>}
            </div>
            {!editorLoading && (
              <NotesEditor
                key={selectedNote.id}
                value={editorContent}
                onChange={handleContentChange}
                onNavigate={onMentionNavigate}
                placeholder="Type here. Slash (/) for block commands."
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function countDescendants(notes, id) {
  let count = 0;
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    for (const n of notes) {
      if (n.parent_id === cur) {
        count += 1;
        stack.push(n.id);
      }
    }
  }
  return count;
}
