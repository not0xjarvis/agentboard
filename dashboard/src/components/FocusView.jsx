import React, { useState } from 'react';
import { api } from '../hooks/useApi.js';

/**
 * Focus tab: everything currently waiting on the human.
 * Two shapes:
 *   - Decisions: agent paused with a question (needs_decision=1). Answer + clear flag.
 *   - To-dos: tasks assigned to Human and not Done/Cancelled. Do + mark Done.
 */
export default function FocusView({ tasks, onTaskClick, onChange }) {
  const decisions = tasks.filter((t) => t.needs_decision);
  const todos = tasks.filter((t) => !t.needs_decision);

  if (tasks.length === 0) {
    return (
      <div className="focus-view">
        <div className="focus-empty">
          <div className="focus-empty-title">Nothing needs you right now</div>
          <div className="focus-empty-sub">
            When an agent hits a decision or a task is assigned to you, it lands here.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="focus-view">
      {decisions.length > 0 && (
        <section className="focus-section">
          <h2 className="focus-section-title">
            <span className="focus-section-icon" aria-hidden>🛑</span>
            Decisions
            <span className="focus-section-count">{decisions.length}</span>
          </h2>
          <div className="focus-list">
            {decisions.map((t) => (
              <DecisionCard key={t.id} task={t} onTaskClick={onTaskClick} onChange={onChange} />
            ))}
          </div>
        </section>
      )}

      {todos.length > 0 && (
        <section className="focus-section">
          <h2 className="focus-section-title">
            <span className="focus-section-icon" aria-hidden>✋</span>
            To-do
            <span className="focus-section-count">{todos.length}</span>
          </h2>
          <div className="focus-list">
            {todos.map((t) => (
              <TodoCard key={t.id} task={t} onTaskClick={onTaskClick} onChange={onChange} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function DecisionCard({ task, onTaskClick, onChange }) {
  const [answer, setAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!answer.trim()) return;
    setSubmitting(true);
    try {
      await api.addComment(task.id, { author: 'Human', content: answer.trim() });
      await api.updateTask(task.id, { needs_decision: 0, decision_question: null });
      setAnswer('');
      onChange && onChange();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="focus-card decision-card">
      <div className="focus-card-header">
        <button
          type="button"
          className="focus-card-title-btn"
          onClick={() => onTaskClick(task)}
        >
          <span className="focus-card-tsk">TSK-{task.id}</span>
          <span className="focus-card-title">{task.name}</span>
        </button>
        <TaskMetaBadges task={task} />
      </div>
      {task.decision_question && (
        <div className="focus-card-question">{task.decision_question}</div>
      )}
      <form className="focus-card-answer" onSubmit={submit}>
        <textarea
          className="focus-answer-input"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="Your answer…"
          rows={2}
          disabled={submitting}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e);
          }}
        />
        <div className="focus-answer-actions">
          <span className="focus-answer-hint">⌘↵ to send</span>
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={!answer.trim() || submitting}
          >
            {submitting ? 'Sending…' : 'Answer & unblock'}
          </button>
        </div>
      </form>
    </div>
  );
}

function TodoCard({ task, onTaskClick, onChange }) {
  const [busy, setBusy] = useState(false);
  const markDone = async () => {
    setBusy(true);
    try {
      await api.updateTask(task.id, { status: 'Done' });
      onChange && onChange();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="focus-card todo-card">
      <div className="focus-card-header">
        <button
          type="button"
          className="focus-card-title-btn"
          onClick={() => onTaskClick(task)}
        >
          <span className="focus-card-tsk">TSK-{task.id}</span>
          <span className="focus-card-title">{task.name}</span>
        </button>
        <TaskMetaBadges task={task} />
      </div>
      {task.description && (
        <div className="focus-card-desc">{task.description}</div>
      )}
      <div className="focus-card-actions">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={markDone}
          disabled={busy}
        >
          {busy ? 'Saving…' : '✓ Mark done'}
        </button>
      </div>
    </div>
  );
}

function TaskMetaBadges({ task }) {
  const priorityClass =
    task.priority === 'Urgent'
      ? 'priority-urgent'
      : task.priority === 'High'
        ? 'priority-high'
        : task.priority === 'Low'
          ? 'priority-low'
          : 'priority-medium';
  return (
    <div className="focus-card-meta">
      <span className={`badge ${priorityClass}`}>{task.priority}</span>
      <span className="badge label">{task.status}</span>
      {task.project_name && <span className="badge project">{task.project_name}</span>}
    </div>
  );
}
