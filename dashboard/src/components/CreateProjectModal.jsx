import React, { useState } from 'react';
import { api } from '../hooks/useApi.js';

export default function CreateProjectModal({ onClose, onCreate }) {
  const [form, setForm] = useState({
    name: '', slug: '', description: '', status: 'Active', category: '', priority: 'P2', repo_url: '',
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    await api.createProject(form);
    onCreate();
  };

  const set = (k, v) => setForm({ ...form, [k]: v });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>New Project</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Name</label>
            <input autoFocus value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Project name" />
          </div>
          <div className="form-group">
            <label>Slug <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional — auto from name)</span></label>
            <input value={form.slug} onChange={(e) => set('slug', e.target.value)} placeholder="e.g. agentboard" style={{ fontFamily: 'monospace' }} />
          </div>
          <div className="form-group">
            <label>Description</label>
            <textarea value={form.description} onChange={(e) => set('description', e.target.value)} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label>Status</label>
              <select value={form.status} onChange={(e) => set('status', e.target.value)}>
                {['Active', 'Paused', 'Idea', 'Archived'].map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Priority</label>
              <select value={form.priority} onChange={(e) => set('priority', e.target.value)}>
                {['P0', 'P1', 'P2', 'P3'].map(p => <option key={p}>{p}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Category</label>
              <select value={form.category} onChange={(e) => set('category', e.target.value)}>
                {['', 'AI Agent', 'Product', 'Tool', 'Idea'].map(c => <option key={c} value={c}>{c || '—'}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Repo URL</label>
              <input value={form.repo_url} onChange={(e) => set('repo_url', e.target.value)} placeholder="https://github.com/..." />
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
