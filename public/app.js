/* ══════════════════════════════════════════════════════
   OFFGRID GAMERS — GTA VI VIP PRE-BOOKING SYSTEM
   Official Venue Reservation Engine · Velachery, Chennai
══════════════════════════════════════════════════════ */

'use strict';

// ── Application Configuration ──────────────────────────
const MIN_BOOKING_DATE = '2026-11-19'; // Bookings available from 19/11/2026 onwards

// ── Application State ──────────────────────────────────
const state = {
  date: MIN_BOOKING_DATE,
  selectedPS: null,
  selectedSlots: new Set(),   // Set of hour numbers (0-23)
  slotsData: [],              // [{hour, booked}]
  stations: [],
  lastConfirmedBooking: null, // Stores data for ticket generation
};

// ── Date & Time Utilities ──────────────────────────────
function formatHour(h) {
  if (h === 0)  return '12:00 AM';
  if (h < 12)   return `${String(h).padStart(2, '0')}:00 AM`;
  if (h === 12) return '12:00 PM';
  return `${String(h - 12).padStart(2, '0')}:00 PM`;
}

function formatHourRange(h) {
  const next = (h + 1) % 24;
  return `${formatHour(h)} – ${formatHour(next)}`;
}

function formatContinuousRange(slots) {
  if (!slots || slots.length === 0) return '';
  const sorted = [...slots].sort((a, b) => a - b);
  const start = sorted[0];
  const end = (sorted[sorted.length - 1] + 1) % 24;
  return `${formatHour(start)} – ${formatHour(end)}`;
}

function formatDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}

// ── Pricing Engine ─────────────────────────────────────
function price(psType, hours) {
  if (hours <= 0) return 0;
  if (psType === 'hardcore') {
    if (hours === 1) return 300;
    if (hours === 2) return 600;
    if (hours === 3) return 900;
    if (hours === 4) return 1000; // Flat promo
    if (hours === 8) return 2000; // Flat promo
    return hours * 250;           // Bulk rate above 4hrs
  }
  if (psType === 'lounge') {
    if (hours === 1) return 500;
    if (hours === 2) return 1000;
    if (hours === 3) return 1500;
    if (hours === 4) return 1500; // Flat promo
    if (hours === 8) return 2800; // Flat promo
    return hours * 350;           // Bulk rate above 4hrs
  }
  return 0;
}

function dealLabel(psType, hours) {
  if (hours === 4) {
    return psType === 'hardcore'
      ? '✓ 4-Hour Pro Pass Applied (Save ₹200)'
      : '✓ 4-Hour Lounge Pass Applied (Save ₹500)';
  }
  if (hours === 8) {
    return psType === 'hardcore'
      ? '✓ 8-Hour All-Nighter Pass Applied (Save ₹400)'
      : '✓ 8-Hour VIP Lounge Pass Applied (Save ₹1,200)';
  }
  if (psType === 'hardcore' && hours >= 5 && hours !== 8) {
    return '✓ Extended Session Rate: ₹250/hr Applied';
  }
  if (psType === 'lounge' && hours >= 5 && hours !== 8) {
    return '✓ Extended VIP Rate: ₹350/hr Applied';
  }
  return '';
}

// ── DOM References ─────────────────────────────────────
const datePicker     = document.getElementById('datePicker');
const psGrid         = document.getElementById('psGrid');
const stepSlots      = document.getElementById('step-slots');
const slotGrid       = document.getElementById('slotGrid');
const cartPanel      = document.getElementById('cartPanel');
const cartEmpty      = document.getElementById('cartEmpty');
const cartContent    = document.getElementById('cartContent');
const cartStation    = document.getElementById('cartStation');
const cartDate       = document.getElementById('cartDate');
const cartDuration   = document.getElementById('cartDuration');
const cartSlots      = document.getElementById('cartSlots');
const cartPrice      = document.getElementById('cartPrice');
const cartDealInfo   = document.getElementById('cartDealInfo');
const btnBook        = document.getElementById('btnBook');

