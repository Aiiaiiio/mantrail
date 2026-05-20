const { Router } = require('express');
const { q, uuid } = require('../db/queries');
const { authenticateToken } = require('../middleware/auth');
const { sendToUser } = require('../ws/sessions');

const router = Router();

router.use(authenticateToken);

router.get('/:id/routes', (req, res) => {
  const session = q.findSessionById.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const member = q.findMember.get(session.id, req.user.userId);
  if (!member) return res.status(403).json({ error: 'Not a member' });

  const routes = q.findRoutesForUser.all(session.id, req.user.userId);
  res.json({ routes });
});

router.post('/:id/routes', (req, res) => {
  const { assignedTo, waypoints, snapped } = req.body;

  const session = q.findSessionById.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const member = q.findMember.get(session.id, req.user.userId);
  if (!member || member.role !== 'session_master') {
    return res.status(403).json({ error: 'Only session master can assign routes' });
  }

  if (!assignedTo || !waypoints || !Array.isArray(waypoints) || waypoints.length < 2) {
    return res.status(400).json({ error: 'assignedTo and waypoints (array, min 2) required' });
  }

  const targetMember = q.findMember.get(session.id, assignedTo);
  if (!targetMember) return res.status(400).json({ error: 'Target user is not a session member' });

  const id = uuid();
  q.insertAssignedRoute.run(id, session.id, req.user.userId, assignedTo, JSON.stringify(waypoints), snapped ? 1 : 0);

  const route = { id, sessionId: session.id, assignedTo, waypoints, snapped };
  sendToUser(assignedTo, { type: 'route_assigned', route });

  res.status(201).json({ route });
});

router.delete('/:id/routes/:routeId', (req, res) => {
  const session = q.findSessionById.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const member = q.findMember.get(session.id, req.user.userId);
  if (!member || member.role !== 'session_master') {
    return res.status(403).json({ error: 'Only session master can delete routes' });
  }

  q.deleteAssignedRoute.run(req.params.routeId, session.id);

  res.json({ success: true });
});

module.exports = router;
