import React, { useState, useEffect, useCallback } from 'react';
import { api } from './hooks/useApi.js';
import Board from './components/Board.jsx';
import TaskModal from './components/TaskModal.jsx';
import CreateTaskModal from './components/CreateTaskModal.jsx';
import CreateProjectModal from './components/CreateProjectModal.jsx';
import ProjectPage from './components/ProjectPage.jsx';
import ThemeToggle from './components/ThemeToggle.jsx';

const COLUMNS = ['Backlog', 'Planning', 'Building', 'Review', 'Done'];
const CANCELLED_COL = 'Cancelled';

export default function App() {
  const [tasks, setTasks] = useState([]);
  const [projects, setProjects] = useState([]);
  const [selectedTask, setSelectedTask] = useState(null);
  const [selectedProject, setSelectedProject] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [filterProject, setFilterProject] = useState('');
  const [filterAssignee, setFilterAssignee] = useState('');
  const [view, setView] = useState('board');
  const [showCancelled, setShowCancelled] = useState(false);

  const load = useCallback(async () => {
    const params = {};
    if (filterProject) params.project_id = filterProject;
    if (filterAssignee) params.assignee = filterAssignee;
    const [t, p] = await Promise.all([api.getTasks(params), api.getProjects()]);
    setTasks(t);
    setProjects(p);
  }, [filterProject, filterAssignee]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [load]);

  const handleStatusChange = async (taskId, newStatus) => {
    await api.updateTask(taskId, { status: newStatus });
    load();
  };

  const handleTaskCreated = () => { setShowCreate(false); load(); };
  const handleProjectCreated = () => { setShowCreateProject(false); load(); };
  const handleTaskUpdated = () => { setSelectedTask(null); load(); };

  const grouped = {};
  for (const col of COLUMNS) grouped[col] = [];
  grouped[CANCELLED_COL] = [];
  for (const t of tasks) {
    if (grouped[t.status]) grouped[t.status].push(t);
  }
  const cancelledTasks = grouped[CANCELLED_COL];

  // Project detail view
  if (selectedProject) {
    return (
      <ProjectPage
        project={selectedProject}
        onBack={() => { setSelectedProject(null); load(); }}
        onTaskClick={setSelectedTask}
      />
    );
  }

  return (
    <div className="app">
      <div className="header">
        <h1>AgentBoard</h1>
        <div className="header-actions">
          <ThemeToggle />
          <button className="btn btn-sm" onClick={() => setShowCreateProject(true)}>+ Project</button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>+ Task</button>
        </div>
      </div>

      <div className="tabs">
        <button className={`tab ${view === 'board' ? 'active' : ''}`} onClick={() => { setView('board'); setFilterAssignee(''); }}>Board</button>
        <button className={`tab ${view === 'my-focus' ? 'active' : ''}`} onClick={() => { setView('my-focus'); setFilterAssignee('Human'); }}>My Focus</button>
        <button className={`tab ${view === 'agent-queue' ? 'active' : ''}`} onClick={() => { setView('agent-queue'); setFilterAssignee('Agent'); }}>Agent Queue</button>
        <button className={`tab ${view === 'projects' ? 'active' : ''}`} onClick={() => { setView('projects'); setFilterAssignee(''); }}>Projects</button>
      </div>

      {view === 'projects' ? (
        <div style={{ padding: 20 }}>
          <div className="projects-grid">
            {projects.map(p => (
              <div key={p.id} className="project-card" onClick={() => setSelectedProject(p)}>
                <div className="project-card-header">
                  <span className="project-card-name">{p.name}</span>
                  <span className={`badge priority-${p.priority === 'P0' ? 'urgent' : p.priority === 'P1' ? 'high' : p.priority === 'P2' ? 'medium' : 'low'}`}>{p.priority}</span>
                </div>
                <div className="project-card-desc">{p.description || 'No description'}</div>
                <div className="card-meta" style={{ marginTop: 8 }}>
                  <span className={`badge ${p.status === 'Active' ? 'priority-medium' : 'priority-low'}`}>{p.status}</span>
                  {p.category && <span className="badge label">{p.category}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="filter-bar">
            <span style={{ color: 'var(--text-muted)' }}>Project:</span>
            <select value={filterProject} onChange={(e) => setFilterProject(e.target.value)}>
              <option value="">All</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {view === 'board' && (
              <>
                <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>Assignee:</span>
                <select value={filterAssignee} onChange={(e) => setFilterAssignee(e.target.value)}>
                  <option value="">All</option>
                  <option value="Human">Human</option>
                  <option value="Agent">Agent</option>
                  <option value="Unassigned">Unassigned</option>
                </select>
              </>
            )}
          </div>
          <Board columns={COLUMNS} grouped={grouped} onCardClick={setSelectedTask} onStatusChange={handleStatusChange} />

          <div className="cancelled-section">
            <button
              className="cancelled-toggle"
              onClick={() => setShowCancelled(v => !v)}
              aria-expanded={showCancelled}
            >
              <span>{showCancelled ? '▾' : '▸'}</span>
              <span>Cancelled</span>
              <span className="column-count">{cancelledTasks.length}</span>
            </button>
            {showCancelled && cancelledTasks.length > 0 && (
              <div className="cancelled-list">
                {cancelledTasks.map(t => (
                  <div key={t.id} className="cancelled-row" onClick={() => setSelectedTask(t)}>
                    <span>TSK-{t.id}</span>
                    <span className="cancelled-row-name">{t.name}</span>
                    {t.project_name && <span className="badge project">{t.project_name}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {selectedTask && (
        <TaskModal task={selectedTask} projects={projects} onClose={() => setSelectedTask(null)} onUpdate={handleTaskUpdated} />
      )}
      {showCreate && (
        <CreateTaskModal projects={projects} onClose={() => setShowCreate(false)} onCreate={handleTaskCreated} defaultProjectId={filterProject} />
      )}
      {showCreateProject && (
        <CreateProjectModal onClose={() => setShowCreateProject(false)} onCreate={handleProjectCreated} />
      )}
    </div>
  );
}