const modalOverlay   = document.getElementById('modalOverlay');
const modalClose     = document.getElementById('modalClose');
const checkoutForm   = document.getElementById('checkoutForm');
const inputName      = document.getElementById('inputName');
const inputMobile    = document.getElementById('inputMobile');
const inputConfirm   = document.getElementById('inputConfirm');
const formLoading    = document.getElementById('formLoading');

const sumStation     = document.getElementById('sumStation');
const sumDate        = document.getElementById('sumDate');
const sumSlots       = document.getElementById('sumSlots');
const sumPrice       = document.getElementById('sumPrice');

const successOverlay   = document.getElementById('successOverlay');
const successBookingId = document.getElementById('successBookingId');
const successDetails   = document.getElementById('successDetails');
const btnNewBooking    = document.getElementById('btnNewBooking');

// ── Application Initialization ─────────────────────────
async function init() {
  // Booking starts from 19/11/2026 onwards
  datePicker.min   = MIN_BOOKING_DATE;
  datePicker.value = MIN_BOOKING_DATE;
  state.date       = MIN_BOOKING_DATE;

  datePicker.addEventListener('change', () => {
    if (datePicker.value < MIN_BOOKING_DATE) {
      alert('Bookings are only available from 19/11/2026 onwards.');
      datePicker.value = MIN_BOOKING_DATE;
    }
    state.date = datePicker.value;
    state.selectedSlots.clear();
    if (state.selectedPS) {
      loadSlots();
    }
    updateCart();
  });

  btnBook.addEventListener('click', openCheckout);
  modalClose.addEventListener('click', closeCheckout);
  modalOverlay.addEventListener('click', e => {
    if (e.target === modalOverlay) closeCheckout();
  });
  checkoutForm.addEventListener('submit', handleSubmit);
  btnNewBooking.addEventListener('click', resetAll);

  await loadStations();
}

// ── Station Hardware SVGs ──────────────────────────────
const HARDCORE_SVG = `
  <svg class="station-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="2" y="6" width="20" height="12" rx="6" />
    <path d="M6 12h4" />
    <path d="M8 10v4" />
    <circle cx="15" cy="11" r="1" fill="currentColor" />
    <circle cx="18" cy="13" r="1" fill="currentColor" />
  </svg>
`;

const LOUNGE_SVG = `
  <svg class="station-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M20 9V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v2" />
    <path d="M2 11a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z" />
    <path d="M4 19v2" />
    <path d="M20 19v2" />
  </svg>
`;

// ── Load Stations ──────────────────────────────────────
async function loadStations() {
  try {
    const res = await fetch('/api/stations');
    const data = await res.json();
    state.stations = data.stations;
    renderPSCards();
  } catch (err) {
    console.error('Failed to load stations', err);
    psGrid.innerHTML = '<div class="state-notice error">Unable to load station inventory. Please refresh.</div>';
  }
}

