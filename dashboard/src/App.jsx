import React, { useState, useEffect, useCallback } from 'react';
import { api } from './hooks/useApi.js';
import Board from './components/Board.jsx';
import TaskModal from './components/TaskModal.jsx';
import CreateTaskModal from './components/CreateTaskModal.jsx';
import CreateProjectModal from './components/CreateProjectModal.jsx';

const COLUMNS = ['Backlog', 'Todo', 'In Progress', 'In Review', 'Done', 'Cancelled'];

export default function App() {
  const [tasks, setTasks] = useState([]);
  const [projects, setProjects] = useState([]);
  const [selectedTask, setSelectedTask] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [filterProject, setFilterProject] = useState('');
  const [filterAssignee, setFilterAssignee] = useState('');
  const [view, setView] = useState('board');

  const load = useCallback(async () => {
    const params = {};
    if (filterProject) params.project_id = filterProject;
    if (filterAssignee) params.assignee = filterAssignee;
    const [t, p] = await Promise.all([api.getTasks(params), api.getProjects()]);
    setTasks(t);
    setProjects(p);
  }, [filterProject, filterAssignee]);

  useEffect(() => { load(); }, [load]);

  // Poll for updates every 5s
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
  for (const t of tasks) {
    if (grouped[t.status]) grouped[t.status].push(t);
  }

  return (
    <div className="app">
      <div className="header">
        <h1>AgentBoard</h1>
        <div className="header-actions">
          <button className="btn btn-sm" onClick={() => setShowCreateProject(true)}>+ Project</button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>+ Task</button>
        </div>
      </div>

      <div className="tabs">
        <button className={`tab ${view === 'board' ? 'active' : ''}`} onClick={() => setView('board')}>Board</button>
        <button className={`tab ${view === 'my-focus' ? 'active' : ''}`} onClick={() => { setView('my-focus'); setFilterAssignee('Human'); }}>My Focus</button>
        <button className={`tab ${view === 'agent-queue' ? 'active' : ''}`} onClick={() => { setView('agent-queue'); setFilterAssignee('Agent'); }}>Agent Queue</button>
        <button className={`tab ${view === 'all' ? 'active' : ''}`} onClick={() => { setView('all'); setFilterAssignee(''); }}>All</button>
      </div>

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

      {selectedTask && (
        <TaskModal task={selectedTask} projects={projects} onClose={() => setSelectedTask(null)} onUpdate={handleTaskUpdated} />
      )}
      {showCreate && (
        <CreateTaskModal projects={projects} onClose={() => setShowCreate(false)} onCreate={handleTaskCreated} />
      )}
      {showCreateProject && (
        <CreateProjectModal onClose={() => setShowCreateProject(false)} onCreate={handleProjectCreated} />
      )}
    </div>
  );
}
