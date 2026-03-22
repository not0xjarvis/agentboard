import React from 'react';
import Card from './Card.jsx';

const STATUS_COLORS = {
  'Backlog': 'var(--text-muted)',
  'Todo': 'var(--medium)',
  'In Progress': 'var(--high)',
  'In Review': '#a371f7',
  'Done': 'var(--done)',
  'Cancelled': 'var(--cancelled)',
};

export default function Board({ columns, grouped, onCardClick, onStatusChange }) {
  const handleDragOver = (e) => {
    e.preventDefault();
    e.currentTarget.style.background = 'rgba(88,166,255,0.05)';
  };

  const handleDragLeave = (e) => {
    e.currentTarget.style.background = '';
  };

  const handleDrop = (e, status) => {
    e.currentTarget.style.background = '';
    const taskId = e.dataTransfer.getData('taskId');
    if (taskId) onStatusChange(parseInt(taskId), status);
  };

  return (
    <div className="board">
      {columns.map((col) => (
        <div className="column" key={col}>
          <div className="column-header">
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLORS[col] }} />
              {col}
            </span>
            <span className="column-count">{grouped[col]?.length || 0}</span>
          </div>
          <div
            className="column-cards"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, col)}
          >
            {(grouped[col] || []).map((task) => (
              <Card key={task.id} task={task} onClick={() => onCardClick(task)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
