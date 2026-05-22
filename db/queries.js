const { db } = require('./index');
const { v4: uuid } = require('uuid');

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'MT-';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function now() {
  return new Date().toISOString();
}

const q = {
  findUserByGoogleId: db.prepare('SELECT * FROM users WHERE google_id = ?'),
  createUser: db.prepare('INSERT INTO users (id, google_id, name, email, avatar_url) VALUES (?, ?, ?, ?, ?)'),
  findUserById: db.prepare('SELECT * FROM users WHERE id = ?'),

  insertSession: db.prepare('INSERT INTO sessions (id, code, name, created_by, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
  findSessionById: db.prepare('SELECT * FROM sessions WHERE id = ?'),
  findSessionByCode: db.prepare('SELECT * FROM sessions WHERE code = ? AND status = ?'),
  findUserSessions: db.prepare(`SELECT s.* FROM sessions s
    INNER JOIN session_members sm ON sm.session_id = s.id
    WHERE sm.user_id = ?
    ORDER BY s.created_at DESC`),
  updateSessionStatus: db.prepare('UPDATE sessions SET status = ? WHERE id = ?'),

  insertMember: db.prepare('INSERT OR IGNORE INTO session_members (id, session_id, user_id, role, is_master, joined_at) VALUES (?, ?, ?, ?, ?, ?)'),
  updateMemberMaster: db.prepare('UPDATE session_members SET is_master = 1 WHERE session_id = ? AND user_id = ?'),
  findMember: db.prepare('SELECT * FROM session_members WHERE session_id = ? AND user_id = ?'),
  findSessionMembers: db.prepare(`SELECT u.id, u.name, u.email, u.avatar_url, sm.role, sm.is_master, sm.joined_at
    FROM session_members sm INNER JOIN users u ON u.id = sm.user_id
    WHERE sm.session_id = ?`),
  countMembersInRole: db.prepare('SELECT COUNT(*) as count FROM session_members WHERE session_id = ? AND role = ?'),
  updateMemberRole: db.prepare('UPDATE session_members SET role = ? WHERE session_id = ? AND user_id = ?'),

  insertHiding: db.prepare('INSERT INTO hiding_sessions (id, session_id, user_id, started_at, status) VALUES (?, ?, ?, ?, ?)'),
  findActiveHidingByUser: db.prepare('SELECT * FROM hiding_sessions WHERE user_id = ? AND session_id = ? AND status = ?'),
  findActiveHidingBySession: db.prepare('SELECT * FROM hiding_sessions WHERE session_id = ? AND status = ?'),
  updateHidingEnd: db.prepare('UPDATE hiding_sessions SET ended_at = ?, waypoints = ?, status = ? WHERE id = ?'),
  updateHidingWaypoints: db.prepare('UPDATE hiding_sessions SET waypoints = ? WHERE id = ?'),

  insertSearch: db.prepare('INSERT INTO search_sessions (id, session_id, user_id, started_at) VALUES (?, ?, ?, ?)'),
  findSearchById: db.prepare('SELECT * FROM search_sessions WHERE id = ?'),
  findActiveSearchByUser: db.prepare('SELECT * FROM search_sessions WHERE user_id = ? AND session_id = ? AND result IS NULL'),
  findActiveSearchBySession: db.prepare('SELECT * FROM search_sessions WHERE session_id = ? AND result IS NULL'),
  updateSearchEnd: db.prepare('UPDATE search_sessions SET ended_at = ?, waypoints = ?, result = ?, duration_seconds = ? WHERE id = ?'),
  updateSearchWaypoints: db.prepare('UPDATE search_sessions SET waypoints = ? WHERE id = ?'),

  insertAssignedRoute: db.prepare('INSERT INTO assigned_routes (id, session_id, assigned_by, assigned_to, waypoints, snapped) VALUES (?, ?, ?, ?, ?, ?)'),
  findRoutesForUser: db.prepare('SELECT * FROM assigned_routes WHERE session_id = ? AND assigned_to = ?'),
  findRoutesBySession: db.prepare(`SELECT ar.*, u.name as assigned_to_name FROM assigned_routes ar
    INNER JOIN users u ON u.id = ar.assigned_to WHERE ar.session_id = ?`),
  deleteAssignedRoute: db.prepare('DELETE FROM assigned_routes WHERE id = ? AND session_id = ?'),

  findDogs: db.prepare('SELECT * FROM dogs WHERE user_id = ? ORDER BY created_at ASC'),
  findDogById: db.prepare('SELECT * FROM dogs WHERE id = ?'),
  insertDog: db.prepare('INSERT INTO dogs (id, user_id, name) VALUES (?, ?, ?)'),
  deleteDog: db.prepare('DELETE FROM dogs WHERE id = ? AND user_id = ?'),

  insertLogEntry: db.prepare(`INSERT INTO log_entries
    (id, user_id, session_id, search_session_id, handler_name, dog_name,
     place_lat, place_lng, place_name, search_date, search_time,
     weather_conditions, search_duration_seconds, path_length_meters,
     difficulties, path_type, handler_feelings, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  updateLogEntry: db.prepare(`UPDATE log_entries SET
    handler_name = ?, dog_name = ?, place_lat = ?, place_lng = ?, place_name = ?,
    search_date = ?, search_time = ?, weather_conditions = ?,
    search_duration_seconds = ?, path_length_meters = ?,
    difficulties = ?, path_type = ?, handler_feelings = ?, notes = ?,
    updated_at = datetime('now')
    WHERE id = ? AND user_id = ?`),
  findLogEntries: db.prepare('SELECT * FROM log_entries WHERE user_id = ? ORDER BY created_at DESC'),
  findLogEntryById: db.prepare('SELECT * FROM log_entries WHERE id = ?'),
  deleteLogEntry: db.prepare('DELETE FROM log_entries WHERE id = ? AND user_id = ?'),

  // Allowlist
  findAllowedEmail: db.prepare('SELECT * FROM allowed_emails WHERE email = ?'),
  findAllowedEmails: db.prepare(`SELECT ae.*, u.name as added_by_name
    FROM allowed_emails ae LEFT JOIN users u ON u.id = ae.added_by ORDER BY ae.created_at DESC`),
  insertAllowedEmail: db.prepare('INSERT INTO allowed_emails (id, email, added_by, can_invite) VALUES (?, ?, ?, ?)'),
  updateAllowedEmailCanInvite: db.prepare('UPDATE allowed_emails SET can_invite = ? WHERE id = ?'),
  deleteAllowedEmail: db.prepare('DELETE FROM allowed_emails WHERE id = ?'),
  countAllowedEmails: db.prepare('SELECT COUNT(*) as count FROM allowed_emails'),

  // Invite tokens
  findInviteByToken: db.prepare('SELECT * FROM invite_tokens WHERE token = ?'),
  findInviteTokens: db.prepare(`SELECT it.*, u.name as created_by_name, u2.name as used_by_name
    FROM invite_tokens it LEFT JOIN users u ON u.id = it.created_by LEFT JOIN users u2 ON u2.id = it.used_by
    ORDER BY it.created_at DESC`),
  insertInviteToken: db.prepare('INSERT INTO invite_tokens (id, token, created_by, can_invite) VALUES (?, ?, ?, ?)'),
  deleteInviteToken: db.prepare("DELETE FROM invite_tokens WHERE id = ?"),
  deleteInviteTokenById: db.prepare("DELETE FROM invite_tokens WHERE id = ? AND used_by IS NULL"),

  findOldSessions: db.prepare("SELECT id FROM sessions WHERE created_at < datetime('now', '-30 days')"),
  deleteSessionMembers: db.prepare('DELETE FROM session_members WHERE session_id = ?'),
  deleteHidingSessions: db.prepare('DELETE FROM hiding_sessions WHERE session_id = ?'),
  deleteSearchSessions: db.prepare('DELETE FROM search_sessions WHERE session_id = ?'),
  deleteAssignedRoutes: db.prepare('DELETE FROM assigned_routes WHERE session_id = ?'),
  deleteSession: db.prepare('DELETE FROM sessions WHERE id = ?'),
};

module.exports = { q, generateCode, now, uuid };
