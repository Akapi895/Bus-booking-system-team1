// Demo UI for the BusBooking API. No build step: served as static files by Nginx.
const $ = (sel) => document.querySelector(sel);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (v) => Number(v).toLocaleString('vi-VN') + ' đ';
const time = (v) => (v ? v.replace('T', ' ').slice(0, 16) : '');

// Demo only: token in sessionStorage is readable by any script on the page.
let token = sessionStorage.getItem('token');

async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch('/api' + path, { method, headers, body: body && JSON.stringify(body) });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && token) logout();
    const details = data?.details ? ' (' + Object.values(data.details).join('; ') + ')' : '';
    throw new Error((data?.message || res.statusText || 'Request failed') + details);
  }
  return data;
}

function toast(msg, isErr = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = isErr ? 'err' : '';
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), 4000);
}

const formData = (form) => Object.fromEntries(new FormData(form));

// Wrap a form handler: prevent submit, show errors as a toast.
function onSubmit(form, fn) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await fn(formData(form), form); } catch (err) { toast(err.message, true); }
  });
}

// ---------- Views ----------
const views = ['search', 'bookings', 'stress', 'auth'];
function show(view) {
  views.forEach((v) => ($('#view-' + v).hidden = v !== view));
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  if (view === 'search') loadTrips();
  if (view === 'bookings') loadBookings();
}
document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));

async function refreshUser() {
  let me = null;
  if (token) me = await api('/auth/me').catch(() => null);
  document.querySelectorAll('.auth-only').forEach((el) => (el.hidden = !me));
  document.querySelectorAll('.guest-only').forEach((el) => (el.hidden = !!me));
  $('#who').textContent = me ? `${me.fullName} · ${me.role}` : '';
  return me;
}

function logout() {
  token = null;
  sessionStorage.removeItem('token');
  refreshUser();
  show('search');
}
$('#logout').addEventListener('click', logout);

// ---------- Search & book ----------
async function loadLocations() {
  const locations = await api('/locations').catch(() => []);
  const opts = locations.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
  document.querySelectorAll('#search-form select').forEach((s) => s.insertAdjacentHTML('beforeend', opts));
}

async function loadTrips() {
  const params = new URLSearchParams(Object.entries(formData($('#search-form'))).filter(([, v]) => v));
  try {
    const trips = await api('/trips?' + params);
    $('#trips').innerHTML = trips.map((t) => `
      <tr>
        <td>${t.id}</td>
        <td>${esc(t.origin)} → ${esc(t.destination)}</td>
        <td>${esc(t.operatorName)}</td>
        <td>${time(t.departureTime)}</td>
        <td>${money(t.price)}</td>
        <td>${t.availableSeats}</td>
        <td>${esc(t.status)}</td>
        <td><button data-book="${t.id}" ${t.status !== 'SCHEDULED' || !t.availableSeats ? 'disabled' : ''}>Đặt</button></td>
      </tr>`).join('') || '<tr><td colspan="8">Không có chuyến nào</td></tr>';
  } catch (err) { toast(err.message, true); }
}
onSubmit($('#search-form'), loadTrips);

$('#trips').addEventListener('click', (e) => {
  const id = e.target.dataset.book;
  if (!id) return;
  if (!token) { toast('Đăng nhập để đặt vé', true); return show('auth'); }
  const form = $('#book-form');
  form.tripId.value = id;
  $('#book-trip').textContent = id;
  $('#book-dialog').showModal();
});

$('#book-form').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'ok') return; // "Huỷ" just closes the dialog
  e.preventDefault();
  const d = formData(e.target);
  try {
    const b = await api('/bookings', { method: 'POST', body: { ...d, tripId: +d.tripId, quantity: +d.quantity } });
    $('#book-dialog').close();
    toast(`Đặt thành công ${b.bookingCode} · ${money(b.totalAmount)}`);
    loadTrips();
  } catch (err) { toast(err.message, true); }
});

// ---------- My bookings ----------
async function loadBookings() {
  try {
    const list = await api('/users/me/bookings');
    $('#bookings').innerHTML = list.map((b) => `
      <tr>
        <td>${esc(b.bookingCode)}</td>
        <td>${b.tripId}</td>
        <td>${esc(b.passengerName)}</td>
        <td>${b.quantity}</td>
        <td>${money(b.totalAmount)}</td>
        <td>${esc(b.status)}</td>
        <td>${time(b.bookedAt)}</td>
        <td>${b.status === 'CONFIRMED' ? `<button data-cancel="${b.id}">Huỷ vé</button>` : ''}</td>
      </tr>`).join('') || '<tr><td colspan="8">Chưa có vé nào</td></tr>';
  } catch (err) { toast(err.message, true); }
}

$('#bookings').addEventListener('click', async (e) => {
  const id = e.target.dataset.cancel;
  if (!id || !confirm('Huỷ vé này?')) return;
  try {
    await api('/bookings/' + id, { method: 'DELETE' });
    toast('Đã huỷ vé');
    loadBookings();
  } catch (err) { toast(err.message, true); }
});

// ---------- Concurrency demo ----------
onSubmit($('#stress-form'), async ({ tripId, n }) => {
  const out = $('#stress-out');
  const before = await api('/trips/' + tripId);
  out.textContent = `Chuyến #${tripId}: còn ${before.availableSeats} ghế. Đang gửi ${n} yêu cầu cùng lúc...`;

  const body = { tripId: +tripId, passengerName: 'Load Test', passengerPhone: '0900000000', quantity: 1 };
  const started = performance.now();
  const results = await Promise.allSettled(Array.from({ length: +n }, () => api('/bookings', { method: 'POST', body })));
  const ms = Math.round(performance.now() - started);

  const ok = results.filter((r) => r.status === 'fulfilled').length;
  const errors = {};
  results.filter((r) => r.status === 'rejected').forEach((r) => (errors[r.reason.message] = (errors[r.reason.message] || 0) + 1));
  const after = await api('/trips/' + tripId);
  const consistent = before.availableSeats - ok === after.availableSeats && ok <= before.availableSeats;

  out.textContent = [
    `Ghế trước:      ${before.availableSeats}`,
    `Yêu cầu gửi:    ${n} (xong trong ${ms} ms)`,
    `Thành công:     ${ok}`,
    `Bị từ chối:     ${+n - ok}`,
    ...Object.entries(errors).map(([m, c]) => `   ${c} × ${m}`),
    `Ghế sau:        ${after.availableSeats}`,
    '',
    consistent ? '✅ Nhất quán: không oversell, số ghế khớp số vé bán ra.' : '❌ KHÔNG nhất quán: số ghế không khớp số vé bán ra!',
  ].join('\n');
});

// ---------- Auth ----------
onSubmit($('#login-form'), async (d, form) => {
  const res = await api('/auth/login', { method: 'POST', body: d });
  token = res.token;
  sessionStorage.setItem('token', token);
  form.reset();
  await refreshUser();
  toast('Đăng nhập thành công');
  show('search');
});

onSubmit($('#register-form'), async (d, form) => {
  await api('/auth/register', { method: 'POST', body: d });
  $('#verify-form').email.value = d.email;
  form.reset();
  toast('Đã gửi mã OTP. Mở Mailpit để lấy mã.');
});

onSubmit($('#verify-form'), async (d, form) => {
  await api('/auth/verify-email', { method: 'POST', body: d });
  $('#login-form').email.value = d.email;
  form.reset();
  toast('Xác minh xong, giờ đăng nhập được rồi');
});

// ---------- Boot ----------
loadLocations();
refreshUser().then(() => show('search'));
