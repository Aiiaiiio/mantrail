const LOG_DIFFICULTIES = ['backtrack', 'time_delay', 'loop', 'smell_trap_kettle'];
const LOG_FEELINGS = ['excited', 'calm', 'annoyed', 'tense', 'happy', 'sleepy', 'tired'];
const LOG_PATH_TYPES = [
  { value: 'known', label: 'Known' },
  { value: 'guided_blind', label: 'Guided-Blind' },
  { value: 'assisted_blind', label: 'Assisted-Blind' },
  { value: 'double_blind', label: 'Double-Blind' },
];

function calcPathLength(waypoints) {
  if (!waypoints || waypoints.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < waypoints.length; i++) {
    const a = waypoints[i - 1];
    const b = waypoints[i];
    total += haversine(a.lat, a.lng, b.lat, b.lng);
  }
  return Math.round(total);
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toLocalDateInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toISOString().slice(0, 10);
}

function toLocalTimeInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toTimeString().slice(0, 5);
}

const App = {
  currentUser: null,
  currentSession: null,
  currentSessionData: null,
  map: null,
  markers: {},
  hidingPolyline: null,
  searchPolyline: null,
  assignedPolyline: null,
  membersData: {},
  drawingWaypoints: [],
  drawingTargetUserId: null,
  locationWatchId: null,
  locationInterval: null,
  trackedWaypoints: [],
  trackedPathType: null,
  logEntryPrefill: null,
  logEntryEditId: null,
  leMap: null,
  leMarker: null,

  async init() {
    try {
      const config = await fetch('/api/config').then(r => r.json());
      if (config.googleClientId) {
        document.getElementById('login-page').dataset.clientId = config.googleClientId;
      }
    } catch (e) {
      console.error('Failed to load config:', e);
    }

    const token = API.getToken();
    if (token) {
      try {
        const res = await API.getMe();
        this.currentUser = res.user;
      } catch (e) {
        API.clearToken();
      }
    }

    if (this.currentUser) {
      this.nav('dashboard');
    } else {
      this.nav('login');
    }
  },

  nav(page, params) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const el = document.getElementById(`${page}-page`);
    if (el) el.classList.add('active');

    switch (page) {
      case 'login':
        this.renderLogin();
        break;
      case 'dashboard':
        this.renderDashboard();
        break;
      case 'session':
        this.enterSession(params.id);
        break;
      case 'summary':
        this.renderSummary(params.id);
        break;
      case 'log':
        this.renderLog();
        break;
      case 'log-entry':
        this.renderLogEntry(params || {});
        break;
    }
  },

  showSnackbar(msg) {
    const el = document.getElementById('snackbar');
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 3000);
  },

  // ========== LOGIN ==========
  async renderLogin() {
    try {
      const config = await fetch('/api/config').then(r => r.json());
      const clientId = config.googleClientId;
      if (clientId) {
        document.getElementById('login-page').dataset.clientId = clientId;
      }
    } catch (e) {}

    const clientId = document.getElementById('login-page').dataset.clientId;
    if (!clientId) {
      this.showSnackbar('Google Client ID not configured');
      return;
    }

    const btn = document.getElementById('google-signin-btn');
    if (!btn) return;

    if (!window.google?.accounts?.oauth2) {
      setTimeout(() => this.renderLogin(), 500);
      return;
    }

    this.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'openid email profile',
      callback: (response) => {
        if (response.access_token) {
          this.handleGoogleSignIn(response.access_token);
        }
      },
    });

    btn.onclick = () => this.tokenClient.requestAccessToken();
  },

  async handleGoogleSignIn(accessToken) {
    try {
      const user = await API.googleLogin(accessToken);
      this.currentUser = user;
      this.nav('dashboard');
      this.showSnackbar(`Signed in as ${user.name}`);
    } catch (e) {
      this.showSnackbar('Login failed: ' + e.message);
    }
  },

  logout() {
    API.clearToken();
    this.currentUser = null;
    this.cleanupSession();
    WS.disconnect();
    this.nav('login');
  },

  // ========== DOGS ==========
  async renderDogs() {
    const list = document.getElementById('dogs-list');
    try {
      const res = await API.getDogs();
      const dogs = res.dogs;
      if (dogs.length === 0) {
        list.innerHTML = '<div class="empty-state" style="padding:12px;font-size:13px">No dogs yet.</div>';
        return;
      }
      list.innerHTML = dogs.map(d => `
        <div class="dog-item">
          <span>${d.name}</span>
          <button class="btn btn-sm btn-danger" onclick="App.deleteDog('${d.id}')">Remove</button>
        </div>
      `).join('');
    } catch (e) {
      list.innerHTML = `<div class="empty-state" style="padding:12px;font-size:13px">Error: ${e.message}</div>`;
    }
  },

  async deleteDog(id) {
    try {
      await API.deleteDog(id);
      this.renderDogs();
    } catch (e) {
      this.showSnackbar(e.message);
    }
  },

  // ========== DASHBOARD ==========
  async renderDashboard() {
    const list = document.getElementById('session-list');
    list.innerHTML = '<div class="empty-state">Loading...</div>';

    document.getElementById('user-name').textContent = this.currentUser?.name || '';

    document.getElementById('create-session-btn').onclick = () => {
      const name = prompt('Session name:');
      if (name) {
        API.createSession(name).then(res => {
          this.nav('session', { id: res.session.id });
        }).catch(e => this.showSnackbar(e.message));
      }
    };

    document.getElementById('join-session-btn').onclick = () => {
      const code = prompt('Enter invite code (e.g. MT-XXXXXX):');
      if (code) {
        API.joinSession(code).then(res => {
          this.nav('session', { id: res.session.id });
        }).catch(e => this.showSnackbar(e.message));
      }
    };

    document.getElementById('open-log-btn').onclick = () => {
      this.nav('log');
    };

    document.getElementById('logout-btn').onclick = () => this.logout();

    const dnInput = document.getElementById('display-name-input');
    const dn = this.currentUser?.display_name || this.currentUser?.name || '';
    dnInput.value = dn;

    document.getElementById('save-display-name-btn').onclick = async () => {
      const val = dnInput.value.trim();
      if (!val) return;
      try {
        const res = await API.updateProfile({ display_name: val });
        this.currentUser = res.user;
        API.setToken(res.token);
        this.showSnackbar('Display name updated!');
      } catch (e) {
        this.showSnackbar(e.message);
      }
    };

    document.getElementById('add-dog-btn').onclick = async () => {
      const input = document.getElementById('new-dog-name');
      const name = input.value.trim();
      if (!name) return;
      try {
        await API.addDog(name);
        input.value = '';
        this.renderDogs();
      } catch (e) {
        this.showSnackbar(e.message);
      }
    };

    this.renderDogs();

    try {
      const res = await API.getSessions();
      const sessions = res.sessions;

      if (sessions.length === 0) {
        list.innerHTML = '<div class="empty-state">No sessions yet. Create one or join with a code!</div>';
        return;
      }

      list.innerHTML = sessions.map(s => `
        <div class="card session-card" data-id="${s.id}">
          <h3>${s.name}</h3>
          <div class="meta">
            Status: <strong>${s.status}</strong> &middot;
            Code: <strong>${s.code}</strong> &middot;
            ${new Date(s.created_at).toLocaleDateString()}
          </div>
          <button class="btn btn-sm" onclick="App.nav('session', {id:'${s.id}'})">Open</button>
        </div>
      `).join('');
    } catch (e) {
      list.innerHTML = `<div class="empty-state">Error: ${e.message}</div>`;
    }
  },

  // ========== SESSION ==========
  async enterSession(sessionId) {
    this.cleanupSession();

    try {
      const res = await API.getSession(sessionId);
      this.currentSession = res.session;
      this.currentSessionData = res;

      if (res.session.status === 'completed') {
        this.cleanupSession();
        WS.disconnect();
        this.nav('summary', { id: sessionId });
        return;
      }

      this.renderSessionUI(res);
      this.setupSessionMap();
      this.connectWS(sessionId);
    } catch (e) {
      this.showSnackbar(e.message);
      this.nav('dashboard');
    }
  },

  renderSessionUI(data) {
    const { session, members } = data;
    const me = members.find(m => m.id === this.currentUser.id);
    const isMaster = me?.role === 'session_master';
    const isLost = me?.role === 'lost_person';
    const isHandler = me?.role === 'dog_handler';

    document.getElementById('session-title').textContent = session.name;
    document.getElementById('session-code').textContent = session.code;

    document.getElementById('back-to-dashboard').onclick = () => {
      this.cleanupSession();
      WS.disconnect();
      this.nav('dashboard');
    };

    document.getElementById('copy-code-btn').onclick = () => {
      navigator.clipboard.writeText(session.code).then(() => {
        this.showSnackbar('Code copied!');
      });
    };

    document.getElementById('role-passive-btn').onclick = () => API.changeRole(session.id, 'passive_member').then(r => {
      this.currentSessionData = r;
      this.updateSessionUI();
      WS.send({ type: 'role_changed', role: 'passive_member' });
    }).catch(e => this.showSnackbar(e.message));

    document.getElementById('role-lost-btn').onclick = () => API.changeRole(session.id, 'lost_person').then(r => {
      this.currentSessionData = r;
      this.updateSessionUI();
      WS.send({ type: 'role_changed', role: 'lost_person' });
    }).catch(e => this.showSnackbar(e.message));

    document.getElementById('role-handler-btn').onclick = () => API.changeRole(session.id, 'dog_handler').then(r => {
      this.currentSessionData = r;
      this.updateSessionUI();
      WS.send({ type: 'role_changed', role: 'dog_handler' });
    }).catch(e => this.showSnackbar(e.message));

    document.getElementById('start-hiding-btn').onclick = () => API.startHiding(session.id).then(() => {
      this.showSnackbar('Hiding started! Walk to your hiding spot.');
      this.startPathTracking('hiding');
    }).catch(e => this.showSnackbar(e.message));

    document.getElementById('im-hidden-btn').onclick = () => API.imHidden(session.id, { waypoints: this.trackedWaypoints }).then(() => {
      this.showSnackbar('You are hidden! Waiting for search.');
      this.stopAllTracking();
    }).catch(e => this.showSnackbar(e.message));

    document.getElementById('start-search-btn').onclick = () => API.startSearch(session.id).then(() => {
      this.showSnackbar('Search started!');
      this.startPathTracking('search');
    }).catch(e => this.showSnackbar(e.message));

    document.getElementById('found-btn').onclick = () => API.searchResult(session.id, 'found', { waypoints: this.trackedWaypoints }).then(res => {
      this.showSnackbar('Person found! Session complete.');
      this.stopAllTracking();
      this.offerLogEntry(res);
    }).catch(e => this.showSnackbar(e.message));

    document.getElementById('fail-btn').onclick = () => API.searchResult(session.id, 'failed', { waypoints: this.trackedWaypoints }).then(res => {
      this.showSnackbar('Search failed.');
      this.stopAllTracking();
      this.offerLogEntry(res);
    }).catch(e => this.showSnackbar(e.message));

    document.getElementById('end-session-btn').onclick = async () => {
      if (!confirm('End this session? Everyone will be redirected to the summary.')) return;
      try {
        await API.endSession(session.id);
        const sid = session.id;
        this.cleanupSession();
        WS.disconnect();
        this.nav('summary', { id: sid });
      } catch (e) {
        this.showSnackbar(e.message);
      }
    };

    document.getElementById('show-summary-btn').onclick = () => {
      this.cleanupSession();
      WS.disconnect();
      this.nav('summary', { id: session.id });
    };

    document.getElementById('jump-to-location-btn').onclick = () => {
      if (this.map) {
        this.map.locate({ setView: true, maxZoom: 16 });
      }
    };

    this.renderMembers(members);
    this.updateSessionUI();

    document.getElementById('action-buttons').style.display = 'block';
    document.getElementById('route-draw-section').style.display = isMaster ? 'block' : 'none';
  },

  offerLogEntry(res) {
    const search = res.search;
    if (!search) return;
    const durationMin = search.duration_seconds ? Math.round(search.duration_seconds / 60 * 10) / 10 : null;
    const waypoints = JSON.parse(search.waypoints || '[]');
    const lastWp = waypoints.length > 0 ? waypoints[waypoints.length - 1] : null;
    const pathLength = calcPathLength(waypoints);

    const handlerName = this.currentUser?.display_name || this.currentUser?.name || '';
    const prefill = {
      handler_name: handlerName,
      session_id: this.currentSession?.id || '',
      search_session_id: search.id,
      place_lat: lastWp?.lat ?? null,
      place_lng: lastWp?.lng ?? null,
      search_date: toLocalDateInput(new Date().toISOString()),
      search_time: toLocalTimeInput(new Date().toISOString()),
      search_duration_seconds: search.duration_seconds,
      path_length_meters: pathLength,
    };

    if (confirm('Save this search to your mantrailing log?')) {
      this.cleanupSession();
      WS.disconnect();
      this.nav('log-entry', { prefill });
    }
  },

  renderMembers(members) {
    const container = document.getElementById('member-list');
    container.innerHTML = members.map(m => `
      <div class="member-item">
        <span class="dot" style="background:${this.getColorForUser(m.id)}"></span>
        <strong>${m.name}</strong>
        <span class="role-badge">${m.role}</span>
      </div>
    `).join('');

    const select = document.getElementById('route-target-select');
    if (select) {
      const currentVal = select.value;
      select.innerHTML = members
        .filter(m => m.id !== this.currentUser.id)
        .map(m => `<option value="${m.id}">${m.name}</option>`)
        .join('');
      if (currentVal && members.some(m => m.id === currentVal)) {
        select.value = currentVal;
      }
    }
  },

  updateSessionUI() {
    if (!this.currentSessionData) return;
    const { members, session } = this.currentSessionData;
    const me = members.find(m => m.id === this.currentUser.id);
    const isLost = me?.role === 'lost_person';
    const isHandler = me?.role === 'dog_handler';
    const isMaster = me?.role === 'session_master';
    const isCompleted = session?.status === 'completed';

    const hasLostPerson = members.some(m => m.role === 'lost_person');
    const hasHandler = members.some(m => m.role === 'dog_handler');

    document.getElementById('role-passive-btn').style.display = !isCompleted && me?.role !== 'passive_member' ? '' : 'none';
    document.getElementById('role-lost-btn').style.display = !isCompleted && !isLost && !hasLostPerson ? '' : 'none';
    document.getElementById('role-handler-btn').style.display = !isCompleted && !isHandler && !hasHandler ? '' : 'none';
    document.getElementById('end-session-btn').style.display = isMaster && !isCompleted ? '' : 'none';
    document.getElementById('show-summary-btn').style.display = isCompleted ? '' : 'none';

    document.getElementById('hiding-controls').style.display = !isCompleted && isLost ? 'flex' : 'none';
    document.getElementById('search-controls').style.display = !isCompleted && isHandler ? 'flex' : 'none';

    document.getElementById('your-role').textContent = `Your role: ${me?.role || 'none'}`;
    this.renderMembers(members);
  },

  setupSessionMap() {
    if (this.map) {
      this.map.invalidateSize();
      return;
    }

    this.map = L.map('session-map').setView([47.2, 18.4], 13);

    L.tileLayer(`https://api.maptiler.com/maps/streets/{z}/{x}/{y}@2x.png?key=OP4WviE7Xy4CtJzPyOy0`, {
      tileSize: 512, zoomOffset: -1, maxZoom: 22,
      attribution: '&copy; OpenStreetMap contributors &copy; MapTiler',
    }).addTo(this.map);

    this.map.locate({ setView: true, maxZoom: 16 });

    this.setupDrawingControls();
  },

  getColorForUser(userId) {
    const colors = ['#136AEC', '#E53935', '#43A047', '#FB8C00', '#8E24AA', '#00ACC1', '#F4511E', '#3949AB'];
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      hash = ((hash << 5) - hash) + userId.charCodeAt(i);
    }
    return colors[Math.abs(hash) % colors.length];
  },

  // ========== WEBSOCKET ==========
  connectWS(sessionId) {
    WS.connect(sessionId);

    WS.on('session_state', (data) => {
      if (data.hiding) this.drawPath('hiding', JSON.parse(data.hiding.waypoints || '[]'));
      if (data.hidden) this.drawPath('hidden', JSON.parse(data.hidden.waypoints || '[]'));
      if (data.search) this.drawPath('search', JSON.parse(data.search.waypoints || '[]'));

      this.startLocationUpdates();
    });

    WS.on('member_joined', (data) => {
      this.currentSessionData.members = data.members;
      this.renderMembers(data.members);
    });

    WS.on('member_left', (data) => {
      this.removeMemberMarker(data.userId);
    });

    WS.on('location_update', (data) => {
      this.updateMemberMarker(data.userId, data.lat, data.lng, data.name, data.avatar_url);
    });

    WS.on('path_waypoint', (data) => {
      this.addPathPoint(data.pathType, data.lat, data.lng);
    });

    WS.on('role_changed', (data) => {
      if (this.currentSessionData) {
        const member = this.currentSessionData.members.find(m => m.id === data.userId);
        if (member) member.role = data.role;
        this.renderMembers(this.currentSessionData.members);
        this.updateSessionUI();
      }
    });

    WS.on('route_assigned', (data) => {
      this.drawAssignedRoute(data.route.waypoints);
      this.showSnackbar('You received a new route from the session master!');
    });

    WS.on('hiding_started', () => {
      this.showSnackbar('Lost person is now hiding...');
    });

    WS.on('hiding_ended', () => {
      this.showSnackbar('Lost person is hidden!');
    });

    WS.on('search_started', () => {
      this.showSnackbar('Search has begun!');
    });

    WS.on('search_ended', (data) => {
      this.showSnackbar(`Search ${data.result}!`);
      if (data.result === 'found') {
        this.currentSessionData.session.status = 'completed';
        this.updateSessionUI();
      }
    });

    WS.on('session_ended', () => {
      this.showSnackbar('Session ended!');
      const sessionId = this.currentSession?.id;
      setTimeout(() => {
        this.cleanupSession();
        WS.disconnect();
        this.nav('summary', { id: sessionId });
      }, 1500);
    });
  },

  // ========== MEMBER MARKERS ==========
  updateMemberMarker(userId, lat, lng, name, avatarUrl) {
    if (!this.map) return;

    if (this.markers[userId]) {
      this.markers[userId].setLatLng([lat, lng]);
    } else {
      let icon;
      if (avatarUrl) {
        icon = L.divIcon({
          className: 'user-marker',
          html: `<img src="${avatarUrl}" alt="" />`,
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        });
      } else {
        const initial = (name || '?')[0].toUpperCase();
        const color = this.getColorForUser(userId);
        icon = L.divIcon({
          className: 'user-marker',
          html: `<span style="background:${color}">${initial}</span>`,
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        });
      }
      const marker = L.marker([lat, lng], { icon }).addTo(this.map);
      marker.bindPopup(name || userId);
      this.markers[userId] = marker;
    }

    this.membersData[userId] = { lat, lng, name };
  },

  removeMemberMarker(userId) {
    if (this.markers[userId]) {
      this.markers[userId].remove();
      delete this.markers[userId];
    }
    delete this.membersData[userId];
  },

  // ========== PATH DRAWING ==========
  drawPath(type, waypoints) {
    if (!this.map || !waypoints || waypoints.length < 2) return;

    const coords = waypoints.map(w => [w.lat, w.lng]);
    const isHiding = type === 'hiding';
    const color = isHiding ? '#FB8C00' : '#E53935';

    const polyline = L.polyline(coords, { color, weight: 3, opacity: 0.8 }).addTo(this.map);

    if (isHiding) this.hidingPolyline = polyline;
    else this.searchPolyline = polyline;
  },

  addPathPoint(type, lat, lng) {
    if (!this.map) return;

    const isHiding = type === 'hiding';
    let polyline = isHiding ? this.hidingPolyline : this.searchPolyline;

    if (!polyline) {
      const color = isHiding ? '#FB8C00' : '#E53935';
      polyline = L.polyline([], { color, weight: 3, opacity: 0.8 }).addTo(this.map);
      if (isHiding) this.hidingPolyline = polyline;
      else this.searchPolyline = polyline;
    }

    polyline.addLatLng([lat, lng]);
  },

  drawAssignedRoute(waypoints) {
    if (!this.map || !waypoints || waypoints.length < 2) return;

    if (this.assignedPolyline) {
      this.assignedPolyline.remove();
    }

    const coords = waypoints.map(w => [w.lat, w.lng]);
    this.assignedPolyline = L.polyline(coords, {
      color: '#8E24AA', weight: 4, opacity: 0.9, dashArray: '10, 10',
    }).addTo(this.map);

    this.map.fitBounds(this.assignedPolyline.getBounds(), { padding: [50, 50] });
  },

  // ========== DRAWING CONTROLS (Session Master) ==========
  setupDrawingControls() {
    const toggleBtn = document.getElementById('toggle-draw-btn');
    const assignBtn = document.getElementById('assign-route-btn');
    const snapToggle = document.getElementById('snap-toggle');
    const waypointCount = document.getElementById('waypoint-count');

    toggleBtn.onclick = () => {
      this.isDrawing = !this.isDrawing;
      toggleBtn.textContent = this.isDrawing ? 'Stop Drawing' : 'Draw Route';

      if (this.isDrawing) {
        this.drawingWaypoints = [];
        waypointCount.textContent = '0 points';
        assignBtn.disabled = true;

        this.map.on('click', this.onMapClick);

        this.drawCursor = L.circleMarker([0, 0], {
          radius: 5, color: '#8E24AA', fillColor: '#8E24AA', fillOpacity: 0.5,
        }).addTo(this.map);

        this.map.on('mousemove', (e) => {
          if (this.drawCursor) this.drawCursor.setLatLng(e.latlng);
        });
      } else {
        this.map.off('click', this.onMapClick);
        if (this.drawCursor) { this.map.removeLayer(this.drawCursor); this.drawCursor = null; }
      }
    };

    this.onMapClick = (e) => {
      this.drawingWaypoints.push({ lat: e.latlng.lat, lng: e.latlng.lng });
      waypointCount.textContent = `${this.drawingWaypoints.length} points`;
      assignBtn.disabled = this.drawingWaypoints.length < 2;

      L.circleMarker([e.latlng.lat, e.latlng.lng], {
        radius: 4, color: '#8E24AA', fillColor: '#8E24AA', fillOpacity: 0.8,
      }).addTo(this.map);
    };

    assignBtn.onclick = async () => {
      const targetId = document.getElementById('route-target-select').value;
      if (!targetId || this.drawingWaypoints.length < 2) return;

      const snapped = snapToggle.checked;

      let waypoints = [...this.drawingWaypoints];
      if (snapped) {
        try {
          const snappedRes = await this.snapToRoads(waypoints);
          if (snappedRes) waypoints = snappedRes;
        } catch (e) {
          this.showSnackbar('Snap failed, using freehand route');
        }
      }

      try {
        await API.assignRoute(this.currentSession.id, targetId, waypoints, snapped);
        this.showSnackbar('Route assigned!');
        this.drawingWaypoints = [];
        waypointCount.textContent = '0 points';
        assignBtn.disabled = true;
      } catch (e) {
        this.showSnackbar(e.message);
      }
    };

  },

  async snapToRoads(waypoints) {
    const coords = waypoints.map(w => `${w.lng},${w.lat}`).join(';');
    const url = `https://router.project-osrm.org/match/v1/driving/${coords}?steps=true&geometries=geojson&overview=full`;

    const res = await fetch(url);
    const data = await res.json();

    if (data.code !== 'Ok' || !data.matchings?.length) return null;

    const snapped = data.matchings[0].geometry.coordinates.map(c => ({
      lat: c[1],
      lng: c[0],
    }));

    if (this.assignedPolyline) this.assignedPolyline.remove();
    this.assignedPolyline = L.polyline(snapped.map(p => [p.lat, p.lng]), {
      color: '#8E24AA', weight: 4, opacity: 0.9, dashArray: '10, 10',
    }).addTo(this.map);

    return snapped;
  },

  // ========== LOCATION TRACKING ==========
  startLocationUpdates() {
    if (this.locationUpdateInterval) return;
    if (!navigator.geolocation) return;

    this.locationUpdateInterval = setInterval(() => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude: lat, longitude: lng } = pos.coords;
          WS.send({
            type: 'location_update',
            lat: lat.toString(),
            lng: lng.toString(),
            name: this.currentUser.name,
            avatar_url: this.currentUser.avatar_url || '',
          });
        },
        () => {},
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 3000 },
      );
    }, 2000);
  },

  startPathTracking(pathType) {
    this.trackedWaypoints = [];
    this.trackedPathType = pathType;

    if (!navigator.geolocation) {
      this.showSnackbar('Geolocation not available');
      return;
    }

    const sendPosition = () => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude: lat, longitude: lng } = pos.coords;
          const ts = Date.now();
          this.trackedWaypoints.push({ lat, lng, t: ts });
          WS.send({
            type: 'path_waypoint',
            pathType,
            lat: lat.toString(),
            lng: lng.toString(),
            timestamp: ts,
          });
        },
        (err) => {
          console.error('Geo error:', err.message);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 3000 },
      );
    };

    sendPosition();
    this.pathTrackingInterval = setInterval(sendPosition, 2000);
  },

  stopAllTracking() {
    if (this.locationUpdateInterval) {
      clearInterval(this.locationUpdateInterval);
      this.locationUpdateInterval = null;
    }
    if (this.pathTrackingInterval) {
      clearInterval(this.pathTrackingInterval);
      this.pathTrackingInterval = null;
    }
    this.trackedPathType = null;
  },

  // ========== SUMMARY ==========
  async renderSummary(sessionId) {
    try {
      const res = await API.getSummary(sessionId);
      const { session, members, hidingSessions, searchSessions, routes } = res;

      document.getElementById('summary-title').textContent = session.name;

      const container = document.getElementById('summary-content');

      let html = `<div class="card"><h3>Details</h3><p>Status: ${session.status}</p>`;
      html += `<p>Created: ${new Date(session.created_at).toLocaleString()}</p></div>`;

      if (hidingSessions.length) {
        html += '<div class="card"><h3>Hiding Routes</h3>';
        hidingSessions.forEach(h => {
          const waypoints = JSON.parse(h.waypoints || '[]');
          const duration = h.started_at && h.ended_at
            ? Math.round((new Date(h.ended_at) - new Date(h.started_at)) / 1000 / 60) + ' min'
            : 'N/A';
          html += `<p><strong>${h.user_name}</strong> &middot; ${waypoints.length} points &middot; ${duration}</p>`;
        });
        html += '</div>';
      }

      if (searchSessions.length) {
        html += '<div class="card"><h3>Search Routes</h3>';
        searchSessions.forEach(s => {
          const waypoints = JSON.parse(s.waypoints || '[]');
          const duration = s.duration_seconds
            ? Math.round(s.duration_seconds / 60) + ' min ' + (s.duration_seconds % 60) + ' sec'
            : 'N/A';
          html += `<p><strong>${s.user_name}</strong> &middot; Result: ${s.result} &middot; Duration: ${duration}</p>`;
          html += `<p>${waypoints.length} waypoints recorded</p>`;
        });
        html += '</div>';
      }

      if (routes.length) {
        html += '<div class="card"><h3>Assigned Routes</h3>';
        routes.forEach(r => {
          const waypoints = JSON.parse(r.waypoints);
          html += `<p>To: <strong>${r.assigned_to_name}</strong> &middot; ${waypoints.length} points ${r.snapped ? '(snapped)' : ''}</p>`;
        });
        html += '</div>';
      }

      html += '<button class="btn btn-secondary" onclick="App.nav(\'dashboard\')">Back to Dashboard</button>';

      container.innerHTML = html;

      if (this.summaryMap) {
        this.summaryMap.remove();
        this.summaryMap = null;
      }

      this.summaryMap = L.map('summary-map').setView([47.2, 18.4], 13);
      L.tileLayer(`https://api.maptiler.com/maps/streets/{z}/{x}/{y}@2x.png?key=OP4WviE7Xy4CtJzPyOy0`, {
        tileSize: 512, zoomOffset: -1, maxZoom: 22,
        attribution: '&copy; OpenStreetMap contributors &copy; MapTiler',
      }).addTo(this.summaryMap);

      const allCoords = [];

      hidingSessions.forEach(h => {
        const waypoints = JSON.parse(h.waypoints || '[]');
        if (waypoints.length > 1) {
          const coords = waypoints.map(w => [w.lat, w.lng]);
          L.polyline(coords, { color: '#FB8C00', weight: 4, opacity: 0.8 }).addTo(this.summaryMap);
          allCoords.push(...coords);
        }
      });

      searchSessions.forEach(s => {
        const waypoints = JSON.parse(s.waypoints || '[]');
        if (waypoints.length > 1) {
          const coords = waypoints.map(w => [w.lat, w.lng]);
          L.polyline(coords, { color: '#E53935', weight: 4, opacity: 0.8 }).addTo(this.summaryMap);
          allCoords.push(...coords);
        }
      });

      routes.forEach(r => {
        const waypoints = JSON.parse(r.waypoints);
        if (waypoints.length > 1) {
          const coords = waypoints.map(w => [w.lat, w.lng]);
          L.polyline(coords, { color: '#8E24AA', weight: 3, opacity: 0.7, dashArray: '8, 8' }).addTo(this.summaryMap);
          allCoords.push(...coords);
        }
      });

      if (allCoords.length > 1) {
        this.summaryMap.fitBounds(allCoords, { padding: [50, 50] });
      }

      setTimeout(() => this.summaryMap.invalidateSize(), 500);
    } catch (e) {
      document.getElementById('summary-content').innerHTML = `<div class="empty-state">Error: ${e.message}</div>`;
    }
  },

  // ========== LOG LIST ==========
  async renderLog() {
    document.getElementById('back-from-log-btn').onclick = () => this.nav('dashboard');

    document.getElementById('new-log-entry-btn').onclick = () => {
      this.nav('log-entry', { prefill: null });
    };

    const list = document.getElementById('log-entries-list');
    list.innerHTML = '<div class="empty-state">Loading...</div>';

    try {
      const res = await API.getLogEntries();
      const entries = res.entries;

      if (entries.length === 0) {
        list.innerHTML = '<div class="empty-state">No log entries yet.</div>';
        return;
      }

      list.innerHTML = entries.map(e => {
        const difficulties = JSON.parse(e.difficulties || '[]');
        const feelings = JSON.parse(e.handler_feelings || '[]');
        const date = e.search_date ? new Date(e.search_date + 'T' + (e.search_time || '00:00')).toLocaleString() : 'N/A';
        return `
          <div class="card log-entry-card" data-id="${e.id}">
            <div class="log-entry-header">
              <strong>${e.handler_name}</strong> &middot; ${e.dog_name}
              <span class="meta">${date}</span>
            </div>
            <div class="meta">
              ${e.place_name ? e.place_name + ' &middot; ' : ''}
              ${e.path_type ? e.path_type.replace(/_/g, ' ') + ' &middot; ' : ''}
              ${e.search_duration_seconds ? Math.round(e.search_duration_seconds / 60) + ' min' : ''}
              ${e.path_length_meters ? ' &middot; ' + e.path_length_meters + ' m' : ''}
            </div>
            <div class="meta">
              ${difficulties.length ? 'Difficulties: ' + difficulties.join(', ') : ''}
              ${feelings.length ? 'Feelings: ' + feelings.join(', ') : ''}
            </div>
            <div style="margin-top:8px">
              <button class="btn btn-sm" onclick="App.editLogEntry('${e.id}')">Edit</button>
              <button class="btn btn-sm btn-danger" onclick="App.deleteLogEntry('${e.id}')">Delete</button>
            </div>
          </div>
        `;
      }).join('');
    } catch (e) {
      list.innerHTML = `<div class="empty-state">Error: ${e.message}</div>`;
    }
  },

  async editLogEntry(id) {
    try {
      const res = await API.getLogEntries();
      const entry = res.entries.find(e => e.id === id);
      if (entry) {
        this.nav('log-entry', { entryId: id, prefill: entry });
      }
    } catch (e) {
      this.showSnackbar(e.message);
    }
  },

  async deleteLogEntry(id) {
    if (!confirm('Delete this log entry?')) return;
    try {
      await API.deleteLogEntry(id);
      this.renderLog();
    } catch (e) {
      this.showSnackbar(e.message);
    }
  },

  // ========== LOG ENTRY FORM ==========
  async renderLogEntry(params) {
    this.cleanupLogEntryMap();

    const isEdit = !!params.entryId;
    const prefill = params.prefill || {};

    document.getElementById('log-entry-title').textContent = isEdit ? 'Edit Log Entry' : 'New Log Entry';
    document.getElementById('cancel-log-entry-btn').onclick = () => this.nav('log');

    const deleteBtn = document.getElementById('delete-log-entry-btn');
    deleteBtn.style.display = isEdit ? '' : 'none';
    if (isEdit) {
      deleteBtn.onclick = async () => {
        if (!confirm('Delete this log entry?')) return;
        try {
          await API.deleteLogEntry(params.entryId);
          this.nav('log');
        } catch (e) {
          this.showSnackbar(e.message);
        }
      };
    }

    // Populate dog dropdown
    const dogSelect = document.getElementById('le-dog-name');
    try {
      const dogsRes = await API.getDogs();
      const dogs = dogsRes.dogs;
      dogSelect.innerHTML = '<option value="">Select a dog...</option>' +
        dogs.map(d => `<option value="${d.name}">${d.name}</option>`).join('');
    } catch (e) {
      console.error('Failed to load dogs:', e);
    }

    // Populate checkboxes
    this.renderCheckboxGroup('le-difficulties', LOG_DIFFICULTIES);
    this.renderCheckboxGroup('le-feelings', LOG_FEELINGS);

    // Fill form
    document.getElementById('le-handler-name').value = prefill.handler_name || '';
    if (prefill.dog_name && prefill.dog_name !== '') {
      dogSelect.value = prefill.dog_name;
    } else if (dogSelect.options.length === 2) {
      // Only one dog, pre-select it
      dogSelect.value = dogSelect.options[1].value;
    }
    document.getElementById('le-search-date').value = prefill.search_date || '';
    document.getElementById('le-search-time').value = prefill.search_time || '';
    document.getElementById('le-place-name').value = prefill.place_name || '';
    document.getElementById('le-weather').value = prefill.weather_conditions || '';

    if (prefill.search_duration_seconds != null) {
      document.getElementById('le-duration').value = Math.round(prefill.search_duration_seconds / 60 * 10) / 10;
    } else {
      document.getElementById('le-duration').value = '';
    }

    if (prefill.path_length_meters != null) {
      document.getElementById('le-path-length').value = prefill.path_length_meters;
    } else {
      document.getElementById('le-path-length').value = '';
    }

    document.getElementById('le-path-type').value = prefill.path_type || '';

    // Set checkboxes for difficulties/feelings
    const difficulties = prefill.difficulties ? (typeof prefill.difficulties === 'string' ? JSON.parse(prefill.difficulties) : prefill.difficulties) : [];
    const feelings = prefill.handler_feelings ? (typeof prefill.handler_feelings === 'string' ? JSON.parse(prefill.handler_feelings) : prefill.handler_feelings) : [];

    document.querySelectorAll('#le-difficulties input[type="checkbox"]').forEach(cb => {
      cb.checked = difficulties.includes(cb.value);
    });
    document.querySelectorAll('#le-feelings input[type="checkbox"]').forEach(cb => {
      cb.checked = feelings.includes(cb.value);
    });

    document.getElementById('le-notes').value = prefill.notes || '';

    // Setup mini map
    this.setupLogEntryMap(prefill);

    // Store metadata for submit
    this.logEntryPrefill = prefill;
    this.logEntryEditId = params.entryId || null;

    document.getElementById('save-log-entry-btn').onclick = (e) => this.saveLogEntry(e);
  },

  renderCheckboxGroup(containerId, options) {
    const container = document.getElementById(containerId);
    container.innerHTML = options.map(opt => `
      <label class="checkbox-label">
        <input type="checkbox" value="${opt}" />
        ${opt.replace(/_/g, ' ')}
      </label>
    `).join('');
  },

  getCheckedValues(containerId) {
    const values = [];
    document.querySelectorAll(`#${containerId} input[type="checkbox"]:checked`).forEach(cb => {
      values.push(cb.value);
    });
    const custom = document.getElementById(`${containerId}-custom`);
    if (custom && custom.value.trim()) {
      values.push(custom.value.trim());
    }
    return values;
  },

  setupLogEntryMap(prefill) {
    const mapEl = document.getElementById('le-map');
    if (!mapEl) return;

    this.leMap = L.map(mapEl).setView([47.2, 18.4], 13);
    L.tileLayer(`https://api.maptiler.com/maps/streets/{z}/{x}/{y}@2x.png?key=OP4WviE7Xy4CtJzPyOy0`, {
      tileSize: 512, zoomOffset: -1, maxZoom: 22,
      attribution: '&copy; OpenStreetMap contributors &copy; MapTiler',
    }).addTo(this.leMap);

    if (prefill.place_lat != null && prefill.place_lng != null) {
      this.leMap.setView([prefill.place_lat, prefill.place_lng], 15);
      this.leMarker = L.marker([prefill.place_lat, prefill.place_lng]).addTo(this.leMap);
      document.getElementById('le-coords').textContent = `${prefill.place_lat.toFixed(6)}, ${prefill.place_lng.toFixed(6)}`;
    } else {
      this.leMap.locate({ setView: true, maxZoom: 15 });
    }

    this.leMap.on('click', (e) => {
      if (this.leMarker) this.leMarker.remove();
      this.leMarker = L.marker([e.latlng.lat, e.latlng.lng]).addTo(this.leMap);
      document.getElementById('le-coords').textContent = `${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}`;
    });

    setTimeout(() => this.leMap.invalidateSize(), 300);
  },

  cleanupLogEntryMap() {
    if (this.leMarker) { this.leMarker.remove(); this.leMarker = null; }
    if (this.leMap) { this.leMap.remove(); this.leMap = null; }
  },

  async saveLogEntry(e) {
    e.preventDefault();

    const data = {
      handler_name: document.getElementById('le-handler-name').value.trim(),
      dog_name: document.getElementById('le-dog-name').value,
      search_date: document.getElementById('le-search-date').value,
      search_time: document.getElementById('le-search-time').value,
      place_name: document.getElementById('le-place-name').value.trim() || null,
      weather_conditions: document.getElementById('le-weather').value.trim(),
      path_type: document.getElementById('le-path-type').value,
      difficulties: this.getCheckedValues('le-difficulties'),
      handler_feelings: this.getCheckedValues('le-feelings'),
      notes: document.getElementById('le-notes').value.trim(),
    };

    const duration = parseFloat(document.getElementById('le-duration').value);
    data.search_duration_seconds = isNaN(duration) ? null : Math.round(duration * 60);

    const pathLen = parseFloat(document.getElementById('le-path-length').value);
    data.path_length_meters = isNaN(pathLen) ? null : Math.round(pathLen);

    if (this.leMarker) {
      const latlng = this.leMarker.getLatLng();
      data.place_lat = latlng.lat;
      data.place_lng = latlng.lng;
    }

    if (this.logEntryPrefill?.session_id) data.session_id = this.logEntryPrefill.session_id;
    if (this.logEntryPrefill?.search_session_id) data.search_session_id = this.logEntryPrefill.search_session_id;

    if (!data.handler_name || !data.dog_name || !data.search_date || !data.search_time) {
      this.showSnackbar('Handler name, dog, date, and time are required');
      return;
    }

    try {
      if (this.logEntryEditId) {
        await API.updateLogEntry(this.logEntryEditId, data);
        this.showSnackbar('Entry updated!');
      } else {
        await API.createLogEntry(data);
        this.showSnackbar('Entry saved!');
      }
      this.logEntryPrefill = null;
      this.logEntryEditId = null;
      this.nav('log');
    } catch (e) {
      this.showSnackbar(e.message);
    }
  },

  // ========== CLEANUP ==========
  cleanupSession() {
    this.stopAllTracking();

    Object.values(this.markers).forEach(m => {
      if (m.remove) m.remove();
    });
    this.markers = {};
    this.membersData = {};

    if (this.hidingPolyline) { this.hidingPolyline.remove(); this.hidingPolyline = null; }
    if (this.searchPolyline) { this.searchPolyline.remove(); this.searchPolyline = null; }
    if (this.assignedPolyline) { this.assignedPolyline.remove(); this.assignedPolyline = null; }

    this.isDrawing = false;
    this.drawingWaypoints = [];
    if (this.drawCursor && this.map) { this.map.removeLayer(this.drawCursor); this.drawCursor = null; }

    this.currentSession = null;
    this.currentSessionData = null;
    this.locationPathType = null;
  },
};

document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
