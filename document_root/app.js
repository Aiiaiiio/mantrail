const LOG_DIFFICULTIES = ['backtrack', 'time_delay', 'loop', 'smell_trap_kettle'];
const LOG_FEELINGS = ['excited', 'calm', 'annoyed', 'tense', 'happy', 'sleepy', 'tired'];
const LOG_PATH_TYPES = [
  { value: 'known', labelKey: 'logEntry.pathType_known' },
  { value: 'guided_blind', labelKey: 'logEntry.pathType_guided_blind' },
  { value: 'assisted_blind', labelKey: 'logEntry.pathType_assisted_blind' },
  { value: 'double_blind', labelKey: 'logEntry.pathType_double_blind' },
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

function medianPosition(positions) {
  if (!positions || positions.length === 0) return null;
  const lats = positions.map(p => p.lat).sort((a, b) => a - b);
  const lngs = positions.map(p => p.lng).sort((a, b) => a - b);
  const mid = Math.floor(positions.length / 2);
  return { lat: lats[mid], lng: lngs[mid] };
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

const WMO_CODES = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Foggy', 48: 'Depositing rime fog',
  51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle',
  56: 'Light freezing drizzle', 57: 'Dense freezing drizzle',
  61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
  66: 'Light freezing rain', 67: 'Heavy freezing rain',
  71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Slight rain showers', 81: 'Moderate rain showers', 82: 'Violent rain showers',
  85: 'Slight snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm with slight hail', 99: 'Thunderstorm with heavy hail',
};

function weatherCodeText(code) {
  const key = 'weather.' + code;
  const translated = I18n.t(key);
  if (translated !== key) return translated;
  return WMO_CODES[code] || '';
}

async function fetchWeather(lat, lng, dateStr) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    if (dateStr && dateStr !== today) {
      const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}&start_date=${dateStr}&end_date=${dateStr}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode&timezone=auto`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.daily) {
        const d = data.daily;
        const parts = [];
        if (d.temperature_2m_max?.[0] != null && d.temperature_2m_min?.[0] != null) {
          parts.push(`${Math.round(d.temperature_2m_min[0])}–${Math.round(d.temperature_2m_max[0])}°C`);
        }
        if (d.weathercode?.[0] != null) {
          const w = weatherCodeText(d.weathercode[0]);
          if (w) parts.push(w);
        }
        if (d.precipitation_sum?.[0] != null && d.precipitation_sum[0] > 0) {
          parts.push(`${d.precipitation_sum[0]} mm rain`);
        }
        return parts.join(', ');
      }
    } else {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weathercode,precipitation&timezone=auto`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.current) {
        const c = data.current;
        const parts = [];
        if (c.temperature_2m != null) parts.push(`${Math.round(c.temperature_2m)}°C`);
        if (c.weathercode != null) {
          const w = weatherCodeText(c.weathercode);
          if (w) parts.push(w);
        }
        if (c.precipitation != null && c.precipitation > 0) {
          parts.push(`${c.precipitation} mm rain`);
        }
        return parts.join(', ');
      }
    }
  } catch (e) {
    console.error('Weather fetch error:', e);
  }
  return '';
}

