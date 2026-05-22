const { Router } = require('express');
const pkg = require('../package.json');

const router = Router();

router.get('/', (req, res) => {
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    version: pkg.version || '',
  });
});

module.exports = router;
