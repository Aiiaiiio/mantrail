const { Router } = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { db } = require('../db/index');
const { q, uuid } = require('../db/queries');
const { signToken, authenticateToken } = require('../middleware/auth');

const router = Router();
const AVATAR_DIR = path.resolve(__dirname, '..', 'static', 'avatars');

function fetchGoogleUserInfo(accessToken) {
  return new Promise((resolve, reject) => {
    const req = https.get('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(e); }
        } else {
          resolve(null);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function downloadAvatar(url, filePath) {
  return new Promise((resolve) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        resolve(false);
        return;
      }
      const file = fs.createWriteStream(filePath);
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve(true);
      });
      file.on('error', () => {
        fs.unlink(filePath, () => {});
        resolve(false);
      });
    }).on('error', () => resolve(false));
  });
}

router.post('/google', async (req, res) => {
  try {
    const { accessToken } = req.body;
    if (!accessToken) {
      return res.status(400).json({ error: 'accessToken required' });
    }

    const userInfo = await fetchGoogleUserInfo(accessToken);
    if (!userInfo || !userInfo.sub) {
      return res.status(401).json({ error: 'Invalid access token' });
    }

    const { sub: googleId, name, email, picture: googlePicture } = userInfo;

    let user = q.findUserByGoogleId.get(googleId);
    const isNew = !user;
    if (isNew) {
      const id = uuid();
      q.createUser.run(id, googleId, name, email, '');
      user = q.findUserById.get(id);
    }

    let avatarUrl = '';
    if (googlePicture) {
      const ext = googlePicture.includes('.png') ? '.png' : '.jpg';
      const localPath = path.join(AVATAR_DIR, `${user.id}${ext}`);
      const ok = await downloadAvatar(googlePicture, localPath);
      if (ok) {
        avatarUrl = `/static/avatars/${user.id}${ext}`;
      }
    }

    db.prepare('UPDATE users SET name = ?, email = ?, avatar_url = ? WHERE id = ?')
      .run(name, email, avatarUrl, user.id);
    user = q.findUserById.get(user.id);

    const token = signToken({ userId: user.id, name: user.name, avatar_url: user.avatar_url });
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
