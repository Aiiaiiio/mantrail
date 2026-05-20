const { Router } = require('express');

const router = Router();

router.get('/', (req, res) => {
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  });
});

module.exports = router;
