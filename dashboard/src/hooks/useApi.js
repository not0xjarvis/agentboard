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
};
