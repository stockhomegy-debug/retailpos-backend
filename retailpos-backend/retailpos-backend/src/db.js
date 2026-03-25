const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway')
    ? { rejectUnauthorized: false }
    : false
});

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        pin VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'cashier',
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS settings (
        id SERIAL PRIMARY KEY,
        key VARCHAR(100) UNIQUE NOT NULL,
        value TEXT
      );

      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        code VARCHAR(100) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        category VARCHAR(100) DEFAULT 'General',
        price DECIMAL(10,2) NOT NULL,
        cost DECIMAL(10,2) DEFAULT 0,
        stock INTEGER DEFAULT 0,
        low_stock_alert INTEGER DEFAULT 5,
        photo_url TEXT,
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sales (
        id SERIAL PRIMARY KEY,
        transaction_id VARCHAR(50) UNIQUE NOT NULL,
        user_id INTEGER REFERENCES users(id),
        subtotal DECIMAL(10,2) NOT NULL,
        discount_pct DECIMAL(5,2) DEFAULT 0,
        discount_amount DECIMAL(10,2) DEFAULT 0,
        tax_pct DECIMAL(5,2) DEFAULT 15,
        tax_amount DECIMAL(10,2) DEFAULT 0,
        total DECIMAL(10,2) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sale_items (
        id SERIAL PRIMARY KEY,
        sale_id INTEGER REFERENCES sales(id) ON DELETE CASCADE,
        product_id INTEGER REFERENCES products(id),
        product_name VARCHAR(255) NOT NULL,
        product_code VARCHAR(100) NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        quantity INTEGER NOT NULL,
        line_total DECIMAL(10,2) NOT NULL
      );
    `);

    // Seed default settings
    const defaultSettings = [
      ['store_name', 'My Store'],
      ['tax_rate', '15'],
      ['currency_symbol', '$'],
      ['receipt_footer', 'Thank you for your purchase!'],
      ['low_stock_default', '5']
    ];
    for (const [key, value] of defaultSettings) {
      await client.query(
        `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
        [key, value]
      );
    }

    // Seed default manager if no users exist
    const { rowCount } = await client.query('SELECT id FROM users LIMIT 1');
    if (rowCount === 0) {
      const hashed = await bcrypt.hash('1234', 10);
      await client.query(
        `INSERT INTO users (name, pin, role) VALUES ($1, $2, $3)`,
        ['Manager', hashed, 'manager']
      );
      console.log('Default manager created — PIN: 1234 (change this in Settings)');
    }

    console.log('Database initialized successfully');
  } finally {
    client.release();
  }
}

module.exports = { pool, initDB };
