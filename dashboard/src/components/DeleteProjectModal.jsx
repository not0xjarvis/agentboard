import { useEffect, useState } from 'react';

// Two-step confirm so a misclick doesn't take a project out. Type the name to enable Delete.
export default function DeleteProjectModal({ project, taskCount, onCancel, onConfirm, deleting }) {
  const [typed, setTyped] = useState('');

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !deleting) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, deleting]);

  const matches = typed.trim() === project.name;

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target.classList.contains('modal-overlay') && !deleting) onCancel(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="delete-title">
        <h2 id="delete-title">Delete project</h2>
        <p style={{ fontSize: 13, marginBottom: 12, lineHeight: 1.5 }}>
          You're about to delete <strong>{project.icon ? `${project.icon} ` : ''}{project.name}</strong>.
        </p>
        <ul style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, paddingLeft: 20, lineHeight: 1.6 }}>
          <li>All notes for this project will be deleted (cascade).</li>
          <li>{taskCount} task{taskCount === 1 ? '' : 's'} will be unassigned but kept (project_id set to null).</li>
          <li>The project's worktrees on disk are not touched.</li>
          <li>This cannot be undone from the UI.</li>
        </ul>
        <div className="form-group">
          <label htmlFor="delete-confirm-input">Type <code>{project.name}</code> to confirm:</label>
          <input
            id="delete-confirm-input"
            type="text"
            autoFocus
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={project.name}
            disabled={deleting}
          />
        </div>
        <div className="form-actions">
          <button className="btn btn-sm" onClick={onCancel} disabled={deleting}>Cancel</button>
          <button
            className="btn btn-sm btn-danger"
            onClick={onConfirm}
            disabled={!matches || deleting}
          >
            {deleting ? 'Deleting…' : 'Delete project'}
          </button>
        </div>
      </div>
    </div>
  );
}