function renderPSCards() {
  psGrid.innerHTML = '';

  const features = {
    hardcore: [
      'Comfortable Sofa',
      'DualSense Edge Controller'
    ],
    lounge: [
      '65" 4K Smart TV',
      'Comfortable Sofa Seating',
      'Dual Wireless Controllers'
    ],
  };

  const pricingPills = {
    hardcore: [
      { label: '1 Hour', rate: '₹300' },
      { label: '4 Hours', rate: '₹1,000', badge: 'Popular' },
      { label: '8 Hours', rate: '₹2,000', badge: 'Save ₹400' }
    ],
    lounge: [
      { label: '1 Hour', rate: '₹500' },
      { label: '4 Hours', rate: '₹1,500', badge: 'Popular' },
      { label: '8 Hours', rate: '₹2,800', badge: 'Save ₹1,200' }
    ],
  };

  for (const ps of state.stations) {
    const card = document.createElement('div');
    const isLounge = ps.type === 'lounge';
    card.className = `ps-card ${ps.type}`;
    card.dataset.psId = ps.id;
    card.tabIndex = 0;
    card.setAttribute('role', 'radio');
    card.setAttribute('aria-checked', 'false');

    card.innerHTML = `
      <div class="ps-card-header">
        <div class="ps-icon-wrap ${ps.type}">
          ${isLounge ? LOUNGE_SVG : HARDCORE_SVG}
        </div>
        <div class="ps-meta-head">
          <div class="ps-name">${ps.name}</div>
          <span class="ps-type-badge ${ps.type}">
            ${isLounge ? 'VIP Private Lounge' : 'Competitive Rig'}
          </span>
        </div>
        <div class="ps-select-indicator" aria-hidden="true">
          <svg class="check-svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="3 8 6.5 11.5 13 4" />
          </svg>
        </div>
      </div>

      <ul class="ps-features">
        ${features[ps.type].map(f => `
          <li>
            <svg class="feature-bullet" aria-hidden="true" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="6" cy="6" r="3" fill="currentColor" />
            </svg>
            <span>${f}</span>
          </li>
        `).join('')}
      </ul>

      <div class="ps-pricing-tier">
        ${pricingPills[ps.type].map(p => `
          <div class="tier-pill ${p.badge ? 'highlight' : ''}">
            <span class="tier-time">${p.label}</span>
            <span class="tier-rate">${p.rate}</span>
          </div>
        `).join('')}
      </div>
      
      <div class="ps-card-footer">
        <span class="ps-rate-summary">Above 4 hrs: <strong>₹${isLounge ? '350' : '250'}/hr</strong></span>
        <span class="ps-action-text">Select Station →</span>
      </div>
    `;

    card.addEventListener('click', () => selectPS(ps));
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectPS(ps);
      }
    });

    psGrid.appendChild(card);
  }
}

// ── Select PS Station ──────────────────────────────────
async function selectPS(ps) {
  state.selectedPS = ps;
  state.selectedSlots.clear();

  document.querySelectorAll('.ps-card').forEach(c => {
    const isSelected = Number(c.dataset.psId) === ps.id;
    c.classList.toggle('selected', isSelected);
    c.setAttribute('aria-checked', isSelected ? 'true' : 'false');
  });

  stepSlots.classList.remove('hidden');
  
  // Smooth focus scroll to slot section
  setTimeout(() => {
    stepSlots.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);

  updateCart();
  await loadSlots();
}

// ── Slot Loader ────────────────────────────────────────
async function loadSlots() {
  if (!state.selectedPS) return;

  slotGrid.innerHTML = `
    <div class="slot-loading-state">
      <div class="mini-spinner" aria-hidden="true"></div>
      <span>Checking real-time slot availability for ${formatDate(state.date)}…</span>
    </div>
  `;

  try {
    const res = await fetch(`/api/slots?ps_id=${state.selectedPS.id}&date=${state.date}`);
    const data = await res.json();
    state.slotsData = data.slots;
    renderSlots();
  } catch (err) {
    slotGrid.innerHTML = `
      <div class="slot-error-state">
        <span>Failed to sync reservation schedule. Please re-select the date.</span>
      </div>
    `;
  }
}

function renderSlots() {
  slotGrid.innerHTML = '';

  for (const slot of state.slotsData) {
    const card = document.createElement('div');
    const isSelected = state.selectedSlots.has(slot.hour);
    const isBooked = !!slot.booked;

    card.className = `slot-card ${isBooked ? 'booked' : ''} ${isSelected ? 'selected' : ''}`;
    card.dataset.hour = slot.hour;
    card.tabIndex = isBooked ? -1 : 0;
    card.setAttribute('role', 'checkbox');
    card.setAttribute('aria-checked', isSelected ? 'true' : 'false');
    card.setAttribute('aria-disabled', isBooked ? 'true' : 'false');

    const formattedTime = formatHour(slot.hour);
    const timeRange = formatHourRange(slot.hour);

    card.innerHTML = `
      <div class="slot-time-block">
        <span class="slot-time">${formattedTime}</span>
        <span class="slot-range">${timeRange}</span>
      </div>
      <div class="slot-status-pill">
        ${isBooked 
          ? `<span class="pill-dot booked" aria-hidden="true"></span><span class="slot-status">RESERVED</span>` 
          : isSelected 
          ? `<span class="pill-dot selected" aria-hidden="true"></span><span class="slot-status">SELECTED</span>` 
          : `<span class="pill-dot available" aria-hidden="true"></span><span class="slot-status">AVAILABLE</span>`
        }
      </div>
    `;

    if (!isBooked) {
      card.addEventListener('click', () => toggleSlot(slot.hour));
      card.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggleSlot(slot.hour);
        }
      });
    }

    slotGrid.appendChild(card);
  }
}

