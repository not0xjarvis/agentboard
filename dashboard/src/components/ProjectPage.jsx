import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../hooks/useApi.js';
import Card from './Card.jsx';
import TaskModal from './TaskModal.jsx';

export default function ProjectPage({ project: initialProject, onBack, onTaskClick }) {
  const [project, setProject] = useState(initialProject);
  const [tasks, setTasks] = useState([]);
  const [notes, setNotes] = useState(initialProject.notes || '');
  const [saving, setSaving] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);
  const [showAddTask, setShowAddTask] = useState(false);
  const [newTaskName, setNewTaskName] = useState('');
  const [projects, setProjects] = useState([]);
  const saveTimeout = useRef(null);

  const load = useCallback(async () => {
    const [t, p, proj] = await Promise.all([
      api.getTasks({ project_id: project.id }),
      api.getProjects(),
      api.getProject(project.id),
    ]);
    setTasks(t);
    setProjects(p);
    if (proj) setProject(proj);
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

  const statusGroups = {
    active: tasks.filter(t => ['Brainstorming', 'In Progress', 'In Review'].includes(t.status)),
    backlog: tasks.filter(t => t.status === 'Backlog'),
    done: tasks.filter(t => ['Done', 'Cancelled'].includes(t.status)),
  };

  return (
    <div className="app">
      <div className="header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn btn-sm" onClick={onBack}>← Back</button>
          <h1>{project.name}</h1>
          <span className={`badge ${project.status === 'Active' ? 'priority-medium' : 'priority-low'}`}>{project.status}</span>
          {project.category && <span className="badge label">{project.category}</span>}
          <span className={`badge priority-${project.priority === 'P0' ? 'urgent' : project.priority === 'P1' ? 'high' : 'medium'}`}>{project.priority}</span>
        </div>
        <div className="header-actions">
          {project.repo_url && <a href={project.repo_url} target="_blank" rel="noopener" className="btn btn-sm">Repo</a>}
          <button className="btn btn-primary btn-sm" onClick={() => setShowAddTask(true)}>+ Task</button>
        </div>
      </div>

      <div className="project-layout">
        <div className="project-main">
          {/* Notes editor */}
          <div className="notes-section">
            <div className="notes-header">
              <span>Notes</span>
              {saving && <span className="saving-indicator">Saving...</span>}
            </div>
            <textarea
              className="notes-editor"
              value={notes}
              onChange={handleNotesChange}
              placeholder="Project notes, context, decisions, links...&#10;&#10;Write anything here — like a CLAUDE.md for this project.&#10;Agents can read this for context."
            />
          </div>

          {/* Description */}
          {project.description && (
            <div style={{ padding: '0 24px 16px', color: 'var(--text-muted)', fontSize: 13 }}>
              {project.description}
            </div>
          )}
        </div>

        <div className="project-sidebar">
          {/* Quick add */}
          {showAddTask && (
            <form onSubmit={handleAddTask} style={{ marginBottom: 16 }}>
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

          {/* Active tasks */}
          {statusGroups.active.length > 0 && (
            <div className="task-group">
              <div className="task-group-header">Active ({statusGroups.active.length})</div>
              {statusGroups.active.map(t => (
                <Card key={t.id} task={t} onClick={() => setSelectedTask(t)} />
              ))}
            </div>
          )}

          {/* Backlog */}
          {statusGroups.backlog.length > 0 && (
            <div className="task-group">
              <div className="task-group-header">Backlog ({statusGroups.backlog.length})</div>
              {statusGroups.backlog.map(t => (
                <Card key={t.id} task={t} onClick={() => setSelectedTask(t)} />
              ))}
            </div>
          )}

          {/* Done */}
          {statusGroups.done.length > 0 && (
            <div className="task-group">
              <div className="task-group-header">Done ({statusGroups.done.length})</div>
              {statusGroups.done.map(t => (
                <Card key={t.id} task={t} onClick={() => setSelectedTask(t)} />
              ))}
            </div>
          )}

          {tasks.length === 0 && (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: 20 }}>
              No tasks yet. Click "+ Task" to add one.
            </div>
          )}
        </div>
      </div>

      {selectedTask && (
        <TaskModal task={selectedTask} projects={projects} onClose={() => setSelectedTask(null)} onUpdate={handleTaskUpdated} />
      )}
    </div>
  );
}
