const { Router } = require('express');
const { q, generateCode, now, uuid } = require('../db/queries');
const { authenticateToken } = require('../middleware/auth');
const { broadcastToSession, sendToUser } = require('../ws/sessions');

const router = Router();

router.use(authenticateToken);

router.get('/', (req, res) => {
  const sessions = q.findUserSessions.all(req.user.userId);
  res.json({ sessions });
});

router.post('/', (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Session name required' });
  }

  const id = uuid();
  let code = generateCode();

  while (q.findSessionByCode.get(code, 'active')) {
    code = generateCode();
  }

  q.insertSession.run(id, code, name, req.user.userId, 'active', now());
  q.insertMember.run(uuid(), id, req.user.userId, 'passive_member', 1, now());

  const session = q.findSessionById.get(id);
  res.status(201).json({ session });
});

router.get('/:id', (req, res) => {
  const session = q.findSessionById.get(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const member = q.findMember.get(session.id, req.user.userId);
  if (!member) {
    return res.status(403).json({ error: 'Not a member of this session' });
  }

  const members = q.findSessionMembers.all(session.id);
  res.json({ session, members });
});

router.post('/join', (req, res) => {
  const { code } = req.body;
  if (!code) {
    return res.status(400).json({ error: 'Join code required' });
  }

  const session = q.findSessionByCode.get(code.toUpperCase(), 'active');
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const existing = q.findMember.get(session.id, req.user.userId);
  if (existing) {
    return res.json({ session });
  }

  q.insertMember.run(uuid(), session.id, req.user.userId, 'passive_member', 0, now());

  res.json({ session });
});

router.post('/:id/role', (req, res) => {
  const { role } = req.body;
  const validRoles = ['passive_member', 'lost_person', 'dog_handler'];

  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
  }

  const session = q.findSessionById.get(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const member = q.findMember.get(session.id, req.user.userId);
  if (!member) {
    return res.status(403).json({ error: 'Not a member of this session' });
  }

  if (role === 'lost_person') {
    const existingLost = q.countMembersInRole.get(session.id, 'lost_person');
    if (existingLost.count > 0) {
      return res.status(400).json({ error: 'A lost person already exists in this session' });
    }
  }

  if (role === 'dog_handler') {
    const existingHandler = q.countMembersInRole.get(session.id, 'dog_handler');
    if (existingHandler.count > 0) {
      return res.status(400).json({ error: 'A dog handler already exists in this session' });
    }
  }

  q.updateMemberRole.run(role, session.id, req.user.userId);

  const members = q.findSessionMembers.all(session.id);
  res.json({ session, members });
});

router.post('/:id/initiate-search', (req, res) => {
  const { handlerUserId, lostUserId, routeWaypoints } = req.body;

  const session = q.findSessionById.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const member = q.findMember.get(session.id, req.user.userId);
  if (!member || member.is_master !== 1) {
    return res.status(403).json({ error: 'Only session master can initiate searches' });
  }

  if (handlerUserId === lostUserId) {
    return res.status(400).json({ error: 'Handler and lost person must be different' });
  }

  const handlerMember = q.findMember.get(session.id, handlerUserId);
  if (!handlerMember) return res.status(400).json({ error: 'Handler not found in session' });

  const lostMember = q.findMember.get(session.id, lostUserId);
  if (!lostMember) return res.status(400).json({ error: 'Lost person not found in session' });

  q.updateMemberRole.run('dog_handler', session.id, handlerUserId);
  q.updateMemberRole.run('lost_person', session.id, lostUserId);

  broadcastToSession(session.id, { type: 'role_changed', userId: handlerUserId, role: 'dog_handler' });
  broadcastToSession(session.id, { type: 'role_changed', userId: lostUserId, role: 'lost_person' });

  let route = null;
  if (routeWaypoints && Array.isArray(routeWaypoints) && routeWaypoints.length >= 2) {
    const routeId = uuid();
    q.insertAssignedRoute.run(routeId, session.id, req.user.userId, lostUserId, JSON.stringify(routeWaypoints), 0);
    route = { id: routeId, sessionId: session.id, assignedTo: lostUserId, waypoints: routeWaypoints, snapped: false };
    sendToUser(lostUserId, { type: 'route_assigned', route });
  }

  res.json({ success: true, route });
});

module.exports = router;
