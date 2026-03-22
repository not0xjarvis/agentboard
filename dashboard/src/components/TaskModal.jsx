import React, { useState, useEffect } from 'react';
import { api } from '../hooks/useApi.js';

const STATUSES = ['Backlog', 'Todo', 'In Progress', 'In Review', 'Done', 'Cancelled'];
const PRIORITIES = ['Urgent', 'High', 'Medium', 'Low'];
const ASSIGNEES = ['Human', 'Agent', 'Unassigned'];

export default function TaskModal({ task, projects, onClose, onUpdate }) {
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ ...task });

  useEffect(() => {
    api.getComments(task.id).then(setComments);
  }, [task.id]);

  const handleSave = async () => {
    await api.updateTask(task.id, {
      name: form.name,
      status: form.status,
      priority: form.priority,
      assignee: form.assignee,
      project_id: form.project_id || null,
      description: form.description,
      size: form.size,
    });
    setEditing(false);
    onUpdate();
  };

  const handleDelete = async () => {
    await api.deleteTask(task.id);
    onUpdate();
  };

  const handleComment = async (e) => {
    e.preventDefault();
    if (!newComment.trim()) return;
    await api.addComment(task.id, { content: newComment, author: 'Human' });
    setNewComment('');
    const updated = await api.getComments(task.id);
    setComments(updated);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {!editing ? (
          <>
            <div className="task-detail-header">
              <div className="task-detail-title">{task.name}</div>
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="btn btn-sm" onClick={() => setEditing(true)}>Edit</button>
                <button className="btn btn-sm" style={{ color: 'var(--urgent)' }} onClick={handleDelete}>Delete</button>
                <button className="btn btn-sm" onClick={onClose}>x</button>
              </div>
            </div>
            <div className="task-detail-props">
              <span className="prop-label">Status</span><span className={`badge priority-${task.status === 'Done' ? 'low' : 'medium'}`}>{task.status}</span>
              <span className="prop-label">Priority</span><span className={`badge priority-${task.priority.toLowerCase()}`}>{task.priority}</span>
              <span className="prop-label">Assignee</span><span className={`badge assignee-${task.assignee.toLowerCase()}`}>{task.assignee}</span>
              <span className="prop-label">Project</span><span>{task.project_name || '—'}</span>
              <span className="prop-label">Size</span><span>{task.size || '—'}</span>
              <span className="prop-label">ID</span><span style={{ color: 'var(--text-muted)' }}>TSK-{task.id}</span>
            </div>
            {task.description && <p style={{ fontSize: 13, marginBottom: 16, color: 'var(--text-muted)' }}>{task.description}</p>}
          </>
        ) : (
          <>
            <h2>Edit Task</h2>
            <div className="form-group">
              <label>Name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label>Status</label>
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  {STATUSES.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Priority</label>
                <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                  {PRIORITIES.map(p => <option key={p}>{p}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Assignee</label>
                <select value={form.assignee} onChange={(e) => setForm({ ...form, assignee: e.target.value })}>
                  {ASSIGNEES.map(a => <option key={a}>{a}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Project</label>
                <select value={form.project_id || ''} onChange={(e) => setForm({ ...form, project_id: e.target.value ? parseInt(e.target.value) : null })}>
                  <option value="">None</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            </div>
            <div className="form-actions">
              <button className="btn" onClick={() => setEditing(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave}>Save</button>
            </div>
          </>
        )}

        <div className="comments">
          <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>Activity</h3>
          {comments.map((c) => (
            <div key={c.id} className="comment">
              <span className="comment-author">{c.author}</span>
              <span className="comment-time">{new Date(c.created_at).toLocaleString()}</span>
              <div className="comment-text">{c.content}</div>
            </div>
          ))}
          <form className="comment-input" onSubmit={handleComment}>
            <input
              placeholder="Add a comment..."
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
            />
            <button className="btn btn-sm btn-primary" type="submit">Send</button>
          </form>
        </div>
      </div>
    </div>
  );
}
