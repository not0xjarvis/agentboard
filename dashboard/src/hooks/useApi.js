const BASE = '/api';

async function request(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export const api = {
  // Projects
  getProjects: () => request('/projects'),
  getProject: (id) => request(`/projects/${id}`),
  createProject: (body) => request('/projects', { method: 'POST', body }),
  updateProject: (id, body) => request(`/projects/${id}`, { method: 'PUT', body }),
  deleteProject: (id) => request(`/projects/${id}`, { method: 'DELETE' }),

  // Tasks
  getTasks: (params) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/tasks${qs ? '?' + qs : ''}`);
  },
  getTask: (id) => request(`/tasks/${id}`),
  createTask: (body) => request('/tasks', { method: 'POST', body }),
  updateTask: (id, body) => request(`/tasks/${id}`, { method: 'PUT', body }),
  deleteTask: (id) => request(`/tasks/${id}`, { method: 'DELETE' }),
  claimTask: (id, assignee) => request(`/tasks/${id}/claim`, { method: 'POST', body: { assignee } }),

  // Comments
  getComments: (taskId) => request(`/tasks/${taskId}/comments`),
  addComment: (taskId, body) => request(`/tasks/${taskId}/comments`, { method: 'POST', body }),

  // Agent
  getBacklog: () => request('/backlog'),

  // Phase 1: activity + worktrees
  getActivity: (projectId) => request(`/projects/${projectId}/activity`),
  getWorktrees: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/worktrees${qs ? '?' + qs : ''}`);
  },

  // v0.4.0: nested project notes (TSK-25)
  listNotes: (projectId) => request(`/projects/${projectId}/notes`),
  getNote: (id) => request(`/notes/${id}`),
  createNote: (projectId, body) => request(`/projects/${projectId}/notes`, { method: 'POST', body }),
  updateNote: (id, body) => request(`/notes/${id}`, { method: 'PUT', body }),
  deleteNote: (id) => request(`/notes/${id}`, { method: 'DELETE' }),
  moveNote: (id, body) => request(`/notes/${id}/move`, { method: 'POST', body }),
};
