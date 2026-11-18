const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'bookings.db');
const db = new Database(dbPath);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
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

module.exports = db;
