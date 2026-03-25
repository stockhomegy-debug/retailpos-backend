const router = require('express').Router();
const { pool } = require('../db');
const { authenticate, requireManager } = require('../middleware/auth');

// GET /api/products
router.get('/', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM products WHERE active = true ORDER BY name'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// GET /api/products/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Product not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

// POST /api/products  (manager only)
router.post('/', authenticate, requireManager, async (req, res) => {
  const { code, name, category, price, cost, stock, low_stock_alert, photo_url } = req.body;
  if (!code || !name || price == null) {
    return res.status(400).json({ error: 'code, name and price are required' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO products (code, name, category, price, cost, stock, low_stock_alert, photo_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [code, name, category || 'General', price, cost || 0, stock || 0, low_stock_alert || 5, photo_url || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Product code already exists' });
    res.status(500).json({ error: 'Failed to create product' });
  }
});

// PUT /api/products/:id  (manager only)
router.put('/:id', authenticate, requireManager, async (req, res) => {
  const { code, name, category, price, cost, stock, low_stock_alert, photo_url } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE products SET code=$1, name=$2, category=$3, price=$4, cost=$5,
       stock=$6, low_stock_alert=$7, photo_url=$8, updated_at=NOW()
       WHERE id=$9 RETURNING *`,
      [code, name, category, price, cost, stock, low_stock_alert, photo_url, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Product not found' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Product code already exists' });
    res.status(500).json({ error: 'Failed to update product' });
  }
});

// PATCH /api/products/:id/stock  (cashier and manager)
router.patch('/:id/stock', authenticate, async (req, res) => {
  const { stock } = req.body;
  if (stock == null) return res.status(400).json({ error: 'stock value required' });
  try {
    const { rows } = await pool.query(
      'UPDATE products SET stock=$1, updated_at=NOW() WHERE id=$2 RETURNING *',
      [stock, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Product not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update stock' });
  }
});

// DELETE /api/products/:id  (manager only — soft delete)
router.delete('/:id', authenticate, requireManager, async (req, res) => {
  try {
    await pool.query('UPDATE products SET active=false WHERE id=$1', [req.params.id]);
    res.json({ message: 'Product deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

// POST /api/products/import  (manager only — bulk import)
router.post('/import', authenticate, requireManager, async (req, res) => {
  const { products } = req.body;
  if (!Array.isArray(products) || !products.length) {
    return res.status(400).json({ error: 'products array required' });
  }
  const results = { added: 0, updated: 0, errors: [] };
  for (const p of products) {
    if (!p.code || !p.name || p.price == null) {
      results.errors.push(`Skipped row — missing code, name or price: ${JSON.stringify(p)}`);
      continue;
    }
    try {
      const existing = await pool.query('SELECT id FROM products WHERE code=$1', [p.code]);
      if (existing.rows.length) {
        await pool.query(
          `UPDATE products SET name=$1,category=$2,price=$3,cost=$4,stock=$5,
           low_stock_alert=$6,photo_url=$7,active=true,updated_at=NOW() WHERE code=$8`,
          [p.name, p.category||'General', p.price, p.cost||0, p.stock||0, p.low_stock_alert||5, p.photo_url||null, p.code]
        );
        results.updated++;
      } else {
        await pool.query(
          `INSERT INTO products (code,name,category,price,cost,stock,low_stock_alert,photo_url)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [p.code, p.name, p.category||'General', p.price, p.cost||0, p.stock||0, p.low_stock_alert||5, p.photo_url||null]
        );
        results.added++;
      }
    } catch (err) {
      results.errors.push(`Error on ${p.code}: ${err.message}`);
    }
  }
  res.json(results);
});

module.exports = router;
