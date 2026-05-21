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

function userToJSON(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatar_url: user.avatar_url,
    display_name: user.display_name || user.name,
  };
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
      db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(name, id);
    }

    let avatarUrl = user.avatar_url || '';
    if (googlePicture && !user.avatar_url) {
      const ext = googlePicture.includes('.png') ? '.png' : '.jpg';
      const localPath = path.join(AVATAR_DIR, `${user.id}${ext}`);
      const ok = await downloadAvatar(googlePicture, localPath);
      if (ok) {
        avatarUrl = `/static/avatars/${user.id}${ext}`;
      }
    }

    db.prepare('UPDATE users SET name = ?, email = ?, avatar_url = ? WHERE id = ?')
      .run(name, email, avatarUrl, user.id);

    if (!user.display_name) {
      db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(name, user.id);
    }

    user = q.findUserById.get(user.id);
    const json = userToJSON(user);
    const token = signToken({ userId: user.id, name: json.display_name, avatar_url: user.avatar_url });
    res.json({ token, user: json });
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
  res.json({ user: userToJSON(user) });
});

router.put('/profile', authenticateToken, (req, res) => {
  const { display_name } = req.body;
  if (!display_name || !display_name.trim()) {
    return res.status(400).json({ error: 'display_name required' });
  }
  db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(display_name.trim(), req.user.userId);
  const user = q.findUserById.get(req.user.userId);
  const json = userToJSON(user);
  const token = signToken({ userId: user.id, name: json.display_name, avatar_url: user.avatar_url });
  res.json({ token, user: json });
});

module.exports = router;
