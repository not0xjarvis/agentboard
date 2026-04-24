import React, { useState } from 'react';
import { api } from '../hooks/useApi.js';

export default function CreateTaskModal({ projects, onClose, onCreate }) {
  const [form, setForm] = useState({
    name: '', description: '', status: 'Backlog', priority: 'Medium',
    assignee: 'Unassigned', project_id: '', size: '', labels: [],
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    await api.createTask({
      ...form,
      project_id: form.project_id ? parseInt(form.project_id) : null,
    });
    onCreate();
  };

  const set = (k, v) => setForm({ ...form, [k]: v });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>New Task</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Name</label>
            <input autoFocus value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="What needs to be done?" />
          </div>
          <div className="form-group">
            <label>Description</label>
            <textarea value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Details..." />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label>Status</label>
              <select value={form.status} onChange={(e) => set('status', e.target.value)}>
                {['Backlog', 'Planning', 'Building', 'Review', 'Done'].map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Priority</label>
              <select value={form.priority} onChange={(e) => set('priority', e.target.value)}>
                {['Urgent', 'High', 'Medium', 'Low'].map(p => <option key={p}>{p}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Assignee</label>
              <select value={form.assignee} onChange={(e) => set('assignee', e.target.value)}>
                {['Unassigned', 'Human', 'Agent'].map(a => <option key={a}>{a}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Project</label>
              <select value={form.project_id} onChange={(e) => set('project_id', e.target.value)}>
                <option value="">None</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Size</label>
              <select value={form.size} onChange={(e) => set('size', e.target.value)}>
                {['', 'XS', 'S', 'M', 'L', 'XL'].map(s => <option key={s} value={s}>{s || '—'}</option>)}
              </select>
            </div>
          </div>
          <div className="form-actions">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">Create</button>
          </div>
        </form>
      </div>
    </div>
  );
}
