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

  insertMember: db.prepare('INSERT OR IGNORE INTO session_members (id, session_id, user_id, role, joined_at) VALUES (?, ?, ?, ?, ?)'),
  findMember: db.prepare('SELECT * FROM session_members WHERE session_id = ? AND user_id = ?'),
  findSessionMembers: db.prepare(`SELECT u.id, u.name, u.email, u.avatar_url, sm.role, sm.joined_at
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
  findActiveSearchByUser: db.prepare('SELECT * FROM search_sessions WHERE user_id = ? AND session_id = ? AND result IS NULL'),
  findActiveSearchBySession: db.prepare('SELECT * FROM search_sessions WHERE session_id = ? AND result IS NULL'),
  updateSearchEnd: db.prepare('UPDATE search_sessions SET ended_at = ?, waypoints = ?, result = ?, duration_seconds = ? WHERE id = ?'),
  updateSearchWaypoints: db.prepare('UPDATE search_sessions SET waypoints = ? WHERE id = ?'),

  insertAssignedRoute: db.prepare('INSERT INTO assigned_routes (id, session_id, assigned_by, assigned_to, waypoints, snapped) VALUES (?, ?, ?, ?, ?, ?)'),
  findRoutesForUser: db.prepare('SELECT * FROM assigned_routes WHERE session_id = ? AND assigned_to = ?'),
  findRoutesBySession: db.prepare(`SELECT ar.*, u.name as assigned_to_name FROM assigned_routes ar
    INNER JOIN users u ON u.id = ar.assigned_to WHERE ar.session_id = ?`),
  deleteAssignedRoute: db.prepare('DELETE FROM assigned_routes WHERE id = ? AND session_id = ?'),
};

module.exports = { q, generateCode, now, uuid };
