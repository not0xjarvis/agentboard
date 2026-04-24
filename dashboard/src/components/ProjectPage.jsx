import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../hooks/useApi.js';
import Board from './Board.jsx';
import Card from './Card.jsx';
import TaskModal from './TaskModal.jsx';
import ProjectNotes from './ProjectNotes.jsx';
import BottomNav from './BottomNav.jsx';
import EmojiPicker from './EmojiPicker.jsx';
import { useLiveEvents } from '../hooks/useLiveEvents.js';

const COLUMNS = ['Backlog', 'Planning', 'Building', 'Review', 'Done'];

export default function ProjectPage({ project: initialProject, onBack, onTaskClick, onNavigate, onMentionNavigate, initialNoteId }) {
  const [project, setProject] = useState(initialProject);
  const [tasks, setTasks] = useState([]);
  const [description, setDescription] = useState(initialProject.description || '');
  const [saving, setSaving] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);
  const [showAddTask, setShowAddTask] = useState(false);
  const [newTaskName, setNewTaskName] = useState('');
  const [projects, setProjects] = useState([]);
  // If we landed here from an @-mention pointing at a specific note, open the Notes tab.
  const [tab, setTab] = useState(initialNoteId ? 'notes' : 'tasks');
  const [activity, setActivity] = useState([]);
  const [iconPickerRect, setIconPickerRect] = useState(null);
  const descSaveTimeout = useRef(null);

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

  // Live updates: refresh the project context on any SSE change.
  useLiveEvents((topic) => {
    if (topic === 'tasks' || topic === 'projects' || topic === 'comments' || topic === 'change') load();
  });

  // Auto-save description with debounce
  const handleDescChange = (e) => {
    const val = e.target.value;
    setDescription(val);
    if (descSaveTimeout.current) clearTimeout(descSaveTimeout.current);
    descSaveTimeout.current = setTimeout(async () => {
      setSaving(true);
      await api.updateProject(project.id, { description: val });
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

  const handleIconSlotClick = (e) => {
    e.stopPropagation();
    setIconPickerRect(e.currentTarget.getBoundingClientRect());
  };
  const handleIconPick = async (emoji) => {
    setIconPickerRect(null);
    setProject((p) => ({ ...p, icon: emoji }));
    try {
      await api.updateProject(project.id, { icon: emoji });
    } catch {
      load();
    }
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
      <div className="header project-header">
        <div className="project-header-left">
          <div className="project-header-title-row">
            <button className="btn btn-sm" onClick={onBack}>← Back</button>
            <button
              type="button"
              className={`icon-slot icon-slot--header${project.icon ? ' has-icon' : ''}`}
              onClick={handleIconSlotClick}
              aria-label={project.icon ? `Change icon (currently ${project.icon})` : 'Pick icon'}
              title="Pick icon"
            >
              {project.icon || <span className="icon-slot-placeholder" aria-hidden>▢</span>}
            </button>
            <h1>{project.name}</h1>
          </div>
          <div className="project-header-badge-row">
            {project.slug && <span className="badge label" style={{ fontFamily: 'monospace' }}>{project.slug}</span>}
            <span className={`badge ${project.status === 'Active' ? 'priority-medium' : 'priority-low'}`}>{project.status}</span>
            {project.category && <span className="badge label">{project.category}</span>}
            <span className={`badge priority-${project.priority === 'P0' ? 'urgent' : project.priority === 'P1' ? 'high' : 'medium'}`}>{project.priority}</span>
          </div>
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
        <div className="project-notes-tab">
          <div className="description-field description-field--inline">
            <div className="description-header">
              <label className="description-label" htmlFor="project-description">Description</label>
              {saving && <span className="saving-indicator">Saving...</span>}
            </div>
            <textarea
              id="project-description"
              className="description-editor"
              value={description}
              onChange={handleDescChange}
              placeholder="Short description of this project..."
              rows={2}
            />
          </div>
          <ProjectNotes
            project={project}
            onMentionNavigate={onMentionNavigate}
            initialNoteId={initialNoteId}
          />
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

      {iconPickerRect && (
        <EmojiPicker
          anchorRect={iconPickerRect}
          currentIcon={project.icon || null}
          onClose={() => setIconPickerRect(null)}
          onPick={handleIconPick}
        />
      )}

      {onNavigate && <BottomNav current="projects" onNav={onNavigate} />}
    </div>
  );
}
