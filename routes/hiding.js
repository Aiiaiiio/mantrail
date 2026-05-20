const { Router } = require('express');
const { q, now, uuid } = require('../db/queries');
const { authenticateToken } = require('../middleware/auth');
const { broadcastToSession } = require('../ws/sessions');

const router = Router();

router.use(authenticateToken);

router.post('/:id/start-hiding', (req, res) => {
  const session = q.findSessionById.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const member = q.findMember.get(session.id, req.user.userId);
  if (!member) return res.status(403).json({ error: 'Not a member' });
  if (member.role !== 'lost_person') return res.status(400).json({ error: 'You must be a lost person to start hiding' });

  const existing = q.findActiveHidingByUser.get(req.user.userId, session.id, 'hiding');
  if (existing) return res.status(400).json({ error: 'Already have an active hiding session' });

  const id = uuid();
  q.insertHiding.run(id, session.id, req.user.userId, now(), 'hiding');

  const hiding = q.findActiveHidingByUser.get(req.user.userId, session.id, 'hiding');
  broadcastToSession(session.id, { type: 'hiding_started', userId: req.user.userId });

  res.status(201).json({ hiding });
});

router.post('/:id/im-hidden', (req, res) => {
  const session = q.findSessionById.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const hiding = q.findActiveHidingByUser.get(req.user.userId, session.id, 'hiding');
  if (!hiding) return res.status(400).json({ error: 'No active hiding session' });

  const waypoints = req.body.waypoints || '[]';
  const wpStr = typeof waypoints === 'string' ? waypoints : JSON.stringify(waypoints);

  q.updateHidingEnd.run(now(), wpStr, 'hidden', hiding.id);

  broadcastToSession(session.id, { type: 'hiding_ended', userId: req.user.userId });

  res.json({ success: true });
});

module.exports = router;
