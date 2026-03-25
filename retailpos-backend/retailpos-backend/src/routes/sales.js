const router = require('express').Router();
const { pool } = require('../db');
const { authenticate, requireManager } = require('../middleware/auth');

// GET /api/sales
router.get('/', authenticate, async (req, res) => {
  try {
    const { rows: sales } = await pool.query(
      `SELECT s.*, u.name as cashier_name FROM sales s
       LEFT JOIN users u ON s.user_id = u.id
       ORDER BY s.created_at DESC LIMIT 200`
    );
    const saleIds = sales.map(s => s.id);
    let items = [];
    if (saleIds.length) {
      const { rows } = await pool.query(
        `SELECT * FROM sale_items WHERE sale_id = ANY($1)`, [saleIds]
      );
      items = rows;
    }
    const result = sales.map(sale => ({
      ...sale,
      items: items.filter(i => i.sale_id === sale.id)
    }));
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch sales' });
  }
});

// POST /api/sales  — process a checkout
router.post('/', authenticate, async (req, res) => {
  const { items, discount_pct, tax_pct } = req.body;
  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: 'items array required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verify stock and get prices
    let subtotal = 0;
    const enriched = [];
    for (const item of items) {
      const { rows } = await client.query(
        'SELECT * FROM products WHERE id = $1 FOR UPDATE', [item.product_id]
      );
      if (!rows.length) throw new Error(`Product ${item.product_id} not found`);
      const prod = rows[0];
      if (prod.stock < item.quantity) throw new Error(`Insufficient stock for ${prod.name}`);
      const line_total = parseFloat(prod.price) * item.quantity;
      subtotal += line_total;
      enriched.push({ ...item, product_name: prod.name, product_code: prod.code, price: prod.price, line_total });
      await client.query('UPDATE products SET stock = stock - $1, updated_at=NOW() WHERE id = $2', [item.quantity, prod.id]);
    }

    const disc = parseFloat(discount_pct) || 0;
    const taxRate = parseFloat(tax_pct) || 15;
    const discount_amount = subtotal * (disc / 100);
    const after_discount = subtotal - discount_amount;
    const tax_amount = after_discount * (taxRate / 100);
    const total = after_discount + tax_amount;
    const transaction_id = 'TXN-' + Date.now().toString(36).toUpperCase();

    const { rows: [sale] } = await client.query(
      `INSERT INTO sales (transaction_id, user_id, subtotal, discount_pct, discount_amount, tax_pct, tax_amount, total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [transaction_id, req.user.id, subtotal, disc, discount_amount, taxRate, tax_amount, total]
    );

    for (const item of enriched) {
      await client.query(
        `INSERT INTO sale_items (sale_id, product_id, product_name, product_code, price, quantity, line_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [sale.id, item.product_id, item.product_name, item.product_code, item.price, item.quantity, item.line_total]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ ...sale, items: enriched });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// DELETE /api/sales  (manager only — clear all)
router.delete('/', authenticate, requireManager, async (req, res) => {
  try {
    await pool.query('DELETE FROM sales');
    res.json({ message: 'Sales history cleared' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear sales' });
  }
});

module.exports = router;
