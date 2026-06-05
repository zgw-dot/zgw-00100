const express = require('express');
const router = express.Router();
const { get, all, logAction } = require('../database');
const { authenticate } = require('../middleware/auth');

router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

router.get('/', authenticate, async (req, res) => {
  const users = await all('SELECT id, username, name, role, created_at FROM users ORDER BY id');
  res.json({ users });
});

module.exports = router;
