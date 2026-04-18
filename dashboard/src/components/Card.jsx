import React from 'react';

const STAGE_ICON = {
  design: '☯',
  plan:   '✎',
  impl:   '◉',
  review: '⌕',
  ship:   '⇧',
  qa:     '✓',
};

export default function Card({ task, onClick }) {
  const handleDragStart = (e) => {
    e.dataTransfer.setData('taskId', task.id.toString());
    e.currentTarget.style.opacity = '0.5';
  };

  const handleDragEnd = (e) => {
    e.currentTarget.style.opacity = '1';
  };

  const labels = (() => {
    try { return JSON.parse(task.labels || '[]'); } catch { return []; }
  })();

  return (
    <div
      className="card"
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={onClick}
    >
      <div className="card-title">{task.name}</div>
      <div className="card-meta">
        <span className={`badge priority-${task.priority.toLowerCase()}`}>{task.priority}</span>
        {task.assignee !== 'Unassigned' && (
          <span className={`badge assignee-${task.assignee.toLowerCase()}`}>{task.assignee}</span>
        )}
        {task.project_name && <span className="badge project">{task.project_name}</span>}
        {task.size && <span className="badge size">{task.size}</span>}
        {task.rounds > 0 && <span className="badge rounds" title={`${task.rounds} round(s) of iteration`}>R{task.rounds}</span>}
        {task.pipeline_stage && (
          <span className="badge stage" title={`pipeline_stage: ${task.pipeline_stage}`}>
            {STAGE_ICON[task.pipeline_stage] || ''} {task.pipeline_stage}
          </span>
        )}
        {task.pr_url && (
          <a
            href={task.pr_url}
            target="_blank"
            rel="noopener noreferrer"
            className="badge pr"
            title={task.pr_url}
            onClick={(e) => e.stopPropagation()}
          >PR</a>
        )}
        {labels.map((l) => <span key={l} className="badge label">{l}</span>)}
      </div>
    </div>
  );
}
