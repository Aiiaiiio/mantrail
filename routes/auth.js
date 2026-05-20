const { Router } = require('express');
const { OAuth2Client } = require('google-auth-library');
const { db } = require('../db/index');
const { q, uuid } = require('../db/queries');
const { signToken, authenticateToken } = require('../middleware/auth');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const client = new OAuth2Client(CLIENT_ID);

const router = Router();

router.post('/google', async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) {
      return res.status(400).json({ error: 'idToken required' });
    }

    const ticket = await client.verifyIdToken({
      idToken,
      audience: CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const { sub: googleId, name, email, picture } = payload;

    let user = q.findUserByGoogleId.get(googleId);

    if (!user) {
      const id = uuid();
      q.createUser.run(id, googleId, name, email, picture);
      user = q.findUserById.get(id);
    } else {
      if (user.name !== name || user.email !== email || user.avatar_url !== picture) {
        db.prepare('UPDATE users SET name = ?, email = ?, avatar_url = ? WHERE id = ?')
          .run(name, email, picture, user.id);
        user = q.findUserById.get(user.id);
      }
    }

    const token = signToken({ userId: user.id, name: user.name });

    res.json({ token, user: { id: user.id, name: user.name, email: user.email, avatar_url: user.avatar_url } });
  } catch (err) {
    console.error('Auth error:', err);
    res.status(401).json({ error: 'Authentication failed' });
  }
});

router.get('/me', authenticateToken, (req, res) => {
  const user = q.findUserById.get(req.user.userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.json({ user: { id: user.id, name: user.name, email: user.email, avatar_url: user.avatar_url } });
});

module.exports = router;