const App = {
  currentUser: null,
  currentSession: null,
  currentSessionData: null,
  currentPage: null,
  currentPageParams: null,
  cachedSessions: null,
  pendingInviteToken: null,
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
      this.appVersion = config.version || '';
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

    I18n.onReady.push(() => {
      I18n.applyDOM();
      if (this.currentUser) {
        this.nav('dashboard');
      } else {
        this.nav('login');
      }
    });

    await I18n.init();

    this.setTheme(localStorage.getItem('theme') || 'system');

    document.addEventListener('change', (e) => {
      if (e.target.id === 'settings-language-select') {
        I18n.setLocale(e.target.value);
      } else if (e.target.id === 'settings-theme-select') {
        this.setTheme(e.target.value);
      }
    });
  },

  onLocaleChange() {
    const page = this.currentPage;
    if (page === 'dashboard') {
      this.renderSessionList();
    } else if (page === 'session' && this.currentSession) {
      this.updateSessionUI();
    } else if (page === 'access-management') {
      API.getAllowlist().then(r => this.renderAllowlist(r.entries)).catch(() => {});
      this.renderInviteTokens();
    } else if (page === 'settings') {
      const sel = document.getElementById('settings-language-select');
      if (sel) sel.value = I18n.locale;
      const themeSel = document.getElementById('settings-theme-select');
      if (themeSel) themeSel.value = this.theme;
      const card = document.getElementById('settings-access-card');
      if (card) card.style.display = this.currentUser?.can_invite ? '' : 'none';
    }
  },

  nav(page, params) {
    this.currentPage = page;
    this.currentPageParams = params;

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
      case 'log-detail':
        this.renderLogDetail(params.id);
        break;
      case 'access-denied':
        break;
      case 'access-management':
        this.renderAccessManagementPage();
        break;
      case 'settings':
        this.renderSettingsPage();
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
    // Read invite token from URL
    const params = new URLSearchParams(window.location.search);
    this.pendingInviteToken = params.get('token') || null;

    try {
      const config = await fetch('/api/config').then(r => r.json());
      const clientId = config.googleClientId;
      if (clientId) {
        document.getElementById('login-page').dataset.clientId = clientId;
      }
    } catch (e) {}

    const clientId = document.getElementById('login-page').dataset.clientId;
    if (!clientId) {
      this.showSnackbar(I18n.t('login.googleNotConfigured'));
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
          this.handleGoogleSignIn(response.access_token, this.pendingInviteToken);
        }
      },
    });

    btn.onclick = () => this.tokenClient.requestAccessToken();
  },

  async handleGoogleSignIn(accessToken, inviteToken) {
    try {
      const user = await API.googleLogin(accessToken, inviteToken);
      this.pendingInviteToken = null;
      this.currentUser = user;
      this.nav('dashboard');
      this.showSnackbar(I18n.t('login.signedInAs', { name: user.name }));
    } catch (e) {
      if (e.message && e.message.startsWith('Access restricted')) {
        this.nav('access-denied');
      } else {
        this.showSnackbar(I18n.t('login.loginFailed', { message: e.message }));
      }
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
        list.innerHTML = `<div class="empty-state" style="padding:12px;font-size:13px">${I18n.t('dashboard.noDogs')}</div>`;
        return;
      }
      list.innerHTML = dogs.map(d => `
        <div class="dog-item">
          <span>${d.name}</span>
          <button class="btn btn-sm btn-danger" onclick="App.deleteDog('${d.id}')">${I18n.t('dashboard.remove')}</button>
        </div>
      `).join('');
    } catch (e) {
      list.innerHTML = `<div class="empty-state" style="padding:12px;font-size:13px">${I18n.t('dogs.error', { message: e.message })}</div>`;
    }
  },

  async deleteDog(id) {
    try {
      await API.deleteDog(id);
      this.renderDogs();
    } catch (e) {
      this.showSnackbar(I18n.t('errors.generic', { message: e.message }));
    }
  },

  // ========== DASHBOARD ==========
  async renderDashboard() {
    const list = document.getElementById('session-list');
    list.innerHTML = `<div class="empty-state">${I18n.t('app.loading')}</div>`;

    document.getElementById('user-name').textContent = this.currentUser?.name || '';
    document.getElementById('version-tag').textContent = this.appVersion ? `v${this.appVersion}` : '';

    document.getElementById('create-session-btn').onclick = () => {
      const name = prompt(I18n.t('dashboard.sessionName'));
      if (name) {
        API.createSession(name).then(res => {
          this.nav('session', { id: res.session.id });
        }).catch(e => this.showSnackbar(I18n.t('errors.generic', { message: e.message })));
      }
    };

    document.getElementById('join-session-btn').onclick = () => {
      const code = prompt(I18n.t('dashboard.enterCode'));
      if (code) {
        API.joinSession(code).then(res => {
          this.nav('session', { id: res.session.id });
        }).catch(e => this.showSnackbar(I18n.t('errors.generic', { message: e.message })));
      }
    };

    document.getElementById('open-log-btn').onclick = () => {
      this.nav('log');
    };

    const manageBtn = document.getElementById('manage-access-btn');
    if (this.currentUser?.can_invite) {
      manageBtn.style.display = '';
      manageBtn.onclick = () => this.nav('access-management');
    } else {
      manageBtn.style.display = 'none';
    }

    document.getElementById('settings-btn').onclick = () => this.nav('settings');
    document.getElementById('logout-btn').onclick = () => this.logout();

    document.getElementById('add-dog-btn').onclick = async () => {
      const input = document.getElementById('new-dog-name');
      const name = input.value.trim();
      if (!name) return;
      try {
        await API.addDog(name);
        input.value = '';
    this.renderDogs();
      } catch (e) {
        this.showSnackbar(I18n.t('errors.generic', { message: e.message }));
      }
    };

    this.renderDogs();

    try {
      const res = await API.getSessions();
      this.cachedSessions = res.sessions;
      this.renderSessionList();
    } catch (e) {
      list.innerHTML = `<div class="empty-state">${I18n.t('errors.generic', { message: e.message })}</div>`;
    }
  },

  renderSessionList() {
    const list = document.getElementById('session-list');
    const sessions = this.cachedSessions;
    if (!sessions || sessions.length === 0) {
      list.innerHTML = `<div class="empty-state">${I18n.t('dashboard.noSessions')}</div>`;
      return;
    }
    list.innerHTML = sessions.map(s => `
      <div class="card session-card" data-id="${s.id}">
        <h3>${s.name}</h3>
        <div class="meta">
          ${I18n.t('dashboard.code')}: <strong>${s.code}</strong> &middot;
          ${new Date(s.created_at).toLocaleDateString()}
        </div>
        <button class="btn btn-sm" onclick="App.nav('session', {id:'${s.id}'})">${I18n.t('dashboard.open')}</button>
      </div>
    `).join('');
  },

  // ========== SETTINGS ==========
  setTheme(theme) {
    this.theme = theme;
    localStorage.setItem('theme', theme);

    if (this._themeMqListener) {
      this._themeMq.removeEventListener('change', this._themeMqListener);
      this._themeMqListener = null;
    }

    if (theme === 'system') {
      this._themeMq = window.matchMedia('(prefers-color-scheme: dark)');
      this._themeMqListener = (e) => {
        document.documentElement.dataset.theme = e.matches ? 'dark' : 'light';
        this._swapTileLayers();
      };
      this._themeMq.addEventListener('change', this._themeMqListener);
      document.documentElement.dataset.theme = this._themeMq.matches ? 'dark' : 'light';
    } else {
      document.documentElement.dataset.theme = theme;
    }

    this._swapTileLayers();
  },

  getTileUrl() {
    const isDark = (document.documentElement.dataset.theme === 'dark');
    const style = isDark ? 'streets-dark' : 'streets';
    return `https://api.maptiler.com/maps/${style}/{z}/{x}/{y}@2x.png?key=OP4WviE7Xy4CtJzPyOy0`;
  },

  _swapTileLayers() {
    const url = this.getTileUrl();
    [this._tileLayer, this._summaryTileLayer, this._leTileLayer].forEach(l => {
      if (l) l.setUrl(url);
    });
  },

  renderSettingsPage() {
    document.getElementById('settings-language-select').value = I18n.locale;
    document.getElementById('settings-theme-select').value = this.theme || 'system';

    const card = document.getElementById('settings-access-card');
    if (this.currentUser?.can_invite) {
      card.style.display = '';
      document.getElementById('settings-access-btn').onclick = () => this.nav('access-management');
    } else {
      card.style.display = 'none';
    }

    const dnInput = document.getElementById('settings-display-name-input');
    dnInput.value = this.currentUser?.display_name || this.currentUser?.name || '';
    document.getElementById('settings-save-display-name-btn').onclick = async () => {
      const val = dnInput.value.trim();
      if (!val) return;
      try {
        const res = await API.updateProfile({ display_name: val });
        this.currentUser = res.user;
        API.setToken(res.token);
        this.showSnackbar(I18n.t('dashboard.displayNameUpdated'));
      } catch (e) {
        this.showSnackbar(I18n.t('errors.generic', { message: e.message }));
      }
    };

    document.getElementById('back-from-settings-btn').onclick = () => this.nav('dashboard');
  },

  // ========== ACCESS MANAGEMENT ==========
  async renderAccessManagementPage() {
    document.getElementById('back-from-access-btn').onclick = () => this.nav('dashboard');

    try {
      const res = await API.getAllowlist();
      this.renderAllowlist(res.entries);
    } catch (e) {
      this.nav('dashboard');
      return;
    }

    this.renderInviteTokens();

    document.getElementById('add-allowed-btn').onclick = async () => {
      const input = document.getElementById('new-allowed-email');
      const email = input.value.trim();
      if (!email) return;
      const canInvite = document.getElementById('add-can-invite').checked;
      try {
        await API.addToAllowlist(email, canInvite);
        input.value = '';
        document.getElementById('add-can-invite').checked = false;
        const res = await API.getAllowlist();
        this.renderAllowlist(res.entries);
      } catch (e) {
        this.showSnackbar(I18n.t('errors.generic', { message: e.message }));
      }
    };

    document.getElementById('generate-invite-btn').onclick = async () => {
      const canInvite = document.getElementById('invite-can-invite').checked;
      try {
        const res = await API.generateInvite(canInvite);
        const url = `${window.location.origin}${window.location.pathname}?token=${res.token.token}`;
        await navigator.clipboard.writeText(url);
        this.showSnackbar(I18n.t('access.inviteCopied'));
        document.getElementById('invite-can-invite').checked = false;
        this.renderInviteTokens();
      } catch (e) {
        this.showSnackbar(I18n.t('errors.generic', { message: e.message }));
      }
    };
  },

  renderAllowlist(entries) {
    const container = document.getElementById('allowlist-entries');
    container.innerHTML = entries.map(e => `
      <div class="dog-item">
        <span>${e.email}</span>
        <span style="font-size:12px;color:${e.can_invite ? '#43a047' : '#999'};margin-left:8px">
          ${e.can_invite ? I18n.t('access.granted') : I18n.t('access.restricted')}
        </span>
        <button class="btn btn-sm ${e.can_invite ? 'btn-secondary' : 'btn'}" onclick="App.toggleAllowedPermission('${e.id}', ${e.can_invite ? 0 : 1})">
          ${e.can_invite ? I18n.t('access.restricted') : I18n.t('access.granted')}
        </button>
        <button class="btn btn-sm btn-danger" onclick="App.removeAllowedEmail('${e.id}')">${I18n.t('dashboard.remove')}</button>
      </div>
    `).join('');
  },

  async toggleAllowedPermission(id, canInvite) {
    try {
      await API.toggleAllowlistPermission(id, canInvite);
      const res = await API.getAllowlist();
      this.renderAllowlist(res.entries);
    } catch (e) {
      this.showSnackbar(I18n.t('errors.generic', { message: e.message }));
    }
  },

  async removeAllowedEmail(id) {
    try {
      await API.removeFromAllowlist(id);
      const res = await API.getAllowlist();
      this.renderAllowlist(res.entries);
    } catch (e) {
      this.showSnackbar(I18n.t('errors.generic', { message: e.message }));
    }
  },

  async renderInviteTokens() {
    const container = document.getElementById('invite-tokens-list');
    try {
      const res = await API.getInviteTokens();
      const tokens = res.tokens;
      container.innerHTML = tokens.map(t => {
        const url = `${window.location.origin}${window.location.pathname}?token=${t.token}`;
        return `
          <div class="dog-item">
            <span style="font-size:12px;font-family:monospace;word-break:break-all">${t.token}</span>
            <button class="btn btn-sm btn-secondary" onclick="navigator.clipboard.writeText('${url}')">${I18n.t('session.copy')}</button>
            <button class="btn btn-sm btn-danger" onclick="App.deleteInviteToken('${t.id}')">${I18n.t('access.deleteToken')}</button>
          </div>
        `;
      }).join('');
      if (!tokens.length) {
        container.innerHTML = `<div style="font-size:13px;color:#999">${I18n.t('access.noInvites')}</div>`;
      }
    } catch (e) {
      container.innerHTML = '';
    }
  },

  async deleteInviteToken(id) {
    try {
      await API.deleteInviteToken(id);
      this.renderInviteTokens();
    } catch (e) {
      this.showSnackbar(I18n.t('errors.generic', { message: e.message }));
    }
  },

  // ========== SESSION ==========
  async enterSession(sessionId) {
    this.cleanupSession();

    try {
      const res = await API.getSession(sessionId);
      this.currentSession = res.session;
      this.currentSessionData = res;

      this.renderSessionUI(res);
      this.setupSessionMap();
      this.connectWS(sessionId);
    } catch (e) {
      this.showSnackbar(I18n.t('errors.generic', { message: e.message }));
      this.nav('dashboard');
    }
  },

  renderSessionUI(data) {
    const { session, members } = data;
    const me = members.find(m => m.id === this.currentUser.id);
    const isMaster = me?.is_master === 1;
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
        this.showSnackbar(I18n.t('session.codeCopied'));
      });
    };

    document.getElementById('role-passive-btn').onclick = () => API.changeRole(session.id, 'passive_member').then(r => {
      this.currentSessionData = r;
      this.updateSessionUI();
      WS.send({ type: 'role_changed', role: 'passive_member' });
    }).catch(e => this.showSnackbar(I18n.t('errors.generic', { message: e.message })));

    document.getElementById('role-lost-btn').onclick = () => API.changeRole(session.id, 'lost_person').then(r => {
      this.currentSessionData = r;
      this.updateSessionUI();
      WS.send({ type: 'role_changed', role: 'lost_person' });
    }).catch(e => this.showSnackbar(I18n.t('errors.generic', { message: e.message })));

    document.getElementById('role-handler-btn').onclick = () => API.changeRole(session.id, 'dog_handler').then(r => {
      this.currentSessionData = r;
      this.updateSessionUI();
      WS.send({ type: 'role_changed', role: 'dog_handler' });
    }).catch(e => this.showSnackbar(I18n.t('errors.generic', { message: e.message })));

    document.getElementById('start-hiding-btn').onclick = () => API.startHiding(session.id).then(() => {
      this.showSnackbar(I18n.t('session.hidingStarted'));
      this.startPathTracking('hiding');
    }).catch(e => this.showSnackbar(I18n.t('errors.generic', { message: e.message })));

    document.getElementById('im-hidden-btn').onclick = () => API.imHidden(session.id, { waypoints: this.trackedWaypoints }).then(() => {
      this.showSnackbar(I18n.t('session.youAreHidden'));
      this.stopAllTracking();
    }).catch(e => this.showSnackbar(I18n.t('errors.generic', { message: e.message })));

    document.getElementById('start-search-btn').onclick = () => API.startSearch(session.id).then(() => {
      this.showSnackbar(I18n.t('session.searchStarted'));
      this.startPathTracking('search');
    }).catch(e => this.showSnackbar(I18n.t('errors.generic', { message: e.message })));

    document.getElementById('found-btn').onclick = () => API.searchResult(session.id, 'found', { waypoints: this.trackedWaypoints }).then(res => {
      this.showSnackbar(I18n.t('session.foundMsg'));
      this.stopAllTracking();
      this.offerLogEntry(res);
    }).catch(e => this.showSnackbar(I18n.t('errors.generic', { message: e.message })));

    document.getElementById('fail-btn').onclick = () => API.searchResult(session.id, 'failed', { waypoints: this.trackedWaypoints }).then(res => {
      this.showSnackbar(I18n.t('session.failedMsg'));
      this.stopAllTracking();
      this.offerLogEntry(res);
    }).catch(e => this.showSnackbar(I18n.t('errors.generic', { message: e.message })));

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

    const prefill = {
      session_id: this.currentSession?.id || '',
      search_session_id: search.id,
      place_lat: lastWp?.lat ?? null,
      place_lng: lastWp?.lng ?? null,
      search_date: toLocalDateInput(new Date().toISOString()),
      search_time: toLocalTimeInput(new Date().toISOString()),
      search_duration_seconds: search.duration_seconds,
      path_length_meters: pathLength,
    };

    if (confirm(I18n.t('session.saveToLog'))) {
      this.cleanupSession();
      WS.disconnect();
      this.nav('log-entry', { prefill });
    }
  },

  renderMembers(members) {
    const container = document.getElementById('member-list');
    container.innerHTML = members.map(m => {
      const roleLabel = I18n.t('roles.' + m.role) || m.role;
      const masterBadge = m.is_master ? `<span class="master-badge" title="${I18n.t('roles.session_master')}">M</span>` : '';
      return `
        <div class="member-item">
          <span class="dot" style="background:${this.getColorForUser(m.id)}"></span>
          <strong>${m.name}</strong> ${masterBadge}
          <span class="role-badge">${roleLabel}</span>
        </div>
      `;
    }).join('');

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

    const hasLostPerson = members.some(m => m.role === 'lost_person');
    const hasHandler = members.some(m => m.role === 'dog_handler');

    document.getElementById('role-passive-btn').style.display = me?.role !== 'passive_member' ? '' : 'none';
    document.getElementById('role-lost-btn').style.display = !isLost && !hasLostPerson ? '' : 'none';
    document.getElementById('role-handler-btn').style.display = !isHandler && !hasHandler ? '' : 'none';
    document.getElementById('show-summary-btn').style.display = '';

    document.getElementById('hiding-controls').style.display = isLost ? 'flex' : 'none';
    document.getElementById('search-controls').style.display = isHandler ? 'flex' : 'none';

    document.getElementById('your-role').textContent = I18n.t('session.yourRole', { role: I18n.t('roles.' + (me?.role || 'none')) });
    this.renderMembers(members);

    // Re-apply data-i18n attributes that may have been overwritten
    I18n.applyDOM();
  },

  setupSessionMap() {
    if (this.map) {
      this.map.invalidateSize();
      return;
    }

    this.map = L.map('session-map').setView([47.2, 18.4], 13);

    this._tileLayer = L.tileLayer(this.getTileUrl(), {
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
      this.showSnackbar(I18n.t('session.routeReceived'));
    });

    WS.on('hiding_started', () => {
      this.showSnackbar(I18n.t('session.lostPersonHiding'));
    });

    WS.on('hiding_ended', () => {
      this.showSnackbar(I18n.t('session.lostPersonHidden'));
    });

    WS.on('search_started', () => {
      this.showSnackbar(I18n.t('session.searchBegun'));
    });

    WS.on('search_ended', (data) => {
      const result = data.result === 'found' ? I18n.t('session.resultFound') : I18n.t('session.resultFailed');
      this.showSnackbar(I18n.t('session.searchResult', { result }));
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
        const initial = (name || '?')[0].toUpperCase();
        const color = this.getColorForUser(userId);
        icon = L.divIcon({
          className: 'user-marker',
          html: `<img src="${avatarUrl}" alt=""
            onerror="this.parentElement.innerHTML='<span style=\\'background:${color}\\'>${initial}</span>'" />`,
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
      toggleBtn.textContent = this.isDrawing ? I18n.t('session.stopDrawing') : I18n.t('session.drawRoute');

      if (this.isDrawing) {
        this.drawingWaypoints = [];
        waypointCount.textContent = `0 ${I18n.t('session.points')}`;
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
      waypointCount.textContent = `${this.drawingWaypoints.length} ${I18n.t('session.points')}`;
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
          this.showSnackbar(I18n.t('session.snapFailed'));
        }
      }

      try {
        await API.assignRoute(this.currentSession.id, targetId, waypoints, snapped);
        this.showSnackbar(I18n.t('session.routeAssigned'));
        this.drawingWaypoints = [];
        waypointCount.textContent = `0 ${I18n.t('session.points')}`;
        assignBtn.disabled = true;
      } catch (e) {
        this.showSnackbar(I18n.t('errors.generic', { message: e.message }));
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
    if (this.locationWatchId != null) return;
    if (!navigator.geolocation) return;

    this.posBuffer = [];
    this.lastSentPos = null;
    this.lastSentTime = 0;

    this.locationWatchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude: lat, longitude: lng, accuracy } = pos.coords;

        this.updateMemberMarker(this.currentUser.id, lat, lng, this.currentUser.name, this.currentUser.avatar_url || '');

        if (accuracy > 30) return;

        this.posBuffer.push({ lat, lng });
        if (this.posBuffer.length > 7) this.posBuffer.shift();

        const median = medianPosition(this.posBuffer);
        if (!median) return;

        this.updateMemberMarker(this.currentUser.id, median.lat, median.lng, this.currentUser.name, this.currentUser.avatar_url || '');

        const now = Date.now();
        if (now - this.lastSentTime < 1000) return;

        if (this.lastSentPos) {
          const dist = haversine(this.lastSentPos.lat, this.lastSentPos.lng, median.lat, median.lng);
          if (dist > 20) {
            this.lastSentPos = { lat, lng };
            this.lastSentTime = now;
            WS.send({
              type: 'location_update',
              lat: lat.toString(),
              lng: lng.toString(),
              name: this.currentUser.name,
              avatar_url: this.currentUser.avatar_url || '',
            });
            return;
          }
          if (dist < 2 && now - this.lastSentTime < 10000) return;
        }

        this.lastSentPos = { lat: median.lat, lng: median.lng };
        this.lastSentTime = now;
        WS.send({
          type: 'location_update',
          lat: median.lat.toString(),
          lng: median.lng.toString(),
          name: this.currentUser.name,
          avatar_url: this.currentUser.avatar_url || '',
        });
      },
      (err) => { console.error('Location watch error:', err.message); },
      { enableHighAccuracy: true, maximumAge: 0 },
    );
  },

  startPathTracking(pathType) {
    this.trackedWaypoints = [];
    this.trackedPathType = pathType;

    if (!navigator.geolocation) {
      this.showSnackbar('Geolocation not available');
      return;
    }

    this.pathPosBuffer = [];
    this.pathLastSentPos = null;
    this.pathLastSentTime = 0;

    this.pathWatchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude: lat, longitude: lng, accuracy } = pos.coords;

        const ts = Date.now();
        this.trackedWaypoints.push({ lat, lng, t: ts });

        this.updateMemberMarker(this.currentUser.id, lat, lng, this.currentUser.name, this.currentUser.avatar_url || '');

        if (accuracy > 30) return;

        this.pathPosBuffer.push({ lat, lng });
        if (this.pathPosBuffer.length > 7) this.pathPosBuffer.shift();

        const median = medianPosition(this.pathPosBuffer);
        if (!median) return;

        this.updateMemberMarker(this.currentUser.id, median.lat, median.lng, this.currentUser.name, this.currentUser.avatar_url || '');

        if (ts - this.pathLastSentTime < 1000) return;

        if (this.pathLastSentPos) {
          const dist = haversine(this.pathLastSentPos.lat, this.pathLastSentPos.lng, median.lat, median.lng);
          if (dist > 20) {
            this.pathLastSentPos = { lat, lng };
            this.pathLastSentTime = ts;
            WS.send({
              type: 'path_waypoint',
              pathType,
              lat: lat.toString(),
              lng: lng.toString(),
              timestamp: ts,
            });
            return;
          }
          if (dist < 2 && ts - this.pathLastSentTime < 10000) return;
        }

        this.pathLastSentPos = { lat: median.lat, lng: median.lng };
        this.pathLastSentTime = ts;
        WS.send({
          type: 'path_waypoint',
          pathType,
          lat: median.lat.toString(),
          lng: median.lng.toString(),
          timestamp: ts,
        });
      },
      (err) => { console.error('Path watch error:', err.message); },
      { enableHighAccuracy: true, maximumAge: 0 },
    );
  },

  stopAllTracking() {
    if (this.locationWatchId != null) {
      navigator.geolocation.clearWatch(this.locationWatchId);
      this.locationWatchId = null;
    }
    if (this.pathWatchId != null) {
      navigator.geolocation.clearWatch(this.pathWatchId);
      this.pathWatchId = null;
    }
    this.posBuffer = [];
    this.pathPosBuffer = [];
    this.lastSentPos = null;
    this.trackedPathType = null;
  },

  // ========== SUMMARY ==========
  async renderSummary(sessionId) {
    try {
      const res = await API.getSummary(sessionId);
      const { session, members, hidingSessions, searchSessions, routes } = res;

      document.getElementById('summary-title').textContent = session.name;

      const container = document.getElementById('summary-content');

      let html = `<div class="card"><h3>${I18n.t('summary.details')}</h3>`;
      html += `<p>${I18n.t('summary.status', { status: session.status })}</p>`;
      html += `<p>${I18n.t('summary.created', { date: new Date(session.created_at).toLocaleString() })}</p></div>`;

      if (hidingSessions.length) {
        html += `<div class="card"><h3>${I18n.t('summary.hidingRoutes')}</h3>`;
        hidingSessions.forEach(h => {
          const waypoints = JSON.parse(h.waypoints || '[]');
          const duration = h.started_at && h.ended_at
            ? Math.round((new Date(h.ended_at) - new Date(h.started_at)) / 1000 / 60) + ' ' + I18n.t('summary.min')
            : 'N/A';
          html += `<p><strong>${h.user_name}</strong> &middot; ${I18n.t('summary.pointsCount', { count: waypoints.length })} &middot; ${duration}</p>`;
        });
        html += '</div>';
      }

      if (searchSessions.length) {
        html += `<div class="card"><h3>${I18n.t('summary.searchRoutes')}</h3>`;
        searchSessions.forEach(s => {
          const waypoints = JSON.parse(s.waypoints || '[]');
          const duration = s.duration_seconds
            ? Math.round(s.duration_seconds / 60) + ' ' + I18n.t('summary.min') + ' ' + (s.duration_seconds % 60) + ' sec'
            : 'N/A';
          html += `<p><strong>${s.user_name}</strong> &middot; ${I18n.t('summary.result', { result: s.result })} &middot; ${I18n.t('summary.duration', { duration })}</p>`;
          html += `<p>${I18n.t('summary.waypoints', { count: waypoints.length })}</p>`;
        });
        html += '</div>';
      }

      if (routes.length) {
        html += `<div class="card"><h3>${I18n.t('summary.assignedRoutes')}</h3>`;
        routes.forEach(r => {
          const waypoints = JSON.parse(r.waypoints);
          html += `<p>To: <strong>${r.assigned_to_name}</strong> &middot; ${I18n.t('summary.pointsCount', { count: waypoints.length })} ${r.snapped ? I18n.t('summary.snapped') : ''}</p>`;
        });
        html += '</div>';
      }

      html += `<button class="btn btn-secondary" onclick="App.nav('dashboard')">${I18n.t('summary.backToDashboard')}</button>`;

      container.innerHTML = html;

      if (this.summaryMap) {
        this.summaryMap.remove();
        this.summaryMap = null;
      }

      this.summaryMap = L.map('summary-map').setView([47.2, 18.4], 13);
      this._summaryTileLayer = L.tileLayer(this.getTileUrl(), {
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
      document.getElementById('summary-content').innerHTML = `<div class="empty-state">${I18n.t('errors.generic', { message: e.message })}</div>`;
    }
  },

  // ========== LOG LIST ==========
  async renderLog() {
    document.getElementById('back-from-log-btn').onclick = () => this.nav('dashboard');

    document.getElementById('new-log-entry-btn').onclick = () => {
      this.nav('log-entry', { prefill: null });
    };

    const list = document.getElementById('log-entries-list');
    list.innerHTML = `<div class="empty-state">${I18n.t('app.loading')}</div>`;

    try {
      const res = await API.getLogEntries();
      const entries = res.entries;

      if (entries.length === 0) {
        list.innerHTML = `<div class="empty-state">${I18n.t('log.noEntries')}</div>`;
        return;
      }

      list.innerHTML = entries.map(e => {
        const difficulties = JSON.parse(e.difficulties || '[]');
        const feelings = JSON.parse(e.handler_feelings || '[]');
        const date = e.search_date ? new Date(e.search_date + 'T' + (e.search_time || '00:00')).toLocaleString() : 'N/A';
        return `
          <div class="card log-entry-card" onclick="App.nav('log-detail', {id:'${e.id}'})" style="cursor:pointer">
            <div class="log-entry-header">
              <strong>${e.handler_name}</strong> &middot; ${e.dog_name}
              <span class="meta">${date}</span>
            </div>
            <div class="meta">
              ${e.place_name ? e.place_name + ' &middot; ' : ''}
              ${e.path_type ? e.path_type.replace(/_/g, ' ') + ' &middot; ' : ''}
              ${e.search_duration_seconds ? Math.round(e.search_duration_seconds / 60) + ' ' + I18n.t('summary.min') : ''}
              ${e.path_length_meters ? ' &middot; ' + e.path_length_meters + ' m' : ''}
            </div>
            <div class="meta">
              ${difficulties.length ? I18n.t('logDetail.difficulties') + ': ' + difficulties.join(', ') : ''}
              ${feelings.length ? I18n.t('logDetail.feelings') + ': ' + feelings.join(', ') : ''}
            </div>
            <div style="margin-top:8px">
              <button class="btn btn-sm" onclick="event.stopPropagation();App.editLogEntry('${e.id}')">${I18n.t('log.edit')}</button>
              <button class="btn btn-sm btn-danger" onclick="event.stopPropagation();App.deleteLogEntry('${e.id}')">${I18n.t('log.delete')}</button>
            </div>
          </div>
        `;
      }).join('');
    } catch (e) {
      list.innerHTML = `<div class="empty-state">${I18n.t('errors.generic', { message: e.message })}</div>`;
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
      this.showSnackbar(I18n.t('errors.generic', { message: e.message }));
    }
  },

  async deleteLogEntry(id) {
    if (!confirm(I18n.t('log.deleteConfirm'))) return;
    try {
      await API.deleteLogEntry(id);
      this.showSnackbar(I18n.t('log.entryDeleted'));
      this.renderLog();
    } catch (e) {
      this.showSnackbar(I18n.t('errors.generic', { message: e.message }));
    }
  },

  // ========== LOG DETAIL VIEW ==========
  async renderLogDetail(id) {
    const container = document.getElementById('log-detail-content');
    container.innerHTML = `<div class="empty-state">${I18n.t('app.loading')}</div>`;

    document.getElementById('back-from-detail-btn').onclick = () => this.nav('log');

    try {
      const res = await API.getLogEntry(id);
      const e = res.entry;

      const difficulties = JSON.parse(e.difficulties || '[]');
      const feelings = JSON.parse(e.handler_feelings || '[]');
      const date = e.search_date ? new Date(e.search_date + 'T' + (e.search_time || '00:00')).toLocaleString() : 'N/A';

      let html = `
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap">
            <div>
              <h3>${e.handler_name} &middot; ${e.dog_name}</h3>
              <p style="font-size:13px;color:#888">${date}</p>
            </div>
            <div style="display:flex;gap:8px">
              <button class="btn btn-sm" onclick="App.editLogEntryFromDetail('${e.id}')">${I18n.t('log.edit')}</button>
              <button class="btn btn-sm btn-danger" onclick="App.deleteLogEntryFromDetail('${e.id}')">${I18n.t('log.delete')}</button>
            </div>
          </div>
          <hr style="margin:12px 0" />
          <table class="detail-table">
      `;

      const fields = [
        [I18n.t('logDetail.duration'), e.search_duration_seconds ? Math.round(e.search_duration_seconds / 60) + ' ' + I18n.t('summary.min') + ' ' + (e.search_duration_seconds % 60) + ' sec' : null],
        [I18n.t('logDetail.pathLength'), e.path_length_meters ? e.path_length_meters + ' m' : null],
        [I18n.t('logDetail.pathType'), e.path_type ? e.path_type.replace(/_/g, ' ') : null],
        [I18n.t('logDetail.place'), e.place_name || (e.place_lat != null && e.place_lng != null ? `${e.place_lat.toFixed(6)}, ${e.place_lng.toFixed(6)}` : null)],
        [I18n.t('logDetail.weather'), e.weather_conditions || null],
        [I18n.t('logDetail.difficulties'), difficulties.length ? difficulties.join(', ') : null],
        [I18n.t('logDetail.feelings'), feelings.length ? feelings.join(', ') : null],
        [I18n.t('logDetail.notes'), e.notes || null],
      ];

      fields.forEach(([label, val]) => {
        if (val) {
          html += `<tr><td class="dt-label">${label}</td><td class="dt-value">${val}</td></tr>`;
        }
      });

      html += `</table></div>`;

      const hasCoords = e.place_lat != null && e.place_lng != null;

      if (hasCoords) {
        html += `<div id="detail-map" style="height:300px;border-radius:12px;margin-bottom:16px"></div>`;
      }

      html += `<button class="btn btn-secondary" onclick="App.nav('log')">${I18n.t('summary.backToLog')}</button>`;

      container.innerHTML = html;

      if (hasCoords) {
        const detailMap = L.map('detail-map').setView([e.place_lat, e.place_lng], 14);
        L.tileLayer(this.getTileUrl(), {
          tileSize: 512, zoomOffset: -1, maxZoom: 22,
          attribution: '&copy; OpenStreetMap contributors &copy; MapTiler',
        }).addTo(detailMap);
        L.marker([e.place_lat, e.place_lng]).addTo(detailMap);
        setTimeout(() => detailMap.invalidateSize(), 300);
      }
    } catch (e) {
      container.innerHTML = `<div class="empty-state">${I18n.t('errors.generic', { message: e.message })}</div>`;
    }
  },

  async editLogEntryFromDetail(id) {
    try {
      const res = await API.getLogEntry(id);
      this.nav('log-entry', { entryId: id, prefill: res.entry });
    } catch (e) {
      this.showSnackbar(I18n.t('errors.generic', { message: e.message }));
    }
  },

  async deleteLogEntryFromDetail(id) {
    if (!confirm(I18n.t('log.deleteConfirm'))) return;
    try {
      await API.deleteLogEntry(id);
      this.showSnackbar(I18n.t('log.entryDeleted'));
      this.nav('log');
    } catch (e) {
      this.showSnackbar(I18n.t('errors.generic', { message: e.message }));
    }
  },

  // ========== LOG ENTRY FORM ==========
  async renderLogEntry(params) {
    this.cleanupLogEntryMap();

    const isEdit = !!params.entryId;
    const prefill = params.prefill || {};

    document.getElementById('log-entry-title').textContent = isEdit ? I18n.t('logEntry.editTitle') : I18n.t('logEntry.newTitle');
    document.getElementById('cancel-log-entry-btn').onclick = () => this.nav('log');

    const deleteBtn = document.getElementById('delete-log-entry-btn');
    deleteBtn.style.display = isEdit ? '' : 'none';
    if (isEdit) {
      deleteBtn.onclick = async () => {
        if (!confirm(I18n.t('log.deleteConfirm'))) return;
        try {
          await API.deleteLogEntry(params.entryId);
          this.showSnackbar(I18n.t('log.entryDeleted'));
          this.nav('log');
        } catch (e) {
          this.showSnackbar(I18n.t('errors.generic', { message: e.message }));
        }
      };
    }

    // Populate dog dropdown
    const dogSelect = document.getElementById('le-dog-name');
    try {
      const dogsRes = await API.getDogs();
      const dogs = dogsRes.dogs;
      dogSelect.innerHTML = `<option value="">${I18n.t('logEntry.selectDog')}</option>` +
        dogs.map(d => `<option value="${d.name}">${d.name}</option>`).join('');
    } catch (e) {
      console.error('Failed to load dogs:', e);
    }

    // Populate checkboxes
    this.renderCheckboxGroup('le-difficulties', LOG_DIFFICULTIES, 'difficulties');
    this.renderCheckboxGroup('le-feelings', LOG_FEELINGS, 'feelings');

    // Fill form — handler name is always the current user's display name
    const handlerDisplay = this.currentUser?.display_name || this.currentUser?.name || '';
    document.getElementById('le-handler-name').value = handlerDisplay;
    if (prefill.dog_name && prefill.dog_name !== '') {
      dogSelect.value = prefill.dog_name;
    } else if (dogSelect.options.length === 2) {
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

    // Fetch weather from Open-Meteo if weather field is empty
    const weatherInput = document.getElementById('le-weather');
    if (!weatherInput.value) {
      let wlat = prefill.place_lat, wlng = prefill.place_lng;
      if (wlat == null || wlng == null) {
        try {
          const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000 }));
          wlat = pos.coords.latitude;
          wlng = pos.coords.longitude;
        } catch (e) {}
      }
      if (wlat != null && wlng != null) {
        const w = await fetchWeather(wlat, wlng, prefill.search_date);
        if (w) weatherInput.value = w;
      }
    }

    // Store metadata for submit
    this.logEntryPrefill = prefill;
    this.logEntryEditId = params.entryId || null;

    document.getElementById('save-log-entry-btn').onclick = (e) => this.saveLogEntry(e);
  },

  renderCheckboxGroup(containerId, options, group) {
    const container = document.getElementById(containerId);
    container.innerHTML = options.map(opt => {
      const label = I18n.t(`${group}.${opt}`);
      return `
        <label class="checkbox-label">
          <input type="checkbox" value="${opt}" />
          ${label || opt.replace(/_/g, ' ')}
        </label>
      `;
    }).join('');
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
    this._leTileLayer = L.tileLayer(this.getTileUrl(), {
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
      handler_name: this.currentUser?.display_name || this.currentUser?.name || '',
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
      this.showSnackbar(I18n.t('logEntry.required'));
      return;
    }

    try {
      if (this.logEntryEditId) {
        await API.updateLogEntry(this.logEntryEditId, data);
        this.showSnackbar(I18n.t('session.entryUpdated'));
      } else {
        await API.createLogEntry(data);
        this.showSnackbar(I18n.t('session.entrySaved'));
      }
      this.logEntryPrefill = null;
      this.logEntryEditId = null;
      this.nav('log');
    } catch (e) {
      this.showSnackbar(I18n.t('errors.generic', { message: e.message }));
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

window.App = App;

document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
