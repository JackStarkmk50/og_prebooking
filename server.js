const express = require('express');
const path = require('path');
const crypto = require('crypto');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'offgrid2026';
const MIN_BOOKING_DATE = '2026-11-19';

// Active admin sessions in-memory: token -> timestamp
const adminSessions = new Map();

function createAdminSession() {
  const token = crypto.randomBytes(24).toString('hex');
  adminSessions.set(token, Date.now());
  return token;
}

function verifyAdmin(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!token || !adminSessions.has(token)) {
    return res.status(401).json({ error: 'Unauthorized. Please log in as admin.' });
  }

  // Session expiry check (8 hours)
  const lastActive = adminSessions.get(token);
  if (Date.now() - lastActive > 8 * 60 * 60 * 1000) {
    adminSessions.delete(token);
    return res.status(401).json({ error: 'Session expired. Please log in again.' });
  }

  adminSessions.set(token, Date.now());
  next();
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// PS Station definitions
const PS_STATIONS = {
  1: { id: 1, name: 'PS5 Hardcore 1', type: 'hardcore' },
  2: { id: 2, name: 'PS5 Hardcore 2', type: 'hardcore' },
  3: { id: 3, name: 'PS5 Hardcore 3', type: 'hardcore' },
  4: { id: 4, name: 'PS5 Lounge',     type: 'lounge'   },
};

// Price calculation
function calculatePrice(psId, hours) {
  const type = PS_STATIONS[psId]?.type;
  if (!type) return 0;

  if (type === 'hardcore') {
    if (hours <= 0) return 0;
    if (hours === 1) return 300;
    if (hours === 2) return 600;
    if (hours === 3) return 900;
    if (hours === 4) return 1000;
    if (hours === 8) return 2000;
    return 250 * hours;
  }

  if (type === 'lounge') {
    if (hours <= 0) return 0;
    if (hours === 1) return 500;
    if (hours === 2) return 1000;
    if (hours === 3) return 1500;
    if (hours === 4) return 1500;
    if (hours === 8) return 2800;
    return 350 * hours;
  }

  return 0;
}

