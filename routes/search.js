const { Router } = require('express');
const { q, now, uuid } = require('../db/queries');
const { authenticateToken } = require('../middleware/auth');
const { broadcastToSession } = require('../ws/sessions');

const router = Router();

router.use(authenticateToken);

router.post('/:id/start-search', (req, res) => {
  const session = q.findSessionById.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const member = q.findMember.get(session.id, req.user.userId);
  if (!member) return res.status(403).json({ error: 'Not a member' });
  if (member.role !== 'dog_handler') return res.status(400).json({ error: 'You must be a dog handler to start search' });

  const existing = q.findActiveSearchByUser.get(req.user.userId, session.id);
  if (existing) return res.status(400).json({ error: 'Already have an active search' });

  const id = uuid();
  q.insertSearch.run(id, session.id, req.user.userId, now());

  const search = q.findActiveSearchByUser.get(req.user.userId, session.id);
  broadcastToSession(session.id, { type: 'search_started', userId: req.user.userId });

  res.status(201).json({ search });
});

router.post('/:id/search-result', (req, res) => {
  const { result } = req.body;
  if (!['found', 'failed'].includes(result)) {
    return res.status(400).json({ error: 'Result must be "found" or "failed"' });
  }

  const session = q.findSessionById.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const search = q.findActiveSearchByUser.get(req.user.userId, session.id);
  if (!search) return res.status(400).json({ error: 'No active search session' });

  const waypoints = req.body.waypoints || '[]';
  const wpStr = typeof waypoints === 'string' ? waypoints : JSON.stringify(waypoints);

  const endedAt = now();
  const startedAt = search.started_at;
  const durationSec = Math.round((new Date(endedAt) - new Date(startedAt)) / 1000);

  q.updateSearchEnd.run(endedAt, wpStr, result, durationSec, search.id);

  if (result === 'found') {
    q.updateSessionStatus.run('completed', session.id);
  }

  broadcastToSession(session.id, { type: 'search_ended', userId: req.user.userId, result });

  res.json({ success: true, duration_seconds: durationSec });
});

module.exports = router;
