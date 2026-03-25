const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');

// POST /api/auth/login  { pin }
router.post('/login', async (req, res) => {
  const { pin } = req.body;
  if (!pin) return res.status(400).json({ error: 'PIN required' });

  try {
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE active = true ORDER BY id'
    );
    let matched = null;
    for (const user of rows) {
      const ok = await bcrypt.compare(String(pin), user.pin);
      if (ok) { matched = user; break; }
    }
    if (!matched) return res.status(401).json({ error: 'Invalid PIN' });

    const token = jwt.sign(
      { id: matched.id, name: matched.name, role: matched.role },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );
    res.json({ token, user: { id: matched.id, name: matched.name, role: matched.role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

module.exports = router;
