// Shared JS for all pages. Plain vanilla JS — no framework, no build step.
// All API calls use relative paths (/api/...) so the same code works on
// wrangler dev and on *.pages.dev without changes.

'use strict';

// ---------- Toasts ("Saved ✓ / Not saved ✗", Section 8.1) ----------

function showToast(message, type = 'info', ms = 2500) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  }, ms);
}

// ---------- API helper (Section 17) ----------

// Single entry point for /api calls: always sends the session cookie and
// turns network/HTTP failures into a friendly toast instead of a stack trace.
async function apiFetch(path, options = {}) {
  const opts = {
    credentials: 'include',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  };
  let res;
  try {
    res = await fetch(path, opts);
  } catch (e) {
    if (!options.silent) showToast('Network error — please check your connection', 'error');
    throw new Error('network');
  }
  if (!res.ok) {
    if (!options.silent) showToast('Something went wrong. Please try again.', 'error');
    const err = new Error('http');
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// ---------- Phase 0 status panel ----------

function setStatus(prefix, ok, text) {
  const dot = document.getElementById(`${prefix}-dot`);
  const label = document.getElementById(`${prefix}-status`);
  if (!dot || !label) return;
  dot.className = `status-dot ${ok ? 'ok' : 'err'}`;
  label.textContent = text;
}

async function checkHealth() {
  try {
    const data = await apiFetch('/api/ping', { silent: true });
    setStatus('api', data.ok === true, data.ok === true ? 'ok:true' : 'unexpected response');

    const d1 = data.d1 || {};
    if (!d1.bound) setStatus('db', false, 'D1 not bound (check wrangler.toml)');
    else if (d1.error) setStatus('db', false, d1.error);
    else if (d1.missing && d1.missing.length) setStatus('db', false, `missing: ${d1.missing.join(', ')}`);
    else setStatus('db', true, `${d1.tables.length} tables (${d1.tables.join(', ')})`);
  } catch (e) {
    setStatus('api', false, 'unreachable');
    setStatus('db', false, 'unknown');
  }

  try {
    const res = await fetch('/books.json', { cache: 'no-store' });
    const books = await res.json();
    const total = books.reduce((n, b) => n + b.chapters.length, 0);
    setStatus('seed', true, `${books.length} books, ${total} chapters (Grade ${books[0].grade})`);
  } catch (e) {
    setStatus('seed', false, 'could not load');
  }
}

// ---------- Wiring (no inline onclick, Section 17) ----------

document.addEventListener('DOMContentLoaded', () => {
  const pingBtn = document.getElementById('ping-btn');
  if (pingBtn) {
    pingBtn.addEventListener('click', checkHealth);
    checkHealth();
  }
});