// ── Contiguous Slot Selection Engine ───────────────────
// Users can only book contiguous/continuous sessions (no random jumping like 10am, 12pm, 6pm)
function toggleSlot(hour) {
  const bookedSet = new Set(state.slotsData.filter(s => s.booked).map(s => s.hour));
  if (bookedSet.has(hour)) return;

  const currentSlots = [...state.selectedSlots].sort((a, b) => a - b);

  // Case 1: Nothing selected yet -> start new continuous session
  if (currentSlots.length === 0) {
    state.selectedSlots.add(hour);
    updateSlotCards();
    updateCart();
    return;
  }

  const min = currentSlots[0];
  const max = currentSlots[currentSlots.length - 1];

  // Case 2: User clicks a slot that is ALREADY selected
  if (state.selectedSlots.has(hour)) {
    // Single slot selected -> toggle off
    if (currentSlots.length === 1) {
      state.selectedSlots.clear();
    } else if (hour === min) {
      // Clicked the start edge -> shrink by removing start
      state.selectedSlots.delete(hour);
    } else if (hour === max) {
      // Clicked the end edge -> shrink by removing end
      state.selectedSlots.delete(hour);
    } else {
      // Clicked in the middle of a range -> trim range from min to this hour
      state.selectedSlots.clear();
      for (let h = min; h <= hour; h++) {
        state.selectedSlots.add(h);
      }
    }
    updateSlotCards();
    updateCart();
    return;
  }

  // Case 3: User clicks an unselected slot
  // A) Extending forward (hour > max)
  if (hour > max) {
    let canExtend = true;
    for (let h = max + 1; h <= hour; h++) {
      if (bookedSet.has(h)) {
        canExtend = false;
        break;
      }
    }
    if (canExtend) {
      for (let h = max + 1; h <= hour; h++) {
        state.selectedSlots.add(h);
      }
    } else {
      // Cannot cross booked slots; start fresh from clicked slot
      state.selectedSlots.clear();
      state.selectedSlots.add(hour);
    }
    updateSlotCards();
    updateCart();
    return;
  }

  // B) Extending backward (hour < min)
  if (hour < min) {
    let canExtend = true;
    for (let h = hour; h < min; h++) {
      if (bookedSet.has(h)) {
        canExtend = false;
        break;
      }
    }
    if (canExtend) {
      for (let h = hour; h < min; h++) {
        state.selectedSlots.add(h);
      }
    } else {
      // Start fresh from clicked slot
      state.selectedSlots.clear();
      state.selectedSlots.add(hour);
    }
    updateSlotCards();
    updateCart();
    return;
  }
}

function updateSlotCards() {
  document.querySelectorAll('.slot-card:not(.booked)').forEach(card => {
    const hour = Number(card.dataset.hour);
    const isSelected = state.selectedSlots.has(hour);
    card.classList.toggle('selected', isSelected);
    card.setAttribute('aria-checked', isSelected ? 'true' : 'false');
    
    const pill = card.querySelector('.slot-status-pill');
    if (pill) {
      pill.innerHTML = isSelected 
        ? `<span class="pill-dot selected" aria-hidden="true"></span><span class="slot-status">SELECTED</span>`
        : `<span class="pill-dot available" aria-hidden="true"></span><span class="slot-status">AVAILABLE</span>`;
    }
  });
}

