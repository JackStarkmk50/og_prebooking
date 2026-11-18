const { createClient } = require('@libsql/client');
const path = require('path');

// Connect to Turso Cloud if URL provided, otherwise local SQLite file
const url = process.env.TURSO_DATABASE_URL || `file:${path.join(__dirname, 'bookings.db')}`;
const authToken = process.env.TURSO_AUTH_TOKEN;

const client = createClient({
  url,
  authToken,
});

// Initialize database schema
async function initDb() {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id TEXT UNIQUE,
      ps_id INTEGER,
      ps_name TEXT,
      date TEXT,
      slots TEXT,
      customer_name TEXT,
      customer_mobile TEXT,
      confirmed INTEGER DEFAULT 0,
      total_price INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

// Auto-run schema initialization
initDb().catch(err => {
  console.error('Failed to initialize database tables:', err);
});

module.exports = {
  client,
  initDb,
  // Helper wrappers
  async all(sql, args = []) {
    const res = await client.execute({ sql, args });
    return res.rows;
  },
  async get(sql, args = []) {
    const res = await client.execute({ sql, args });
    return res.rows[0] || null;
  },
  async run(sql, args = []) {
    return await client.execute({ sql, args });
  }
};
