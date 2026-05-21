const API = {
  base: '',

  getToken() {
    return localStorage.getItem('jwt_token');
  },

  setToken(token) {
    localStorage.setItem('jwt_token', token);
  },

  clearToken() {
    localStorage.removeItem('jwt_token');
  },

  async request(method, path, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    const token = this.getToken();
    if (token) {
      opts.headers['Authorization'] = `Bearer ${token}`;
    }
    if (body) {
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`${this.base}${path}`, opts);
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Request failed');
    }
    return data;
  },

  get(path) { return this.request('GET', path); },
  post(path, body) { return this.request('POST', path, body); },
  put(path, body) { return this.request('PUT', path, body); },
  del(path) { return this.request('DELETE', path); },

  // Auth
  async googleLogin(accessToken) {
    const res = await this.post('/api/auth/google', { accessToken });
    this.setToken(res.token);
    return res.user;
  },

  async getMe() {
    return this.get('/api/auth/me');
  },

  // Sessions
  getSessions() { return this.get('/api/sessions'); },
  createSession(name) { return this.post('/api/sessions', { name }); },
  getSession(id) { return this.get(`/api/sessions/${id}`); },
  joinSession(code) { return this.post('/api/sessions/join', { code }); },
  changeRole(sessionId, role) { return this.post(`/api/sessions/${sessionId}/role`, { role }); },
  endSession(sessionId) { return this.post(`/api/sessions/${sessionId}/end`); },

  // Hiding
  startHiding(sessionId) { return this.post(`/api/sessions/${sessionId}/start-hiding`); },
  imHidden(sessionId, extra) { return this.post(`/api/sessions/${sessionId}/im-hidden`, extra || {}); },

  // Search
  startSearch(sessionId) { return this.post(`/api/sessions/${sessionId}/start-search`); },
  searchResult(sessionId, result, extra) {
    return this.post(`/api/sessions/${sessionId}/search-result`, { result, ...(extra || {}) });
  },

  // Routes
  getRoutes(sessionId) { return this.get(`/api/sessions/${sessionId}/routes`); },
  assignRoute(sessionId, assignedTo, waypoints, snapped) {
    return this.post(`/api/sessions/${sessionId}/routes`, { assignedTo, waypoints, snapped });
  },
  deleteRoute(sessionId, routeId) { return this.del(`/api/sessions/${sessionId}/routes/${routeId}`); },

  // Summary
  getSummary(sessionId) { return this.get(`/api/sessions/${sessionId}/summary`); },

  // Profile
  updateProfile(data) { return this.put('/api/auth/profile', data); },

  // Dogs
  getDogs() { return this.get('/api/dogs'); },
  addDog(name) { return this.post('/api/dogs', { name }); },
  deleteDog(id) { return this.del(`/api/dogs/${id}`); },

  // Log
  getLogEntries() { return this.get('/api/log'); },
  getLogEntry(id) { return this.get(`/api/log/${id}`); },
  createLogEntry(data) { return this.post('/api/log', data); },
  updateLogEntry(id, data) { return this.put(`/api/log/${id}`, data); },
  deleteLogEntry(id) { return this.del(`/api/log/${id}`); },
};