// ── Pass / Cart Summary ────────────────────────────────
function updateCart() {
  const ps    = state.selectedPS;
  const slots = [...state.selectedSlots].sort((a, b) => a - b);
  const hours = slots.length;

  if (!ps || hours === 0) {
    cartEmpty.classList.remove('hidden');
    cartContent.classList.add('hidden');
    cartPanel.classList.remove('has-items');
    return;
  }

  cartEmpty.classList.add('hidden');
  cartContent.classList.remove('hidden');
  cartPanel.classList.add('has-items');

  cartStation.textContent  = ps.name;
  cartDate.textContent     = formatDate(state.date);
  cartDuration.textContent = `${hours} Hour${hours > 1 ? 's' : ''} Continuous (${formatContinuousRange(slots)})`;

  // Slot Tags rendered cleanly
  cartSlots.innerHTML = slots.map(h => `
    <span class="slot-tag" title="${formatHourRange(h)}">
      <svg class="tag-clock" aria-hidden="true" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8">
        <circle cx="6" cy="6" r="4.5" />
        <polyline points="6 3.5 6 6 7.5 7" />
      </svg>
      <span>${formatHour(h)}</span>
    </span>
  `).join('');

  const total = price(ps.type, hours);
  cartPrice.textContent = `₹${total.toLocaleString('en-IN')}`;
  
  const deal = dealLabel(ps.type, hours);
  if (deal) {
    cartDealInfo.textContent = deal;
    cartDealInfo.classList.remove('hidden');
  } else {
    cartDealInfo.textContent = '';
    cartDealInfo.classList.add('hidden');
  }
}

// ── Checkout Dialog ────────────────────────────────────
function openCheckout() {
  const ps    = state.selectedPS;
  const slots = [...state.selectedSlots].sort((a, b) => a - b);

  if (!ps || slots.length === 0) return;

  const hours = slots.length;
  const total = price(ps.type, hours);

  sumStation.textContent = ps.name;
  sumDate.textContent    = formatDate(state.date);
  sumSlots.textContent   = `${formatContinuousRange(slots)} (${hours} hr${hours > 1 ? 's' : ''})`;
  sumPrice.textContent   = `₹${total.toLocaleString('en-IN')}`;

  checkoutForm.reset();
  clearErrors();
  checkoutForm.classList.remove('hidden');
  formLoading.classList.add('hidden');

  modalOverlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  setTimeout(() => inputName.focus(), 150);
}

function closeCheckout() {
  modalOverlay.classList.add('hidden');
  document.body.style.overflow = '';
}

function clearErrors() {
  ['errName', 'errMobile', 'errConfirm'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '';
  });
  inputName.classList.remove('error');
  const wrap = document.querySelector('.mobile-input-wrap');
  if (wrap) wrap.classList.remove('error');
}

function validateForm() {
  let valid = true;
  clearErrors();

  const name = inputName.value.trim();
  if (!name || name.length < 2) {
    document.getElementById('errName').textContent = 'Please enter your full name';
    inputName.classList.add('error');
    valid = false;
  }

  const mobile = inputMobile.value.trim();
  if (!/^\d{10}$/.test(mobile)) {
    document.getElementById('errMobile').textContent = 'Enter a valid 10-digit mobile number';
    const wrap = document.querySelector('.mobile-input-wrap');
    if (wrap) wrap.classList.add('error');
    valid = false;
  }

  if (!inputConfirm.checked) {
    document.getElementById('errConfirm').textContent = 'Attendance confirmation is required';
    valid = false;
  }

  return valid;
}