// Generate unique booking ID: GTA-XXXX
function generateBookingId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = 'GTA-';
  for (let i = 0; i < 4; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

// ─── ADMIN ROUTES (Web Pages) ─────────────────────────────────────────────────
app.get(['/admin', '/admin/bookings', '/admin/bookings/'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ─── GET /api/stations ────────────────────────────────────────────────────────
app.get('/api/stations', (req, res) => {
  res.json({ stations: Object.values(PS_STATIONS) });
});

// ─── GET /api/slots ───────────────────────────────────────────────────────────
app.get('/api/slots', async (req, res) => {
  const { ps_id, date } = req.query;

  if (!ps_id || !date) {
    return res.status(400).json({ error: 'ps_id and date are required' });
  }

  try {
    // Gather all bookings for this PS + date
    const rows = await db.all(
      'SELECT slots FROM bookings WHERE ps_id = ? AND date = ?',
      [Number(ps_id), date]
    );

    const bookedHours = new Set();
    for (const row of rows) {
      try {
        const slotArr = JSON.parse(row.slots);
        slotArr.forEach(h => bookedHours.add(h));
      } catch (e) {}
    }

    const slots = [];
    for (let hour = 0; hour < 24; hour++) {
      slots.push({ hour, booked: bookedHours.has(hour) });
    }

    res.json({ slots, min_date: MIN_BOOKING_DATE });
  } catch (err) {
    console.error('Error fetching slots:', err);
    res.status(500).json({ error: 'Failed to retrieve slot availability' });
  }
});

// ─── POST /api/book ───────────────────────────────────────────────────────────
app.post('/api/book', async (req, res) => {
  const { ps_id, date, slots, customer_name, customer_mobile, confirmed } = req.body;

  // Validations
  if (!ps_id || !date || !slots || !customer_name || !customer_mobile) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  if (!PS_STATIONS[ps_id]) {
    return res.status(400).json({ error: 'Invalid PlayStation station' });
  }
  if (!Array.isArray(slots) || slots.length === 0) {
    return res.status(400).json({ error: 'At least one slot must be selected' });
  }

  // Date restriction: 19/11/2026 onwards
  if (date < MIN_BOOKING_DATE) {
    return res.status(400).json({ error: 'Bookings are only open from 19/11/2026 onwards.' });
  }

  // Check contiguous time slots (no jumping like 10am, 12pm, 6pm)
  const sortedSlots = [...slots].map(Number).sort((a, b) => a - b);
  for (let i = 1; i < sortedSlots.length; i++) {
    if (sortedSlots[i] !== sortedSlots[i - 1] + 1) {
      return res.status(400).json({
        error: 'Booking slots must be continuous and uninterrupted (e.g. 10:00 AM to 02:00 PM).'
      });
    }
  }

  if (!/^\d{10}$/.test(customer_mobile.trim())) {
    return res.status(400).json({ error: 'Mobile number must be exactly 10 digits' });
  }
  if (!confirmed) {
    return res.status(400).json({ error: 'Attendance confirmation is required' });
  }

  try {
    // Check for conflicts
    const existingRows = await db.all(
      'SELECT slots FROM bookings WHERE ps_id = ? AND date = ?',
      [Number(ps_id), date]
    );

    const bookedHours = new Set();
    for (const row of existingRows) {
      try {
        JSON.parse(row.slots).forEach(h => bookedHours.add(h));
      } catch (e) {}
    }

    const conflict = sortedSlots.some(h => bookedHours.has(h));
    if (conflict) {
      return res.status(409).json({ error: 'One or more of the selected time slots are already booked.' });
    }

    // Calculate price
    const totalPrice = calculatePrice(ps_id, sortedSlots.length);

    // Generate unique booking ID
    let booking_id;
    let attempts = 0;
    do {
      booking_id = generateBookingId();
      const existing = await db.get('SELECT 1 FROM bookings WHERE booking_id = ?', [booking_id]);
      if (!existing) break;
      attempts++;
    } while (attempts < 20);

    // Insert into DB
    await db.run(
      `INSERT INTO bookings (booking_id, ps_id, ps_name, date, slots, customer_name, customer_mobile, confirmed, total_price)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        booking_id,
        Number(ps_id),
        PS_STATIONS[ps_id].name,
        date,
        JSON.stringify(sortedSlots),
        customer_name.trim(),
        customer_mobile.trim(),
        confirmed ? 1 : 0,
        totalPrice
      ]
    );

    res.json({
      success: true,
      booking_id,
      total_price: totalPrice,
      date,
      slots: sortedSlots,
      ps_name: PS_STATIONS[ps_id].name
    });
  } catch (err) {
    console.error('Error inserting booking:', err);
    res.status(500).json({ error: 'Failed to save booking. Please retry.' });
  }
});

// ─── ADMIN API: LOGIN ─────────────────────────────────────────────────────────
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};

  if (!password || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid admin credentials' });
  }

  const token = createAdminSession();
  res.json({ success: true, token });
});

// ─── ADMIN API: GET BOOKINGS ──────────────────────────────────────────────────
app.get('/api/admin/bookings', verifyAdmin, async (req, res) => {
  try {
    const rows = await db.all('SELECT * FROM bookings');

    // Parse slots and compute earliest hour for chronological time sorting
    const formatted = rows.map(r => {
      let slotArr = [];
      try {
        slotArr = JSON.parse(r.slots);
      } catch (e) {
        slotArr = [];
      }
      const startHour = slotArr.length > 0 ? Math.min(...slotArr) : 0;
      const endHour = slotArr.length > 0 ? Math.max(...slotArr) + 1 : 0;

      return {
        ...r,
        slots: slotArr,
        startHour,
        endHour,
        hoursCount: slotArr.length
      };
    });

    // Time order by default: date ASC, then earliest startHour ASC
    formatted.sort((a, b) => {
      if (a.date !== b.date) {
        return a.date.localeCompare(b.date);
      }
      return a.startHour - b.startHour;
    });

    res.json({ bookings: formatted });
  } catch (err) {
    console.error('Error fetching admin bookings:', err);
    res.status(500).json({ error: 'Failed to load bookings' });
  }
});

// ─── ADMIN API: DELETE BOOKING ────────────────────────────────────────────────
app.delete('/api/admin/bookings/:id', verifyAdmin, async (req, res) => {
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ error: 'Booking ID is required' });
  }

  try {
    const existing = await db.get('SELECT * FROM bookings WHERE id = ? OR booking_id = ?', [id, id]);
    if (!existing) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    await db.run('DELETE FROM bookings WHERE id = ?', [existing.id]);

    res.json({
      success: true,
      message: `Booking ${existing.booking_id} deleted successfully`,
      deleted_id: existing.id,
      booking_id: existing.booking_id
    });
  } catch (err) {
    console.error('Error deleting booking:', err);
    res.status(500).json({ error: 'Failed to delete booking' });
  }
});

// ─── Fallback (Client Single Page Application) ────────────────────────────────
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Export app for Vercel Serverless Function
module.exports = app;

// Start Server when run directly
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n🎮 Offgrid Gamers Prebooking Server active at http://localhost:${PORT}`);
    console.log(`🔐 Admin Portal active at http://localhost:${PORT}/admin (Password: ${ADMIN_PASSWORD})\n`);
  });
}
