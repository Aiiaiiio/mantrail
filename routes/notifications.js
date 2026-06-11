const { Router } = require('express');
const { q, uuid } = require('../db/queries');
const { authenticateToken } = require('../middleware/auth');
const { canInvite } = require('./auth');

const router = Router();

router.use(authenticateToken);

router.get('/', (req, res) => {
  const notifications = q.findNotifications.all(req.user.userId);
  res.json({ notifications });
});

router.get('/unread-count', (req, res) => {
  const { count } = q.countUnreadNotifications.get(req.user.userId);
  res.json({ count });
});

router.put('/:id/read', (req, res) => {
  q.markNotificationRead.run(req.params.id, req.user.userId);
  res.json({ success: true });
});

router.put('/read-all', (req, res) => {
  q.markAllNotificationsRead.run(req.user.userId);
  res.json({ success: true });
});

router.post('/broadcast', (req, res) => {
  if (!canInvite(req.user.userId)) return res.status(403).json({ error: 'Not authorized' });
  const { title, body } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'title and body required' });
  const users = q.findAllUserIds.all();
  for (const u of users) {
    q.insertNotification.run(uuid(), u.id, title, body, 'broadcast', null);
  }
  res.json({ success: true, count: users.length });
});

module.exports = router;
