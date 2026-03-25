const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { authenticate, requireManager } = require('../middleware/auth');

// GET /api/users  (manager only)
router.get('/', authenticate, requireManager, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, role, active, created_at FROM users ORDER BY id'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// POST /api/users  (manager only)
router.post('/', authenticate, requireManager, async (req, res) => {
  const { name, pin, role } = req.body;
  if (!name || !pin) return res.status(400).json({ error: 'name and pin required' });
  if (String(pin).length < 4) return res.status(400).json({ error: 'PIN must be at least 4 digits' });
  try {
    const hashed = await bcrypt.hash(String(pin), 10);
    const { rows } = await pool.query(
      `INSERT INTO users (name, pin, role) VALUES ($1,$2,$3) RETURNING id, name, role, active, created_at`,
      [name, hashed, role || 'cashier']
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// PUT /api/users/:id  (manager only)
router.put('/:id', authenticate, requireManager, async (req, res) => {
  const { name, pin, role, active } = req.body;
  try {
    let query, params;
    if (pin) {
      const hashed = await bcrypt.hash(String(pin), 10);
      query = 'UPDATE users SET name=$1, pin=$2, role=$3, active=$4 WHERE id=$5 RETURNING id,name,role,active,created_at';
      params = [name, hashed, role, active !== undefined ? active : true, req.params.id];
    } else {
      query = 'UPDATE users SET name=$1, role=$2, active=$3 WHERE id=$4 RETURNING id,name,role,active,created_at';
      params = [name, role, active !== undefined ? active : true, req.params.id];
    }
    const { rows } = await pool.query(query, params);
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// DELETE /api/users/:id  (manager only)
router.delete('/:id', authenticate, requireManager, async (req, res) => {
  if (parseInt(req.params.id) === req.user.id) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }
  try {
    await pool.query('UPDATE users SET active=false WHERE id=$1', [req.params.id]);
    res.json({ message: 'User deactivated' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

module.exports = router;
