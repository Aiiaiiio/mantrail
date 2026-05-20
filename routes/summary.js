const { Router } = require('express');
const { db } = require('../db/index');
const { authenticateToken } = require('../middleware/auth');

const router = Router();

router.use(authenticateToken);

router.get('/:id/summary', (req, res) => {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const member = db.prepare('SELECT * FROM session_members WHERE session_id = ? AND user_id = ?').get(session.id, req.user.userId);
  if (!member) return res.status(403).json({ error: 'Not a member' });

  const hidingSessions = db.prepare(`
    SELECT hs.*, u.name as user_name FROM hiding_sessions hs
    INNER JOIN users u ON u.id = hs.user_id
    WHERE hs.session_id = ? AND hs.status = 'hidden'
  `).all(session.id);

  const searchSessions = db.prepare(`
    SELECT ss.*, u.name as user_name FROM search_sessions ss
    INNER JOIN users u ON u.id = ss.user_id
    WHERE ss.session_id = ? AND ss.result IS NOT NULL
  `).all(session.id);

  const members = db.prepare(`
    SELECT u.id, u.name, u.email, u.avatar_url, sm.role
    FROM session_members sm INNER JOIN users u ON u.id = sm.user_id
    WHERE sm.session_id = ?
  `).all(session.id);

  const routes = db.prepare(`
    SELECT ar.*, u.name as assigned_to_name FROM assigned_routes ar
    INNER JOIN users u ON u.id = ar.assigned_to
    WHERE ar.session_id = ?
  `).all(session.id);

  res.json({ session, members, hidingSessions, searchSessions, routes });
});

module.exports = router;