async function handleSubmit(e) {
  e.preventDefault();
  if (!validateForm()) return;

  const ps    = state.selectedPS;
  const slots = [...state.selectedSlots].sort((a, b) => a - b);

  checkoutForm.classList.add('hidden');
  formLoading.classList.remove('hidden');

  try {
    const res = await fetch('/api/book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ps_id:           ps.id,
        date:            state.date,
        slots:           slots,
        customer_name:   inputName.value.trim(),
        customer_mobile: inputMobile.value.trim(),
        confirmed:       inputConfirm.checked,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      formLoading.classList.add('hidden');
      checkoutForm.classList.remove('hidden');
      document.getElementById('errName').textContent = data.error || 'Reservation could not be locked. Please retry.';
      return;
    }

    closeCheckout();
    showSuccess(data, ps, slots, inputName.value.trim(), inputMobile.value.trim());

  } catch (err) {
    formLoading.classList.add('hidden');
    checkoutForm.classList.remove('hidden');
    document.getElementById('errName').textContent = 'Connectivity error. Please check your network and retry.';
  }
}

// ── Luxury Downloadable VIP Ticket Presentation ────────
function showSuccess(data, ps, slots, customerName, customerMobile) {
  successBookingId.textContent = data.booking_id;

  const hours = slots.length;
  const timeWindow = formatContinuousRange(slots);
  const formattedDate = formatDate(state.date);

  // Store for download canvas
  state.lastConfirmedBooking = {
    bookingId: data.booking_id,
    station: ps.name,
    stationType: ps.type,
    date: formattedDate,
    rawDate: state.date,
    timeWindow: timeWindow,
    hours: hours,
    price: data.total_price,
    customerName: customerName,
    customerMobile: customerMobile,
  };

  // Render authentic luxury perforated ticket
  successDetails.innerHTML = `
    <div class="vip-ticket-card" id="vipTicketCard">
      
      <!-- Ticket Top Branding -->
      <div class="ticket-top-band">
        <div class="ticket-logo-lockup">
          <img src="/logo.png" alt="Offgrid Gamers" class="ticket-brand-img" />
          <div class="ticket-header-meta">
            <span class="ticket-series">OFFICIAL GTA VI ACCESS PASS</span>
            <span class="ticket-venue">VELACHERY ARENA · CHENNAI</span>
          </div>
        </div>
        <div class="ticket-seal-badge">
          <span>VERIFIED RESERVATION</span>
        </div>
      </div>

      <!-- Main Ticket Body -->
      <div class="ticket-body-content">
        <div class="ticket-booking-ref-block">
          <span class="ticket-ref-label">BOOKING REFERENCE NUMBER</span>
          <div class="ticket-ref-id-row">
            <span class="ticket-ref-code">${data.booking_id}</span>
            <button class="btn-copy-ref" onclick="copyBookingRef('${data.booking_id}')" title="Copy Reference">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              <span>Copy</span>
            </button>
          </div>
        </div>

        <div class="ticket-grid">
          <div class="ticket-cell">
            <span class="t-label">Gaming Station</span>
            <span class="t-value highlight">${ps.name}</span>
          </div>
          <div class="ticket-cell">
            <span class="t-label">Session Date</span>
            <span class="t-value">${formattedDate}</span>
          </div>
          <div class="ticket-cell">
            <span class="t-label">Reserved Window</span>
            <span class="t-value">${timeWindow}</span>
          </div>
          <div class="ticket-cell">
            <span class="t-label">Duration</span>
            <span class="t-value">${hours} Continuous Hour${hours > 1 ? 's' : ''}</span>
          </div>
          <div class="ticket-cell">
            <span class="t-label">Guest Name</span>
            <span class="t-value">${customerName}</span>
          </div>
          <div class="ticket-cell">
            <span class="t-label">Mobile Contact</span>
            <span class="t-value">+91 ${customerMobile}</span>
          </div>
        </div>

        <!-- Perforated Tear Line with Semicircular Punches -->
        <div class="ticket-perforation" aria-hidden="true">
          <div class="notch notch-left"></div>
          <div class="notch-dash"></div>
          <div class="notch notch-right"></div>
        </div>

        <!-- Bottom Stub: Counter Payment & Venue -->
        <div class="ticket-bottom-stub">
          <div class="stub-info-col">
            <span class="t-label">Payable at Counter</span>
            <span class="t-amount">₹${data.total_price.toLocaleString('en-IN')}</span>
          </div>
          <div class="stub-barcode-col">
            <div class="barcode-graphic" aria-hidden="true">
              <span class="bc b1"></span><span class="bc b3"></span><span class="bc b2"></span><span class="bc b4"></span>
              <span class="bc b1"></span><span class="bc b2"></span><span class="bc b4"></span><span class="bc b3"></span>
              <span class="bc b2"></span><span class="bc b1"></span><span class="bc b3"></span><span class="bc b2"></span>
              <span class="bc b4"></span><span class="bc b1"></span><span class="bc b2"></span><span class="bc b3"></span>
            </div>
            <span class="barcode-serial">OG-GTA6-${data.booking_id}</span>
          </div>
        </div>

        <div class="ticket-address-footer">
          <span>Venue: Offgrid Gamers · 3rd Floor, 15, Velachery Main Rd, Anna Garden, Chennai – 600042</span>
        </div>

      </div>
    </div>

    <!-- Ticket Action Buttons -->
    <div class="ticket-actions-bar">
      <button class="btn-ticket-download" id="btnDownloadTicket" onclick="downloadTicketImage()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        <span>Download Ticket Pass (PNG)</span>
      </button>

      <button class="btn-ticket-print" onclick="window.print()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <polyline points="6 9 6 2 18 2 18 9" />
          <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
          <rect x="6" y="14" width="12" height="8" />
        </svg>
        <span>Print Pass</span>
      </button>
    </div>
  `;

  successOverlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

// ── Copy Reference to Clipboard ────────────────────────
window.copyBookingRef = function(ref) {
  navigator.clipboard.writeText(ref).then(() => {
    alert(`Booking reference ${ref} copied to clipboard!`);
  }).catch(() => {
    prompt('Copy your Booking Reference:', ref);
  });
};

// ── Canvas-based Ultra-Crisp PNG Ticket Generator ──────
window.downloadTicketImage = function() {
  const b = state.lastConfirmedBooking;
  if (!b) return;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  // High resolution retina canvas
  canvas.width  = 1200;
  canvas.height = 1600;

  // Background
  const bgGrad = ctx.createLinearGradient(0, 0, 1200, 1600);
  bgGrad.addColorStop(0, '#0a0b0e');
  bgGrad.addColorStop(1, '#11131a');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, 1200, 1600);

  // Outer border & card
  ctx.strokeStyle = '#262934';
  ctx.lineWidth = 4;
  ctx.strokeRect(60, 60, 1080, 1480);

  // Top Accent Banner
  ctx.fillStyle = '#d26415';
  ctx.fillRect(60, 60, 1080, 24);

  // Title header
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 44px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('OFFGRID GAMERS', 100, 150);

  ctx.fillStyle = '#d26415';
  ctx.font = 'bold 24px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('GTA VI PLAYSTATION 5 VIP ACCESS PASS', 100, 195);

  ctx.fillStyle = '#64748b';
  ctx.font = '22px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Velachery Arena, Chennai · Official Venue Reservation', 100, 235);

  // Divider
  ctx.strokeStyle = '#262934';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(100, 275);
  ctx.lineTo(1100, 275);
  ctx.stroke();

  // Booking Reference Box
  ctx.fillStyle = '#141720';
  ctx.fillRect(100, 310, 1000, 170);
  ctx.strokeStyle = '#d26415';
  ctx.lineWidth = 2;
  ctx.strokeRect(100, 310, 1000, 170);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '600 22px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('VIP BOOKING REFERENCE ID', 140, 360);

  ctx.fillStyle = '#d26415';
  ctx.font = 'bold 72px "JetBrains Mono", monospace';
  ctx.fillText(b.bookingId, 140, 445);

  // Details Grid
  const details = [
    { label: 'CONSOLE STATION', val: b.station },
    { label: 'RESERVATION DATE', val: b.date },
    { label: 'RESERVED WINDOW', val: b.timeWindow },
    { label: 'SESSION DURATION', val: `${b.hours} Hours Continuous` },
    { label: 'GUEST NAME', val: b.customerName },
    { label: 'MOBILE NUMBER', val: `+91 ${b.customerMobile}` },
  ];

  let startY = 550;
  details.forEach((item, index) => {
    const isLeft = index % 2 === 0;
    const x = isLeft ? 100 : 640;
    const y = startY + Math.floor(index / 2) * 130;

    ctx.fillStyle = '#64748b';
    ctx.font = '600 20px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(item.label, x, y);

    ctx.fillStyle = item.label === 'CONSOLE STATION' ? '#d26415' : '#f8fafc';
    ctx.font = 'bold 28px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(item.val, x, y + 42);
  });

  // Perforation line
  ctx.strokeStyle = '#333846';
  ctx.lineWidth = 4;
  ctx.setLineDash([16, 14]);
  ctx.beginPath();
  ctx.moveTo(100, 1020);
  ctx.lineTo(1100, 1020);
  ctx.stroke();
  ctx.setLineDash([]); // Reset dash

  // Semicircle punches
  ctx.fillStyle = '#0a0b0e';
  ctx.beginPath();
  ctx.arc(60, 1020, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(1140, 1020, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Price & Counter info
  ctx.fillStyle = '#64748b';
  ctx.font = '600 22px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('TOTAL PAYABLE AT VENUE COUNTER', 100, 1100);

  ctx.fillStyle = '#10b981';
  ctx.font = 'bold 64px "JetBrains Mono", monospace';
  ctx.fillText(`₹${b.price.toLocaleString('en-IN')}`, 100, 1175);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '22px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Guaranteed console reservation. Please present this pass on arrival.', 100, 1225);

  // Barcode visualization
  ctx.fillStyle = '#475569';
  let barX = 100;
  const barPattern = [4, 2, 8, 3, 2, 6, 3, 8, 4, 2, 6, 3, 8, 4, 3, 6, 2, 8, 3, 4, 6, 8, 2, 4];
  for (let i = 0; i < 40; i++) {
    const w = barPattern[i % barPattern.length];
    ctx.fillRect(barX, 1280, w, 60);
    barX += w + 6;
    if (barX > 1050) break;
  }

  // Barcode serial
  ctx.fillStyle = '#64748b';
  ctx.font = '18px "JetBrains Mono", monospace';
  ctx.fillText(`BARCODE // OG-GTA6-${b.bookingId}-CHENNAI`, 100, 1375);

  // Address footer
  ctx.fillStyle = '#141720';
  ctx.fillRect(60, 1430, 1080, 110);
  ctx.fillStyle = '#94a3b8';
  ctx.font = '20px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('OFFGRID GAMERS: 3rd Floor, 15, Velachery Main Rd, Anna Garden, Chennai, TN – 600042', 100, 1495);

  // Trigger instant download
  const link = document.createElement('a');
  link.download = `Offgrid-Gamers-VIP-Pass-${b.bookingId}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
};

function resetAll() {
  successOverlay.classList.add('hidden');
  document.body.style.overflow = '';

  state.selectedPS = null;
  state.selectedSlots.clear();

  document.querySelectorAll('.ps-card').forEach(c => {
    c.classList.remove('selected');
    c.setAttribute('aria-checked', 'false');
  });
  stepSlots.classList.add('hidden');
  updateCart();
}

// ── Global Keyboard Listeners ──────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (!modalOverlay.classList.contains('hidden'))  closeCheckout();
    if (!successOverlay.classList.contains('hidden')) resetAll();
  }
});

// ── Launch Engine ──────────────────────────────────────
init();
