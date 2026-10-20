/**
 * API Client Service
 */

const getAuthHeaders = () => {
  const token = localStorage.getItem('cp_token');
  const headers = {
    'Content-Type': 'application/json'
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
};

const handleResponse = async (res) => {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errorMsg = data.message || data.error || (data.errors && data.errors[0]?.msg) || 'API Request Failed';
    throw new Error(errorMsg);
  }
  return data;
};

export const api = {
  // Authentication
  login: async (email, password) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    return handleResponse(res);
  },

  logout: async () => {
    const res = await fetch('/api/auth/logout', {
      method: 'POST',
      headers: getAuthHeaders()
    });
    return handleResponse(res);
  },

  getMe: async () => {
    const res = await fetch('/api/auth/me', {
      headers: getAuthHeaders()
    });
    return handleResponse(res);
  },

  // Profile
  updateProfile: async (data) => {
    const res = await fetch('/api/profile', {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(data)
    });
    return handleResponse(res);
  },

  changePassword: async (currentPassword, newPassword) => {
    const res = await fetch('/api/profile/password', {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ currentPassword, newPassword })
    });
    return handleResponse(res);
  },

  // User Management (Admin Only)
  getUsers: async (params = {}) => {
    const query = new URLSearchParams(params).toString();
    const res = await fetch(`/api/users${query ? `?${query}` : ''}`, {
      headers: getAuthHeaders()
    });
    return handleResponse(res);
  },

  createUser: async (userData) => {
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(userData)
    });
    return handleResponse(res);
  },

  updateUser: async (id, userData) => {
    const res = await fetch(`/api/users/${id}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(userData)
    });
    return handleResponse(res);
  },

  deleteUser: async (id) => {
    const res = await fetch(`/api/users/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    return handleResponse(res);
  },

  // Nodes
  getNodes: async (params = {}) => {
    const query = new URLSearchParams(params).toString();
    const res = await fetch(`/api/nodes${query ? `?${query}` : ''}`, {
      headers: getAuthHeaders()
    });
    return handleResponse(res);
  },

  createNode: async (nodeData) => {
    const res = await fetch('/api/nodes', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(nodeData)
    });
    return handleResponse(res);
  },

  updateNode: async (id, nodeData) => {
    const res = await fetch(`/api/nodes/${id}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(nodeData)
    });
    return handleResponse(res);
  },

  deleteNode: async (id) => {
    const res = await fetch(`/api/nodes/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    return handleResponse(res);
  },

  // Alerts
  getAlerts: async (params = {}) => {
    const query = new URLSearchParams(params).toString();
    const res = await fetch(`/api/alerts${query ? `?${query}` : ''}`, {
      headers: getAuthHeaders()
    });
    return handleResponse(res);
  },

  updateAlertStatus: async (id, status) => {
    const res = await fetch(`/api/alerts/${id}`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify({ status })
    });
    return handleResponse(res);
  },

  // Cameras
  getCameras: async () => {
    const res = await fetch('/api/cameras', {
      headers: getAuthHeaders()
    });
    return handleResponse(res);
  },

  uploadCameraFrame: async (cameraId, frameBase64) => {
    const res = await fetch(`/api/cameras/${cameraId}/frame`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ frameBase64, timestamp: new Date().toISOString() })
    });
    return handleResponse(res);
  }
};
