const { Router } = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db } = require('../db/index');
const { q, uuid } = require('../db/queries');
const { signToken, authenticateToken } = require('../middleware/auth');

const router = Router();
const AVATAR_DIR = path.resolve(__dirname, '..', 'data', 'avatars');
if (!fs.existsSync(AVATAR_DIR)) fs.mkdirSync(AVATAR_DIR, { recursive: true });

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
  const count = q.countAllowedEmails.get().count;
  let canInviteVal = 0;
  if (count === 0) {
    canInviteVal = 1; // bootstrap: allowlist empty, first user can manage
  } else if (user.email) {
    const entry = q.findAllowedEmail.get(user.email);
    if (entry) canInviteVal = entry.can_invite;
  }
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatar_url: user.avatar_url,
    display_name: user.display_name || user.name,
    can_invite: canInviteVal,
  };
}

function generateInviteToken() {
  return 'inv-' + crypto.randomBytes(24).toString('hex');
}

router.post('/google', async (req, res) => {
  try {
    const { accessToken, inviteToken } = req.body;
    if (!accessToken) {
      return res.status(400).json({ error: 'accessToken required' });
    }

    const userInfo = await fetchGoogleUserInfo(accessToken);
    if (!userInfo || !userInfo.sub) {
      return res.status(401).json({ error: 'Invalid access token' });
    }

    const { sub: googleId, name, email, picture: googlePicture } = userInfo;

    // Check allowlist
    const allowed = q.findAllowedEmail.get(email);
    const emailCount = q.countAllowedEmails.get().count;

    if (!allowed) {
      if (emailCount > 0) {
        // Allowlist exists, email is not on it — check invite token
        if (inviteToken) {
          const tokenRec = q.findInviteByToken.get(inviteToken);
          if (!tokenRec || tokenRec.used_by) {
            return res.status(403).json({ error: 'Invalid or already used invite link' });
          }
        } else {
          return res.status(403).json({ error: 'Access restricted. You need an invite to use this app.' });
        }
      }
      // First user or invited: will be added below after user creation
    }

    let user = q.findUserByGoogleId.get(googleId);
    const isNew = !user;
    if (isNew) {
      const id = uuid();
      q.createUser.run(id, googleId, name, email, '');
      user = q.findUserById.get(id);
      db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(name, id);
    }

    let avatarUrl = user.avatar_url || '';
    const avatarOnDisk = user.avatar_url
      ? fs.existsSync(path.join(AVATAR_DIR, path.basename(user.avatar_url)))
      : false;
    if (googlePicture && (!user.avatar_url || !avatarOnDisk)) {
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

      // Add to allowlist if first user or invited
    if (!allowed && (emailCount === 0 || inviteToken)) {
      const isFirst = emailCount === 0;
      // First user gets invite rights; invited users get the token's setting
      const inviteCanInvite = isFirst ? 1 : (inviteToken ? (q.findInviteByToken.get(inviteToken)?.can_invite || 0) : 0);
      q.insertAllowedEmail.run(uuid(), email, user.id, inviteCanInvite);
      // Delete invite token after use and notify admins
      if (inviteToken) {
        const tokenRec = q.findInviteByToken.get(inviteToken);
        if (tokenRec && !tokenRec.used_by) {
          const createdBy = tokenRec.created_by;
          q.deleteInviteToken.run(tokenRec.id);
          // Notify all admins that an invite link was used
          const admins = q.findAdminUserIds.all();
          for (const admin of admins) {
            q.insertNotification.run(
              uuid(), admin.id,
              'Invite Used',
              `${name} (${email}) joined via invite link`,
              'invite_used',
              '/access-management'
            );
          }
        }
      }
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

router.get('/users', authenticateToken, (req, res) => {
  if (!canInvite(req.user.userId)) return res.status(403).json({ error: 'Not authorized' });
  const users = q.findAllUsers.all();
  res.json({ users });
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

function canInvite(userId) {
  const user = q.findUserById.get(userId);
  if (!user) return false;
  const count = q.countAllowedEmails.get().count;
  if (count === 0) return true; // bootstrap: allowlist empty, first user can manage
  const entry = q.findAllowedEmail.get(user.email);
  return entry && entry.can_invite === 1;
}

// Allowlist management (auth required + can_invite)
router.use('/allowlist', authenticateToken);
router.use('/invite', authenticateToken);

router.get('/allowlist', (req, res) => {
  if (!canInvite(req.user.userId)) return res.status(403).json({ error: 'Not authorized' });
  const list = q.findAllowedEmails.all();
  res.json({ entries: list });
});

router.post('/allowlist', (req, res) => {
  if (!canInvite(req.user.userId)) return res.status(403).json({ error: 'Not authorized' });
  const { email, can_invite } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  const existing = q.findAllowedEmail.get(email);
  if (existing) return res.status(400).json({ error: 'Email already in allowlist' });
  q.insertAllowedEmail.run(uuid(), email, req.user.userId, can_invite ? 1 : 0);
  res.json({ entry: q.findAllowedEmail.get(email) });
});

router.patch('/allowlist/:id', (req, res) => {
  if (!canInvite(req.user.userId)) return res.status(403).json({ error: 'Not authorized' });
  const { can_invite } = req.body;
  if (can_invite === undefined) return res.status(400).json({ error: 'can_invite required' });
  q.updateAllowedEmailCanInvite.run(can_invite ? 1 : 0, req.params.id);
  res.json({ entry: q.findAllowedEmail.get(req.params.id) });
});

router.delete('/allowlist/:id', (req, res) => {
  if (!canInvite(req.user.userId)) return res.status(403).json({ error: 'Not authorized' });
  q.deleteAllowedEmail.run(req.params.id);
  res.json({ success: true });
});

router.get('/invite/tokens', (req, res) => {
  if (!canInvite(req.user.userId)) return res.status(403).json({ error: 'Not authorized' });
  const tokens = q.findInviteTokens.all();
  res.json({ tokens });
});

router.post('/invite/generate', (req, res) => {
  if (!canInvite(req.user.userId)) return res.status(403).json({ error: 'Not authorized' });
  const { can_invite } = req.body;
  const id = uuid();
  const token = generateInviteToken();
  q.insertInviteToken.run(id, token, req.user.userId, can_invite ? 1 : 0);
  const record = db.prepare('SELECT * FROM invite_tokens WHERE id = ?').get(id);
  res.json({ token: record });
});

router.delete('/invite/tokens/:id', (req, res) => {
  if (!canInvite(req.user.userId)) return res.status(403).json({ error: 'Not authorized' });
  q.deleteInviteTokenById.run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
module.exports.canInvite = canInvite;
