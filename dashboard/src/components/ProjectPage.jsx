import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../hooks/useApi.js';
import Board from './Board.jsx';
import Card from './Card.jsx';
import TaskModal from './TaskModal.jsx';
import NotesEditor from './NotesEditor.jsx';

const COLUMNS = ['Backlog', 'Planning', 'Building', 'Review', 'Done'];

export default function ProjectPage({ project: initialProject, onBack, onTaskClick }) {
  const [project, setProject] = useState(initialProject);
  const [tasks, setTasks] = useState([]);
  const [notes, setNotes] = useState(initialProject.notes || '');
  const [saving, setSaving] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);
  const [showAddTask, setShowAddTask] = useState(false);
  const [newTaskName, setNewTaskName] = useState('');
  const [projects, setProjects] = useState([]);
  const [tab, setTab] = useState('tasks');
  const [activity, setActivity] = useState([]);
  const saveTimeout = useRef(null);

  const load = useCallback(async () => {
    const [t, p, proj, act] = await Promise.all([
      api.getTasks({ project_id: project.id }),
      api.getProjects(),
      api.getProject(project.id),
      api.getActivity(project.id).catch(() => []),
    ]);
    setTasks(t);
    setProjects(p);
    if (proj) setProject(proj);
    setActivity(act || []);
  }, [project.id]);

  useEffect(() => { load(); }, [load]);

  // Auto-save notes with debounce
  const handleNotesChange = (e) => {
    const val = e.target.value;
    setNotes(val);
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(async () => {
      setSaving(true);
      await api.updateProject(project.id, { notes: val });
      setSaving(false);
    }, 800);
  };

  const handleAddTask = async (e) => {
    e.preventDefault();
    if (!newTaskName.trim()) return;
    await api.createTask({ name: newTaskName, project_id: project.id, status: 'Backlog' });
    setNewTaskName('');
    setShowAddTask(false);
    load();
  };

  const handleTaskUpdated = () => {
    setSelectedTask(null);
    load();
  };

  const handleStatusChange = async (taskId, newStatus) => {
    await api.updateTask(taskId, { status: newStatus });
    load();
  };

  // Kanban grouped by column for the Tasks tab
  const grouped = {};
  for (const col of COLUMNS) grouped[col] = [];
  for (const t of tasks) {
    if (grouped[t.status]) grouped[t.status].push(t);
  }
  const cancelledTasks = tasks.filter(t => t.status === 'Cancelled');

  return (
    <div className="app">
      <div className="header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn btn-sm" onClick={onBack}>← Back</button>
          <h1>{project.name}</h1>
          {project.slug && <span className="badge label" style={{ fontFamily: 'monospace' }}>{project.slug}</span>}
          <span className={`badge ${project.status === 'Active' ? 'priority-medium' : 'priority-low'}`}>{project.status}</span>
          {project.category && <span className="badge label">{project.category}</span>}
          <span className={`badge priority-${project.priority === 'P0' ? 'urgent' : project.priority === 'P1' ? 'high' : 'medium'}`}>{project.priority}</span>
        </div>
        <div className="header-actions">
          {project.repo_url && <a href={project.repo_url} target="_blank" rel="noopener" className="btn btn-sm">Repo</a>}
          <button className="btn btn-primary btn-sm" onClick={() => setShowAddTask(true)}>+ Task</button>
        </div>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'tasks' ? 'active' : ''}`} onClick={() => setTab('tasks')}>Tasks</button>
        <button className={`tab ${tab === 'notes' ? 'active' : ''}`} onClick={() => setTab('notes')}>Notes</button>
        <button className={`tab ${tab === 'activity' ? 'active' : ''}`} onClick={() => setTab('activity')}>Activity</button>
      </div>

      {showAddTask && (
        <form onSubmit={handleAddTask} style={{ padding: '8px 20px', borderBottom: '1px solid var(--border)' }}>
          <input
            autoFocus
            className="quick-add-input"
            value={newTaskName}
            onChange={(e) => setNewTaskName(e.target.value)}
            placeholder="New task name → Backlog"
            onKeyDown={(e) => e.key === 'Escape' && setShowAddTask(false)}
          />
        </form>
      )}

      {tab === 'tasks' && (
        <>
          <Board columns={COLUMNS} grouped={grouped} onCardClick={setSelectedTask} onStatusChange={handleStatusChange} />
          {cancelledTasks.length > 0 && (
            <div className="cancelled-section">
              <div className="cancelled-toggle" style={{ cursor: 'default' }}>
                <span>Cancelled</span>
                <span className="column-count">{cancelledTasks.length}</span>
              </div>
              <div className="cancelled-list">
                {cancelledTasks.map(t => (
                  <div key={t.id} className="cancelled-row" onClick={() => setSelectedTask(t)}>
                    <span>TSK-{t.id}</span>
                    <span className="cancelled-row-name">{t.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {tasks.length === 0 && (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: 40 }}>
              No tasks yet. Click "+ Task" to add one.
            </div>
          )}
        </>
      )}

      {tab === 'notes' && (
        <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>
          {project.description && (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 12 }}>
              {project.description}
            </div>
          )}
          <div className="notes-section" style={{ padding: 0 }}>
            <div className="notes-header">
              <span>Notes</span>
              {saving && <span className="saving-indicator">Saving...</span>}
            </div>
            <NotesEditor
              key={project.id}
              value={notes}
              onChange={(md) => handleNotesChange({ target: { value: md } })}
              placeholder="Project notes, context, decisions, links… type / for commands"
            />
          </div>
        </div>
      )}

      {tab === 'activity' && (
        <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>
          {activity.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No activity yet.</div>
          ) : (
            activity.map((c) => (
              <div key={c.id} className="comment">
                <div>
                  <span className="comment-author">{c.author}</span>
                  <span className="comment-time">{new Date(c.created_at).toLocaleString()}</span>
                  <span className="comment-time" style={{ marginLeft: 8 }}>
                    TSK-{c.task_id} · {c.task_name} · {c.task_status}
                  </span>
                </div>
                <div className="comment-text">{c.content}</div>
              </div>
            ))
          )}
        </div>
      )}

      {selectedTask && (
        <TaskModal task={selectedTask} projects={projects} onClose={() => setSelectedTask(null)} onUpdate={handleTaskUpdated} />
      )}
    </div>
  );
}
