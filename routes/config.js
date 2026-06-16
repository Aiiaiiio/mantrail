const { Router } = require('express');
const { execSync } = require('child_process');
const path = require('path');
const pkg = require('../package.json');

const repoDir = path.resolve(__dirname, '..');

let commitHash = process.env.COMMIT_HASH || '';
let branch = process.env.BRANCH || '';

if (!commitHash || !branch) {
  try {
    if (!commitHash) commitHash = execSync('git rev-parse --short HEAD', { cwd: repoDir, encoding: 'utf8', timeout: 3000 }).trim();
    if (!branch) branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: repoDir, encoding: 'utf8', timeout: 3000 }).trim();
  } catch (e) {
    // not a git repo or git unavailable
  }
}

const router = Router();

router.get('/', (req, res) => {
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    version: pkg.version || '',
    commitHash,
    branch,
  });
});

module.exports = router;
