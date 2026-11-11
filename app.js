// CBSE Personal Tutor — shared front-end script for every page.
// Plain vanilla JS: no framework, no bundler, files are served as-is.
//
// Data-safety rules (PROJECT.md Section 8):
//  • every write goes to /api/* (D1) first; IndexedDB is written only after 2xx
//  • IndexedDB is a display cache, never the source of truth
//  • all URLs are relative (/api/...), auth is an HttpOnly cookie set by the server

'use strict';

const GRADE = 4;
const CDN = {
  tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
  puter: 'https://js.puter.com/v2/',
  mermaid: 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js',
  chart: 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js'
};

// =====================================================================
// DOM helpers
// =====================================================================

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Builds elements with textContent only, so AI/OCR/user text can never inject HTML.
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'on') for (const [evt, fn] of Object.entries(v)) el.addEventListener(evt, fn);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function clear(el) {
  while (el && el.firstChild) el.removeChild(el.firstChild);
  return el;
}

function qs(name) {
  return new URLSearchParams(location.search).get(name);
}

function loadScript(src) {
  loadScript.cache = loadScript.cache || {};
  if (!loadScript.cache[src]) {
    loadScript.cache[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = resolve;
      s.onerror = () => { delete loadScript.cache[src]; reject(new Error(`Could not load ${src}`)); };
      document.head.appendChild(s);
    });
  }
  return loadScript.cache[src];
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  return isNaN(d) ? iso : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function setBusy(btn, busy, label) {
  if (!btn) return;
  if (busy) {
    btn.dataset.label = btn.textContent;
    btn.textContent = label || 'Working…';
    btn.disabled = true;
  } else {
    btn.textContent = btn.dataset.label || btn.textContent;
    btn.disabled = false;
  }
}

// =====================================================================
// Toasts — visible "Saved ✓ / Not saved ✗" on every write (Section 8.1)
// =====================================================================

function showToast(message, type = 'info', ms = 2800) {
  let root = document.getElementById('toast-root');
  if (!root) {
    root = h('div', { id: 'toast-root', 'aria-live': 'polite' });
    document.body.appendChild(root);
  }
  const el = h('div', { class: `toast toast-${type}` }, message);
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  }, ms);
}

// =====================================================================
// API helper (Section 17)
// =====================================================================

class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

// Single entry point for /api calls: always sends the session cookie,
// sends JSON, and turns failures into friendly messages (no stack traces).
async function apiFetch(path, options = {}) {
  const { body, silent, ...rest } = options;
  const opts = { credentials: 'include', ...rest, headers: { ...(rest.headers || {}) } };
  if (body !== undefined) {
    opts.body = typeof body === 'string' ? body : JSON.stringify(body);
    opts.headers['Content-Type'] = 'application/json';
  }
  let res;
  try {
    res = await fetch(path, opts);
  } catch (e) {
    if (!silent) showToast('You seem to be offline — showing saved copy', 'error');
    throw new ApiError('offline', 0);
  }
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) {
    const message = (data && data.error) || 'Something went wrong. Please try again.';
    if (res.status === 401 && document.body.dataset.page !== 'login') {
      location.href = '/';
    } else if (!silent) {
      showToast(message, 'error', 4000);
    }
    throw new ApiError(message, res.status, data);
  }
  return data;
}

// =====================================================================
// IndexedDB cache (display cache only — D1 is authoritative)
// =====================================================================

const IDB_NAME = 'cbse-tutor';
const IDB_STORES = ['books', 'chapters', 'quiz', 'learning', 'progress', 'meta'];

function idbOpen() {
  idbOpen.p = idbOpen.p || new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('no idb'));
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      for (const s of IDB_STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return idbOpen.p;
}

async function idbTx(store, mode, fn) {
  try {
    const db = await idbOpen();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    // Private mode / disabled storage: the app still works straight from D1.
    console.warn('IndexedDB unavailable', e);
    return undefined;
  }
}

const idbPut = (store, key, value) => idbTx(store, 'readwrite', s => s.put(value, key));
const idbGet = (store, key) => idbTx(store, 'readonly', s => s.get(key));
const idbDelete = (store, key) => idbTx(store, 'readwrite', s => s.delete(key));
async function idbClearAll() {
  for (const s of IDB_STORES) await idbTx(s, 'readwrite', st => st.clear());
}

// Write-through (Section 8.1): server first; cache only after a 2xx.
async function saveAndCache(endpoint, data, cache, method = 'POST') {
  let saved;
  try {
    saved = await apiFetch(endpoint, { method, body: data, silent: true });
  } catch (e) {
    showToast(e.status === 409 ? 'Not saved ✗ — changed on another device, reloading' : `Not saved ✗ — ${e.message}`, 'error', 4500);
    throw e;
  }
  if (cache && cache.store) {
    const value = cache.pick ? cache.pick(saved) : saved;
    const key = typeof cache.key === 'function' ? cache.key(value) : cache.key;
    if (key !== undefined && value !== undefined) await idbPut(cache.store, key, value);
  }
  showToast('Saved ✓', 'success');
  return saved;
}

// Read pattern (Section 8.2): paint cached copy instantly, then revalidate from D1.
async function cachedRead(store, key, path, render, pick = d => d) {
  const cached = await idbGet(store, key);
  if (cached !== undefined) render(cached, { fromCache: true });
  try {
    const fresh = pick(await apiFetch(path, { silent: cached !== undefined }));
    await idbPut(store, key, fresh);
    render(fresh, { fromCache: false });
    return fresh;
  } catch (e) {
    if (cached === undefined) throw e;
    return cached;
  }
}

// =====================================================================
// Auth
// =====================================================================

// Offline (network error, not a 401): fall back to the last identity the
// server confirmed, so cached pages still open. Any write still needs D1.
async function getMe() {
  try {
    const me = await apiFetch('/api/me', { silent: true });
    await idbPut('meta', 'me', me).catch(() => {});
    return me;
  } catch (e) {
    if (e && e.status === 0) {
      const cached = await idbGet('meta', 'me').catch(() => undefined);
      if (cached) { showToast('Offline — showing saved copy. Changes need a connection.', 'error', 4000); return cached; }
    } else if (e && e.status === 401) {
      await idbDelete('meta', 'me').catch(() => {});
    }
    return null;
  }
}

// Server session is the only login state; there is no client "loggedIn" flag.
async function requireLogin(role) {
  const me = await getMe();
  if (!me) { location.href = '/'; return null; }
  if (role && me.user.role !== role) {
    location.href = me.user.role === 'parent' ? '/parent' : '/child';
    return null;
  }
  const who = $('#who');
  if (who) who.textContent = `${me.user.email} · ${me.user.role}`;
  const out = $('#logout-btn');
  if (out) out.addEventListener('click', logout);
  return me;
}

async function logout() {
  try { await apiFetch('/api/logout', { method: 'POST', body: {}, silent: true }); } catch { /* still leave */ }
  await idbClearAll();   // shared devices: drop the local cache, D1 keeps everything
  location.href = '/';
}

// =====================================================================
// Fingerprint + fuzzy matching (inline Dice coefficient, string-similarity style)
// =====================================================================

function normalizeTitle(s) {
  return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Must match bookFingerprint() in functions/api/_lib.js.
function bookFingerprint(grade, subject, title) {
  return sha256Hex(`${grade}|${normalizeTitle(subject)}|${normalizeTitle(title)}`);
}

function diceCoefficient(a, b) {
  a = a.replace(/\s+/g, '');
  b = b.replace(/\s+/g, '');
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = new Map();
  for (let i = 0; i < a.length - 1; i++) {
    const g = a.substr(i, 2);
    grams.set(g, (grams.get(g) || 0) + 1);
  }
  let hits = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const g = b.substr(i, 2);
    const n = grams.get(g) || 0;
    if (n > 0) { grams.set(g, n - 1); hits++; }
  }
  return (2 * hits) / (a.length + b.length - 2);
}

// OCR text of a cover is much longer than a title, so compare the title with
// every word-window of the same length and keep the best score.
function fuzzyScore(text, title) {
  const t = normalizeTitle(text);
  const target = normalizeTitle(title);
  if (!t || !target) return 0;
  if (` ${t} `.includes(` ${target} `)) return 1;
  const words = t.split(' ');
  const n = Math.max(1, target.split(' ').length);
  let best = diceCoefficient(t, target) * 0.5;
  for (let size = Math.max(1, n - 1); size <= n + 1; size++) {
    for (let i = 0; i + size <= words.length; i++) {
      best = Math.max(best, diceCoefficient(words.slice(i, i + size).join(' '), target));
    }
  }
  return best;
}

function fuzzyFindBestMatch(text, targets) {
  let best = { target: null, score: 0, index: -1 };
  targets.forEach((target, index) => {
    const score = fuzzyScore(text, target);
    if (score > best.score) best = { target, score, index };
  });
  return best;
}

// =====================================================================
// Shared renderers
// =====================================================================

const SUBJECT_ORDER = ['English', 'Maths', 'EVS', 'Hindi'];
const SUBJECT_ICON = { English: '📗', Maths: '📐', EVS: '🌿', Hindi: '📙' };

function sortBooks(books) {
  return [...books].sort((a, b) => {
    const ia = SUBJECT_ORDER.indexOf(a.subject), ib = SUBJECT_ORDER.indexOf(b.subject);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.title.localeCompare(b.title);
  });
}

async function loadBooks(render) {
  return cachedRead('books', 'all', '/api/books', render, d => d.books);
}

function emptyState(text) {
  return h('p', { class: 'text-slate-500 text-sm py-4' }, text);
}

// =====================================================================
// Page: login (index.html)
// =====================================================================

function setStatus(prefix, ok, text) {
  const dot = document.getElementById(`${prefix}-dot`);
  const label = document.getElementById(`${prefix}-status`);
  if (!dot || !label) return;
  dot.className = `status-dot ${ok ? 'ok' : 'err'}`;
  label.textContent = text;
}

// Phase 0 deliverable check: worker up, D1 tables present, seed file served.
async function checkHealth() {
  try {
    const data = await apiFetch('/api/ping', { silent: true });
    setStatus('api', data.ok === true, data.ok === true ? 'ok:true' : 'unexpected response');
    const d1 = data.d1 || {};
    if (!d1.bound) setStatus('db', false, 'D1 not bound (check wrangler.toml)');
    else if (d1.error) setStatus('db', false, d1.error);
    else if (d1.missing && d1.missing.length) setStatus('db', false, `missing: ${d1.missing.join(', ')}`);
    else setStatus('db', true, `${d1.tables.length} tables`);
  } catch {
    setStatus('api', false, 'unreachable');
    setStatus('db', false, 'unknown');
  }
  try {
    const books = await (await fetch('/books.json', { cache: 'no-store' })).json();
    const total = books.reduce((n, b) => n + b.chapters.length, 0);
    setStatus('seed', true, `${books.length} books, ${total} chapters`);
  } catch {
    setStatus('seed', false, 'could not load');
  }
}

async function initLogin() {
  const pingBtn = $('#ping-btn');
  if (pingBtn) {
    pingBtn.addEventListener('click', e => { e.preventDefault(); checkHealth(); });
    checkHealth();
  }
  const me = await getMe();
  if (me) {
    location.href = me.user.role === 'parent' ? '/parent' : '/child';
    return;
  }

  const form = $('#login-form');
  const signup = $('#signup-form');
  const toggle = $('#show-signup');

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('button[type=submit]', form);
    setBusy(btn, true, 'Logging in…');
    try {
      const res = await apiFetch('/api/login', {
        method: 'POST',
        body: { email: form.email.value, password: form.password.value }
      });
      location.href = res.user.role === 'parent' ? '/parent' : '/child';
    } catch {
      setBusy(btn, false);
    }
  });

  toggle.addEventListener('click', () => {
    $('#signup-card').classList.toggle('hidden');
  });

  signup.addEventListener('submit', async e => {
    e.preventDefault();
    if (signup.password.value !== signup.password2.value) {
      showToast('Passwords do not match', 'error');
      return;
    }
    const btn = $('button[type=submit]', signup);
    setBusy(btn, true, 'Creating…');
    try {
      await apiFetch('/api/signup', {
        method: 'POST',
        body: { email: signup.email.value, password: signup.password.value }
      });
      showToast('Saved ✓ — parent account created', 'success');
      location.href = '/parent';
    } catch {
      setBusy(btn, false);
    }
  });
}

// =====================================================================
// Page: parent dashboard (parent.html)
// =====================================================================

async function initParent() {
  const me = await requireLogin('parent');
  if (!me) return;
  renderChildren(me.children);
  wireChildForm();
  wireDataSafety();
  await refreshParentBooks();
  if (typeof initCapture === 'function') initCapture();
  if (typeof initParentProgress === 'function') initParentProgress(me.children);
}

function renderChildren(children) {
  const list = $('#children-list');
  clear(list);
  if (!children.length) {
    list.appendChild(emptyState('No child account yet. Add one below so your child can log in.'));
    return;
  }
  for (const c of children) {
    list.appendChild(h('li', { class: 'flex items-center justify-between py-2 border-b last:border-0' },
      h('span', {}, '🧒 ', c.email),
      h('span', { class: 'text-xs text-slate-400' }, `added ${fmtDate(c.created_at)}`)));
  }
}

function wireChildForm() {
  const form = $('#child-form');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('button[type=submit]', form);
    setBusy(btn, true, 'Saving…');
    try {
      await saveAndCache('/api/signup', { email: form.email.value, password: form.password.value });
      form.reset();
      const me = await getMe();
      if (me) {
        renderChildren(me.children);
        if (typeof initParentProgress === 'function') initParentProgress(me.children);
      }
    } catch { /* toast already shown */ }
    setBusy(btn, false);
  });
}

async function refreshParentBooks() {
  const root = $('#books-root');
  try {
    await loadBooks(books => renderParentBooks(root, books));
  } catch {
    clear(root).appendChild(emptyState('Could not load books. Check your connection and reload.'));
  }
}

function renderParentBooks(root, books) {
  clear(root);
  if (!books.length) {
    const btn = h('button', { class: 'btn-primary', type: 'button' }, `Load Grade ${GRADE} NCERT books`);
    btn.addEventListener('click', async () => {
      setBusy(btn, true, 'Loading…');
      try {
        await saveAndCache('/api/books/seed', {});
        await refreshParentBooks();
      } catch { setBusy(btn, false); }
    });
    root.append(
      emptyState('No books saved yet. Load the Grade 4 NCERT seed (Santoor, Maths Mela, Our Wondrous World, Veena) or capture a book below.'),
      btn
    );
    return;
  }
  for (const book of sortBooks(books)) root.appendChild(renderParentBook(book));
  // Seed import is idempotent, so offering it again only fills in missing books.
  const more = h('button', { class: 'link text-sm', type: 'button' }, `+ Add any missing Grade ${GRADE} NCERT books`);
  more.addEventListener('click', async () => {
    try {
      const res = await saveAndCache('/api/books/seed', {});
      if (!res.created) showToast('All seed books are already saved', 'info');
      await refreshParentBooks();
    } catch { /* toast shown */ }
  });
  root.appendChild(more);
}

function renderParentBook(book) {
  const list = h('ol', { class: 'divide-y' });
  for (const ch of book.chapters) list.appendChild(renderParentChapterRow(ch));

  const addForm = h('form', { class: 'flex gap-2 mt-3' },
    h('input', { name: 'title', class: 'input flex-1', placeholder: 'Add a chapter title', required: true, maxlength: 200 }),
    h('button', { class: 'btn-secondary', type: 'submit' }, 'Add'));
  addForm.addEventListener('submit', async e => {
    e.preventDefault();
    const nextNo = Math.max(0, ...book.chapters.map(c => c.chapter_no || 0)) + 1;
    try {
      await saveAndCache('/api/chapters', { book_id: book.id, title: addForm.title.value, chapter_no: nextNo });
      await refreshParentBooks();
    } catch { /* toast shown */ }
  });

  return h('details', { class: 'card mb-3', open: false },
    h('summary', { class: 'cursor-pointer font-semibold flex justify-between items-center' },
      h('span', {}, `${SUBJECT_ICON[book.subject] || '📘'} ${book.subject} — ${book.title}`),
      h('span', { class: 'text-xs text-slate-400 font-normal' }, `${book.chapters.length} chapters`)),
    list, addForm);
}

function renderParentChapterRow(ch) {
  const title = h('a', { href: `/chapter?id=${encodeURIComponent(ch.id)}`, class: 'link flex-1' },
    `${ch.chapter_no ?? ''}. ${ch.title}`);
  const badge = h('span', { class: `badge ${ch.has_content ? 'badge-ok' : 'badge-muted'}` },
    ch.has_content ? 'text saved' : 'needs capture');
  const editBtn = h('button', { class: 'icon-btn', type: 'button', title: 'Fix title', 'aria-label': 'Fix chapter title' }, '✎');
  const row = h('li', { class: 'flex items-center gap-2 py-2' }, title, badge, editBtn);

  // Manual correction of misread titles, saved with optimistic concurrency.
  editBtn.addEventListener('click', () => {
    const input = h('input', { class: 'input flex-1', value: ch.title, maxlength: 200 });
    const save = h('button', { class: 'btn-secondary', type: 'button' }, 'Save');
    const cancel = h('button', { class: 'icon-btn', type: 'button' }, '✕');
    row.replaceChildren(input, save, cancel);
    input.focus();
    cancel.addEventListener('click', () => row.replaceWith(renderParentChapterRow(ch)));
    save.addEventListener('click', async () => {
      try {
        const res = await saveAndCache(`/api/chapters/${encodeURIComponent(ch.id)}`,
          { title: input.value, updated_at: ch.updated_at }, null, 'PUT');
        row.replaceWith(renderParentChapterRow({ ...ch, ...res.chapter, has_content: ch.has_content }));
        await idbDelete('books', 'all');
      } catch {
        await refreshParentBooks();
      }
    });
  });
  return row;
}

function wireDataSafety() {
  $('#export-btn').addEventListener('click', async e => {
    const btn = e.currentTarget;
    setBusy(btn, true, 'Exporting…');
    try {
      const dump = await apiFetch('/api/export');
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
      const a = h('a', { href: URL.createObjectURL(blob), download: `cbse-tutor-export-${dump.exported_at.slice(0, 10)}.json` });
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      showToast('Export downloaded ✓', 'success');
    } catch { /* toast shown */ }
    setBusy(btn, false);
  });

  const file = $('#import-file');
  $('#import-btn').addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files[0];
    file.value = '';
    if (!f) return;
    let dump;
    try { dump = JSON.parse(await f.text()); } catch { showToast('Not saved ✗ — that file is not valid JSON', 'error'); return; }
    if (!confirm(`Restore from "${f.name}"? Rows in the file will overwrite the same rows in the database.`)) return;
    try {
      const res = await saveAndCache('/api/import', dump);
      const total = Object.values(res.imported).reduce((a, b) => a + b, 0);
      showToast(`Restored ${total} rows ✓`, 'success');
      await idbClearAll();
      await refreshParentBooks();
    } catch { /* toast shown */ }
  });

  const backup = $('#backup-btn');
  if (backup) backup.addEventListener('click', async () => {
    setBusy(backup, true, 'Backing up…');
    try {
      const res = await saveAndCache('/api/backup', {});
      showToast(`Backed up to R2: ${res.key}`, 'success', 4000);
    } catch { /* toast shown */ }
    setBusy(backup, false);
  });
}

// =====================================================================
// Page: child dashboard (child.html)
// =====================================================================

async function initChild() {
  const me = await requireLogin('child');
  if (!me) return;
  const root = $('#books-root');
  let progressByChapter = {};
  const draw = books => renderChildBooks(root, books, progressByChapter);
  try {
    await loadBooks(draw);
  } catch {
    clear(root).appendChild(emptyState('Could not load your books. Check your connection.'));
  }
  if (typeof initChildProgress === 'function') {
    progressByChapter = await initChildProgress(me.user.id);
    const books = await idbGet('books', 'all');
    if (books) draw(books);
  }
  if (typeof initRevision === 'function') initRevision();
}

function renderChildBooks(root, books, progressByChapter = {}) {
  clear(root);
  if (!books.length) {
    root.appendChild(emptyState('No books yet — ask your parent to add them.'));
    return;
  }
  for (const book of sortBooks(books)) {
    const list = h('ul', { class: 'grid gap-2 sm:grid-cols-2 mt-3' });
    for (const ch of book.chapters) {
      const p = progressByChapter[ch.id];
      list.appendChild(h('li', {},
        h('a', { href: `/chapter?id=${encodeURIComponent(ch.id)}`, class: 'chapter-tile' },
          h('span', { class: 'font-medium' }, `${ch.chapter_no ?? ''}. ${ch.title}`),
          p ? h('span', { class: 'badge badge-ok' }, `⭐ ${p.score}%`) : null)));
    }
    root.appendChild(h('section', { class: 'card mb-4' },
      h('h2', { class: 'text-lg font-semibold' }, `${SUBJECT_ICON[book.subject] || '📘'} ${book.subject} · ${book.title}`),
      list));
  }
}

// =====================================================================
// Boot — each page sets <body data-page="...">. No inline onclick anywhere.
// =====================================================================

document.addEventListener('DOMContentLoaded', () => {
  const page = document.body.dataset.page;
  const init = {
    login: initLogin,
    parent: initParent,
    child: initChild,
    chapter: typeof initChapter === 'function' ? initChapter : null
  }[page];
  if (init) init().catch(e => {
    console.error(e);
    showToast('Something went wrong loading this page', 'error');
  });
  if (typeof registerServiceWorker === 'function') registerServiceWorker();
});

// =====================================================================
// Phase 2 — Capture & OCR
// =====================================================================

// Downscale + fix EXIF rotation once, so every OCR tier gets a sane image
// and the Workers AI upload stays well under the request limit.
async function prepareImage(file, maxDim = 1800) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    bitmap = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85));
  return { canvas, dataUrl, blob };
}

function fileToBase64(prepared) {
  return prepared.dataUrl.split(',')[1];
}

// Section 9: Tesseract (on-device) → Puter img2txt → Workers AI Vision.
async function tryOCR(file, { lang = 'eng', onStatus = () => {} } = {}) {
  const prepared = await prepareImage(file);

  try {
    onStatus('Reading on this device (Tesseract)…');
    await loadScript(CDN.tesseract);
    const { data } = await Tesseract.recognize(prepared.canvas, lang);
    if (data.text.trim().length > 20) return { text: data.text, source: 'tesseract' };
  } catch (e) { console.warn('Tesseract failed', e); }

  try {
    onStatus('Trying Puter OCR…');
    await loadScript(CDN.puter);
    const text = await puter.ai.img2txt(prepared.blob);
    if (text && text.trim().length > 20) return { text, source: 'puter' };
  } catch (e) { console.warn('Puter failed', e); }

  try {
    onStatus('Trying Workers AI Vision…');
    const res = await apiFetch('/api/ocr', { method: 'POST', body: { image: fileToBase64(prepared) }, silent: true });
    if (res.text && res.text.trim().length > 20) return { text: res.text, source: 'workers-ai' };
  } catch (e) { console.warn('Workers AI OCR failed', e); }

  throw new Error('All OCR options failed');
}

// Section 10 tiers 2 and 3 point at external catalogues. Their URLs in
// PROJECT.md are placeholders, so they stay disabled (null) until a real
// endpoint is configured here; the chain then falls through to manual entry.
const BOOK_SOURCES = {
  ncertApi: null,      // e.g. (grade, subject) => `https://<ncert-mcp-host>/books/${grade}/${subject}/topics`
  orizCatalog: null    // e.g. 'https://<host>/catalog/index.json'
};

async function resolveBook(ocrText, grade, subject) {
  const normalized = ocrText.toLowerCase().replace(/\s+/g, ' ').trim();

  // Option 1: seed data — match each title and its parts, e.g. "Veena (वीणा)".
  try {
    const seed = await (await fetch('/books.json')).json();
    const candidates = [];
    seed.forEach(b => {
      if (b.grade !== grade) return;
      [b.title, ...b.title.split(/[()]/)].map(t => t.trim()).filter(Boolean)
        .forEach(t => candidates.push({ book: b, title: t }));
    });
    const best = fuzzyFindBestMatch(normalized, candidates.map(c => c.title));
    if (best.score > 0.7) {
      const book = candidates[best.index].book;
      return { ...book, source: 'seed', score: best.score };
    }
  } catch (e) { console.warn('Seed lookup failed', e); }

  // Option 2: NCERT MCP REST API
  if (BOOK_SOURCES.ncertApi) {
    try {
      const res = await fetch(BOOK_SOURCES.ncertApi(grade, subject));
      if (res.ok) {
        const chapters = await res.json();
        return { grade, subject, title: subject, chapters, source: 'ncert-api' };
      }
    } catch (e) { /* fall through */ }
  }

  // Option 3: Oriz NCERT catalogue → official PDFs
  if (BOOK_SOURCES.orizCatalog) {
    try {
      const catalog = await (await fetch(BOOK_SOURCES.orizCatalog)).json();
      const match = catalog.find(b => fuzzyScore(normalized, b.title) > 0.7);
      if (match) return { ...match, source: 'oriz-pdf' };
    } catch (e) { /* fall through */ }
  }

  // Option 4: parent types / corrects everything on the review screen.
  return { grade, subject, title: guessTitle(ocrText), chapters: [], source: 'manual' };
}

function guessTitle(text) {
  const lines = String(text).split('\n').map(l => l.trim()).filter(l => /\p{L}{3,}/u.test(l));
  return (lines[0] || '').slice(0, 120);
}

// Turns an index/contents page into [{chapter_no, title}].
function parseChaptersFromIndex(text) {
  const out = new Map();
  const re = /^(?:chapter|ch\.?|lesson|unit|पाठ|अध्याय)?\s*(\d{1,2})\s*[:.)\-–—]?\s+(.+?)$/i;
  for (let line of String(text).split('\n')) {
    line = line.replace(/\s+/g, ' ').trim();
    const m = line.match(re);
    if (!m) continue;
    const no = Number(m[1]);
    const title = m[2].replace(/\s*\.{2,}.*$/, '').replace(/\s+\d{1,3}$/, '').replace(/[|_]+/g, '').trim();
    if (no < 1 || no > 40 || !/\p{L}{2,}/u.test(title) || title.length > 100) continue;
    if (!out.has(no)) out.set(no, { chapter_no: no, title });
  }
  return [...out.values()].sort((a, b) => a.chapter_no - b.chapter_no);
}

function ocrLang(subject) {
  return /hindi/i.test(subject || '') ? 'hin+eng' : 'eng';
}

// ---------- Parent: capture a new book (cover + index), once ----------

function initCapture() {
  const form = $('#capture-form');
  if (!form) return;
  const status = $('#capture-status');
  const review = $('#capture-review');

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const subject = form.subject.value;
    const cover = form.cover.files[0];
    const index = form.index.files[0];
    if (!cover) { showToast('Please add a photo of the front cover', 'error'); return; }
    const btn = $('button[type=submit]', form);
    setBusy(btn, true, 'Reading photos…');
    clear(review);
    try {
      const say = msg => { status.textContent = msg; };
      say('Reading the cover…');
      const coverOcr = await tryOCR(cover, { lang: ocrLang(subject), onStatus: m => say(`Cover: ${m}`) });
      let indexOcr = { text: '', source: null };
      if (index) {
        indexOcr = await tryOCR(index, { lang: ocrLang(subject), onStatus: m => say(`Index page: ${m}`) })
          .catch(() => ({ text: '', source: null }));
      }
      say('Matching with known books…');
      const resolved = await resolveBook(`${coverOcr.text}\n${indexOcr.text}`, GRADE, subject);

      // Lookup order: IndexedDB → D1 → (only then) save new. Never capture twice.
      const fp = await bookFingerprint(GRADE, resolved.subject || subject, resolved.title);
      const cachedBooks = (await idbGet('books', 'all')) || [];
      let existing = cachedBooks.find(b => b.fingerprint === fp);
      if (!existing) {
        try { existing = (await apiFetch(`/api/books?fp=${fp}`, { silent: true })).book; } catch { /* 404 = new */ }
      }
      if (existing) {
        say('');
        review.appendChild(h('div', { class: 'card bg-green-50' },
          h('p', { class: 'font-semibold' }, `✅ "${existing.title}" is already saved (${existing.chapters.length} chapters).`),
          h('p', { class: 'text-sm text-slate-600' }, 'No need to capture it again — it is available on every device.')));
        return;
      }

      const chapters = resolved.chapters && resolved.chapters.length
        ? resolved.chapters.map(c => ({ chapter_no: c.chapter_no, title: c.title, id: c.id }))
        : parseChaptersFromIndex(indexOcr.text);
      say(`Read with ${coverOcr.source}${indexOcr.source ? ` + ${indexOcr.source}` : ''}. Please check before saving.`);
      renderCaptureReview(review, {
        title: resolved.title,
        subject: resolved.subject || subject,
        publisher: resolved.publisher || '',
        source: resolved.source === 'manual' ? 'ocr' : resolved.source,
        chapters,
        rawText: `${coverOcr.text}\n---\n${indexOcr.text}`.trim()
      });
    } catch (err) {
      status.textContent = 'Could not read the photos. Try better light, or type the details below.';
      renderCaptureReview(review, { title: '', subject, publisher: '', source: 'manual', chapters: [], rawText: '' });
    } finally {
      setBusy(btn, false);
    }
  });
}

// Review & correction screen — nothing is saved until the parent confirms.
function renderCaptureReview(root, draft) {
  clear(root);
  const rows = h('ol', { class: 'space-y-2' });
  const addRow = (c = { chapter_no: '', title: '' }) => {
    const row = h('li', { class: 'flex gap-2 items-center' },
      h('input', { class: 'input w-16', name: 'no', type: 'number', min: 0, max: 999, value: c.chapter_no ?? '' }),
      h('input', { class: 'input flex-1', name: 'title', value: c.title || '', placeholder: 'Chapter title', maxlength: 200 }),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Remove chapter', on: { click: () => row.remove() } }, '✕'));
    if (c.id) row.dataset.id = c.id;
    rows.appendChild(row);
  };
  draft.chapters.forEach(addRow);
  if (!draft.chapters.length) addRow({ chapter_no: 1, title: '' });

  const title = h('input', { class: 'input w-full', value: draft.title, required: true, maxlength: 200 });
  const subject = h('input', { class: 'input w-full', value: draft.subject, required: true, maxlength: 60 });
  const publisher = h('input', { class: 'input w-full', value: draft.publisher, maxlength: 100, placeholder: 'e.g. NCERT' });
  const save = h('button', { type: 'button', class: 'btn-primary' }, 'Save book');

  save.addEventListener('click', async () => {
    const chapters = $$('li', rows).map(r => ({
      id: r.dataset.id,
      chapter_no: Number($('[name=no]', r).value) || null,
      title: $('[name=title]', r).value.trim()
    })).filter(c => c.title);
    if (!title.value.trim()) { showToast('Please enter the book title', 'error'); return; }
    setBusy(save, true, 'Saving…');
    try {
      const res = await saveAndCache('/api/books', {
        grade: GRADE, subject: subject.value, title: title.value, publisher: publisher.value,
        source: draft.source, chapters
      });
      if (res.existing) showToast('This book was already saved — using the saved copy', 'info');
      clear(root);
      $('#capture-status').textContent = '';
      $('#capture-form').reset();
      await idbDelete('books', 'all');
      await refreshParentBooks();
    } catch { setBusy(save, false); }
  });

  root.append(h('div', { class: 'card space-y-3 border border-blue-200' },
    h('h3', { class: 'font-semibold' }, 'Check and correct'),
    h('label', { class: 'block text-sm' }, 'Book title', title),
    h('div', { class: 'grid sm:grid-cols-2 gap-3' },
      h('label', { class: 'block text-sm' }, 'Subject', subject),
      h('label', { class: 'block text-sm' }, 'Publisher', publisher)),
    h('div', {}, h('p', { class: 'text-sm mb-1' }, 'Chapters'), rows,
      h('button', { type: 'button', class: 'link text-sm mt-2', on: { click: () => addRow() } }, '+ Add chapter')),
    draft.rawText ? h('details', { class: 'text-xs text-slate-500' }, h('summary', { class: 'cursor-pointer' }, 'Show text read from photos'),
      h('pre', { class: 'whitespace-pre-wrap mt-2' }, draft.rawText)) : null,
    save));
}

// ---------- Chapter page: load + capture chapter text once ----------

const chapterState = { me: null, chapter: null, renderedOnce: false };

async function initChapter() {
  const me = await requireLogin();
  if (!me) return;
  chapterState.me = me;
  const id = qs('id');
  if (!id) { location.href = '/'; return; }
  $('#back-link').href = me.user.role === 'parent' ? '/parent' : '/child';
  if (me.user.role === 'child') {
    document.body.classList.replace('bg-slate-50', 'bg-amber-50');
    $('#chapter-header').classList.replace('bg-blue-900', 'bg-amber-500');
  }

  // Lookup order: IndexedDB → D1 → camera (camera only if both lack text).
  try {
    await cachedRead('chapters', id, `/api/chapters/${encodeURIComponent(id)}`, ch => renderChapter(ch), d => d.chapter);
  } catch (e) {
    $('#chapter-title').textContent = e.status === 404 ? 'Chapter not found' : 'Could not load this chapter';
  }
}

function renderChapter(ch) {
  chapterState.chapter = ch;
  document.title = `${ch.title} — CBSE Personal Tutor`;
  $('#chapter-book').textContent = `${SUBJECT_ICON[ch.subject] || '📘'} ${ch.subject} · ${ch.book_title} · Chapter ${ch.chapter_no ?? ''}`;
  $('#chapter-title').textContent = ch.title;
  if (chapterState.me.user.role === 'parent') {
    $('#content-panel').classList.remove('hidden');
    renderContentPanel(ch);
  }
  if (typeof renderTabs === 'function') renderTabs(ch, chapterState.me);
}

async function saveChapterText(text, source) {
  const ch = chapterState.chapter;
  try {
    const res = await saveAndCache(`/api/chapters/${encodeURIComponent(ch.id)}`,
      { content_text: text, source, updated_at: ch.updated_at },
      { store: 'chapters', key: ch.id, pick: d => d.chapter }, 'PUT');
    renderChapter(res.chapter);
  } catch (e) {
    if (e.status === 409 && e.body && e.body.current) {
      await idbPut('chapters', ch.id, e.body.current);
      renderChapter(e.body.current);
    }
    throw e;
  }
}

function renderContentPanel(ch) {
  const root = clear($('#content-root'));
  const badge = $('#content-badge');
  if (ch.content_text) {
    badge.className = 'badge badge-ok';
    badge.textContent = `saved${ch.source ? ` · ${ch.source}` : ''} · ${fmtDate(ch.updated_at)}`;
    const preview = ch.content_text.length > 500 ? `${ch.content_text.slice(0, 500)}…` : ch.content_text;
    root.append(
      h('details', {},
        h('summary', { class: 'cursor-pointer text-sm text-slate-600 whitespace-pre-wrap' }, preview),
        h('pre', { class: 'whitespace-pre-wrap text-sm mt-2 max-h-96 overflow-auto' }, ch.content_text)),
      h('div', { class: 'flex flex-wrap gap-2 mt-3' },
        h('button', { type: 'button', class: 'btn-secondary', on: { click: () => renderTextEditor(root, ch.content_text, ch.source || 'manual') } }, '✎ Correct text'),
        h('button', { type: 'button', class: 'btn-secondary', on: { click: () => renderPageCapture(root, ch.content_text) } }, '📸 Add more pages')));
  } else {
    badge.className = 'badge badge-warn';
    badge.textContent = 'not captured yet';
    root.append(h('p', { class: 'text-sm text-slate-600 mb-2' },
      'Photograph each page of this chapter once. The text is saved to the cloud and reused for learning content and tests.'));
    renderPageCapture(root, '');
  }
}

function renderPageCapture(root, existingText) {
  clear(root);
  const input = h('input', { type: 'file', accept: 'image/*', capture: 'environment', multiple: true, class: 'input w-full' });
  const status = h('p', { class: 'text-sm text-slate-500', 'aria-live': 'polite' });
  const read = h('button', { type: 'button', class: 'btn-primary' }, 'Read pages');
  const typeIt = h('button', { type: 'button', class: 'btn-secondary' }, 'Type or paste instead');
  const cancel = existingText ? h('button', { type: 'button', class: 'icon-btn', on: { click: () => renderContentPanel(chapterState.chapter) } }, 'Cancel') : null;

  typeIt.addEventListener('click', () => renderTextEditor(root, existingText, 'manual'));
  read.addEventListener('click', async () => {
    const files = [...input.files];
    if (!files.length) { showToast('Choose or take at least one photo', 'error'); return; }
    setBusy(read, true, 'Reading…');
    const parts = [];
    const sources = new Set();
    for (let i = 0; i < files.length; i++) {
      try {
        const r = await tryOCR(files[i], {
          lang: ocrLang(chapterState.chapter.subject),
          onStatus: m => { status.textContent = `Page ${i + 1} of ${files.length}: ${m}`; }
        });
        parts.push(r.text.trim());
        sources.add(r.source);
      } catch {
        showToast(`Page ${i + 1} could not be read — retake it or type it`, 'error');
      }
    }
    setBusy(read, false);
    status.textContent = '';
    if (!parts.length) return;
    const text = [existingText, ...parts].filter(Boolean).join('\n\n');
    renderTextEditor(root, text, `ocr:${[...sources].join('+')}`);
  });

  root.append(h('div', { class: 'space-y-2' }, input, h('div', { class: 'flex flex-wrap gap-2' }, read, typeIt, cancel), status));
}

function renderTextEditor(root, text, source) {
  clear(root);
  const area = h('textarea', { class: 'input w-full font-mono text-sm', rows: 14, maxlength: 200000 });
  area.value = text || '';
  const save = h('button', { type: 'button', class: 'btn-primary' }, 'Save chapter text');
  const cancel = h('button', { type: 'button', class: 'icon-btn' }, 'Cancel');
  cancel.addEventListener('click', () => renderContentPanel(chapterState.chapter));
  save.addEventListener('click', async () => {
    setBusy(save, true, 'Saving…');
    try { await saveChapterText(area.value.trim(), source); } catch { setBusy(save, false); }
  });
  root.append(
    h('p', { class: 'text-xs text-slate-500 mb-1' }, 'Fix any misread words before saving.'),
    area,
    h('div', { class: 'flex gap-2 mt-2' }, save, cancel));
}

// =====================================================================
// Phase 3 + 4 — Chapter tabs: 👁️ Visual | 🛠️ Practical | 🎲 Fun | 📝 Test
// =====================================================================

const TABS = [
  { id: 'visual', label: '👁️ Visual' },
  { id: 'practical', label: '🛠️ Practical' },
  { id: 'fun', label: '🎲 Fun' },
  { id: 'test', label: '📝 Test' }
];

function renderTabs(ch, me) {
  // Cached + fresh renders can both arrive; rebuild only when the chapter changed.
  const sig = `${ch.id}|${ch.updated_at}`;
  if (chapterState.tabSig === sig) return;
  chapterState.tabSig = sig;

  const bar = clear($('#tab-bar'));
  const initial = TABS.some(t => `#${t.id}` === location.hash) ? location.hash.slice(1) : 'visual';
  for (const t of TABS) {
    const btn = h('button', { type: 'button', role: 'tab', class: 'tab', dataset: { tab: t.id } }, t.label);
    btn.addEventListener('click', () => showTab(t.id, ch, me));
    bar.appendChild(btn);
  }
  showTab(initial, ch, me);
}

function showTab(id, ch, me) {
  history.replaceState(null, '', `#${id}`);
  $$('#tab-bar .tab').forEach(b => {
    const on = b.dataset.tab === id;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  const body = clear($('#tab-body'));
  const isParent = me.user.role === 'parent';
  if (id === 'test') return isParent ? renderParentTest(body, ch) : renderChildTest(body, ch);
  return renderLearningTab(body, ch, id, isParent);
}

function needsTextNote(isParent) {
  return emptyState(isParent
    ? 'Save the chapter text above first — all learning content is made from it.'
    : 'This chapter is not ready yet. Ask your parent to add it. 🙂');
}

// ---------- Learning tabs (Visual / Practical / Fun) ----------

async function renderLearningTab(body, ch, mode, isParent) {
  const content = h('div');
  const tools = h('div', { class: 'flex flex-wrap gap-2 mt-4' });
  body.append(content, tools);
  content.appendChild(h('p', { class: 'text-slate-400 text-sm' }, 'Loading…'));

  let lastSig = null;
  const draw = (learning, force) => {
    const sig = JSON.stringify(learning && learning[mode]);
    if (force !== true && sig === lastSig) return;   // don't reset a game mid-play
    lastSig = sig;
    clear(content);
    clear(tools);
    const value = learning && learning[mode];
    if (value) {
      if (mode === 'visual') renderMindmap(content, value);
      if (mode === 'practical') renderPractical(content, value);
      if (mode === 'fun') renderMatchingGame(content, value);
    } else if (!isParent) {
      content.appendChild(emptyState('Coming soon — your parent is getting this ready. 🙂'));
    } else if (!ch.content_text) {
      content.appendChild(needsTextNote(true));
    } else {
      content.appendChild(emptyState(`No ${mode} content yet for this chapter.`));
    }
    if (isParent && ch.content_text) {
      const label = value ? '↻ Regenerate' : `✨ Create ${mode} content with AI`;
      const btn = h('button', { type: 'button', class: value ? 'btn-secondary' : 'btn-primary' }, label);
      btn.addEventListener('click', async () => {
        if (value && !confirm('Regenerating uses today\'s free AI quota and replaces this content. Continue?')) return;
        setBusy(btn, true, 'Creating… (can take ~20 s)');
        try {
          const res = await saveAndCache('/api/learning/generate', { chapter_id: ch.id, mode, regenerate: !!value },
            { store: 'learning', key: ch.id, pick: d => d.learning });
          draw(res.learning, true);
        } catch { setBusy(btn, false); }
      });
      tools.appendChild(btn);
    }
  };

  try {
    await cachedRead('learning', ch.id, `/api/learning/${encodeURIComponent(ch.id)}`, draw, d => d.learning);
  } catch {
    clear(content).appendChild(emptyState('Could not load this right now. Check your connection.'));
  }
}

// AI mind maps often contain shape syntax or punctuation Mermaid rejects;
// rebuild a clean tree of plain labels and keep the indentation.
function parseMindmap(code) {
  const lines = String(code || '').replace(/```(?:mermaid)?/gi, '').split('\n');
  const nodes = [];
  for (const raw of lines) {
    if (!raw.trim() || /^\s*mindmap\b/i.test(raw) || /^\s*(%%|::icon|::)/.test(raw)) continue;
    const indent = raw.match(/^\s*/)[0].replace(/\t/g, '  ').length;
    let text = raw.trim()
      .replace(/^[\w-]*\s*(\(\(|\{\{|\)\)|\(|\[|\{|\))/, '')
      .replace(/(\)\)|\}\}|\(\(|\)|\]|\}|\()$/, '')
      .replace(/[()[\]{}"`<>]/g, '')
      .replace(/^[-*•]\s*/, '')
      .trim();
    if (text) nodes.push({ indent, text: text.slice(0, 60) });
  }
  return nodes.slice(0, 40);
}

function sanitizeMindmap(code) {
  const nodes = parseMindmap(code);
  if (!nodes.length) return null;
  const rootIndent = nodes[0].indent;
  const out = ['mindmap', `  root((${nodes[0].text}))`];
  for (const n of nodes.slice(1)) {
    const rel = Math.max(2, n.indent - rootIndent);
    out.push(`${' '.repeat(2 + rel)}${n.text}`);
  }
  return out.join('\n');
}

let mermaidReady = null;
async function renderMindmap(container, code) {
  const box = h('div', { class: 'mindmap overflow-x-auto' }, h('p', { class: 'text-slate-400 text-sm' }, 'Drawing the mind map…'));
  container.appendChild(box);
  const clean = sanitizeMindmap(code);
  try {
    if (!clean) throw new Error('empty');
    mermaidReady = mermaidReady || loadScript(CDN.mermaid).then(() => {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default', themeVariables: { fontSize: '18px' } });
    });
    await mermaidReady;
    const { svg } = await mermaid.render(`mm-${Date.now()}`, clean);
    box.innerHTML = svg;   // SVG produced by Mermaid in strict mode from sanitised labels
    requestAnimationFrame(() => { box.scrollLeft = (box.scrollWidth - box.clientWidth) / 2; });
  } catch (e) {
    console.warn('Mermaid render failed, showing outline', e);
    clear(box).appendChild(renderOutline(parseMindmap(code)));
  }
}

function renderOutline(nodes) {
  const root = h('ul', { class: 'outline' });
  const stack = [{ indent: -1, list: root }];
  for (const n of nodes) {
    while (stack.length > 1 && n.indent <= stack[stack.length - 1].indent) stack.pop();
    const li = h('li', {}, n.text);
    stack[stack.length - 1].list.appendChild(li);
    const sub = h('ul');
    li.appendChild(sub);
    stack.push({ indent: n.indent, list: sub });
  }
  return root;
}

function renderPractical(container, act) {
  container.appendChild(h('article', { class: 'activity-card' },
    h('p', { class: 'text-xs uppercase tracking-wide text-emerald-700 font-semibold' }, 'Try this at home'),
    h('h3', { class: 'text-xl font-bold mb-3' }, act.title),
    act.materials && act.materials.length ? h('div', { class: 'mb-3' },
      h('h4', { class: 'font-semibold' }, '🧺 You need'),
      h('ul', { class: 'list-disc pl-6' }, act.materials.map(m => h('li', {}, m)))) : null,
    h('div', { class: 'mb-3' },
      h('h4', { class: 'font-semibold' }, '👣 Steps'),
      h('ol', { class: 'list-decimal pl-6 space-y-1' }, act.steps.map(s => h('li', {}, s)))),
    act.learning ? h('p', { class: 'bg-white/70 rounded p-3' }, h('strong', {}, '💡 What you learn: '), act.learning) : null,
    h('p', { class: 'text-xs text-slate-500 mt-3' }, 'Do this with a grown-up nearby.')));
}

// ---------- 🎲 Matching game: drag (mouse or touch) or tap-tap ----------

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function renderMatchingGame(container, pairs) {
  clear(container);
  let matched = 0;
  let selected = null;
  const status = h('p', { class: 'text-sm text-slate-600 mb-3', 'aria-live': 'polite' },
    'Drag each card on the right to its match on the left — or tap a card, then tap its match.');
  const slots = h('div', { class: 'mg-col' });
  const chips = h('div', { class: 'mg-col' });

  pairs.forEach((p, i) => slots.appendChild(h('div', { class: 'mg-slot', dataset: { i } },
    h('span', { class: 'mg-label' }, p.left), h('span', { class: 'mg-drop' }, '…'))));
  shuffle(pairs.map((p, i) => ({ ...p, i }))).forEach(p => chips.appendChild(h('div', { class: 'mg-chip', dataset: { i: p.i }, tabindex: 0 }, p.right)));

  function tryMatch(chip, slot) {
    if (!chip || !slot || slot.classList.contains('done')) return;
    if (chip.dataset.i === slot.dataset.i) {
      slot.classList.add('done');
      $('.mg-drop', slot).textContent = chip.textContent;
      chip.remove();
      matched++;
      status.textContent = matched === pairs.length ? '🎉 Brilliant! You matched them all!' : `✅ Correct! ${pairs.length - matched} to go.`;
      if (matched === pairs.length) {
        container.appendChild(h('button', { type: 'button', class: 'btn-primary mt-4', on: { click: () => renderMatchingGame(container, pairs) } }, 'Play again'));
      }
    } else {
      slot.classList.add('wrong');
      chip.classList.add('wrong');
      status.textContent = '🤔 Not quite — try another one.';
      setTimeout(() => { slot.classList.remove('wrong'); chip.classList.remove('wrong'); }, 500);
    }
    select(null);
  }

  function select(chip) {
    if (selected) selected.classList.remove('selected');
    selected = chip;
    if (chip) chip.classList.add('selected');
  }

  chips.addEventListener('pointerdown', e => {
    const chip = e.target.closest('.mg-chip');
    if (!chip) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY };
    let dragging = false;
    chip.setPointerCapture(e.pointerId);
    const move = ev => {
      const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
      if (!dragging && Math.hypot(dx, dy) > 6) { dragging = true; chip.classList.add('dragging'); }
      if (dragging) chip.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    const up = ev => {
      chip.removeEventListener('pointermove', move);
      chip.removeEventListener('pointerup', up);
      chip.removeEventListener('pointercancel', up);
      if (dragging) {
        chip.style.visibility = 'hidden';
        const under = document.elementFromPoint(ev.clientX, ev.clientY);
        chip.style.visibility = '';
        chip.style.transform = '';
        chip.classList.remove('dragging');
        tryMatch(chip, under && under.closest('.mg-slot'));
      } else {
        select(selected === chip ? null : chip);
      }
    };
    chip.addEventListener('pointermove', move);
    chip.addEventListener('pointerup', up);
    chip.addEventListener('pointercancel', up);
  });
  chips.addEventListener('keydown', e => {
    const chip = e.target.closest('.mg-chip');
    if (chip && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); select(chip); }
  });
  slots.addEventListener('click', e => {
    const slot = e.target.closest('.mg-slot');
    if (slot && selected) tryMatch(selected, slot);
  });

  container.append(status, h('div', { class: 'mg-board' }, slots, chips));
}

// ---------- 📝 Test: shared question inputs ----------

function questionText(item) {
  return item.question || item.statement || '';
}

function renderQuestionInput(type, item, name) {
  if (type === 'mcq') {
    return h('div', { class: 'grid gap-2 sm:grid-cols-2' }, item.options.map(o =>
      h('label', { class: 'choice' }, h('input', { type: 'radio', name, value: o }), h('span', {}, o))));
  }
  if (type === 'true_false') {
    return h('div', { class: 'flex gap-2' },
      h('label', { class: 'choice' }, h('input', { type: 'radio', name, value: 'true' }), h('span', {}, '✔️ True')),
      h('label', { class: 'choice' }, h('input', { type: 'radio', name, value: 'false' }), h('span', {}, '❌ False')));
  }
  if (type === 'fill_blank') return h('input', { class: 'input w-full', name, autocomplete: 'off', placeholder: 'Type the missing word' });
  return h('textarea', { class: 'input w-full', name, rows: type === 'long' ? 5 : 3, placeholder: 'Write your answer' });
}

function readAnswer(form, type, name) {
  if (type === 'mcq' || type === 'true_false') {
    const el = $(`input[name="${CSS.escape(name)}"]:checked`, form);
    if (!el) return undefined;
    return type === 'true_false' ? el.value === 'true' : el.value;
  }
  const el = form.elements[name];
  return el ? el.value.trim() : undefined;
}

const TYPE_TITLES = {
  mcq: 'Choose the right answer', fill_blank: 'Fill in the blanks', true_false: 'True or false?',
  short: 'Answer in a few words', long: 'Answer in detail'
};
const QUIZ_TYPES = ['mcq', 'fill_blank', 'true_false', 'short', 'long'];

function markResult(block, r) {
  if (!block || !r) return;
  block.classList.add(r.correct ? 'q-right' : 'q-wrong');
  const note = h('div', { class: 'text-sm mt-2' }, r.correct ? '✅ Correct!' : '❌ Not quite.');
  if (r.answer !== undefined && !r.correct) note.append(' Answer: ', h('strong', {}, String(r.answer === true ? 'True' : r.answer === false ? 'False' : r.answer)));
  if (r.explanation) note.append(h('div', { class: 'text-slate-600' }, r.explanation));
  block.appendChild(note);
}

// ---------- 📝 Test: child ----------

async function renderChildTest(body, ch) {
  // cachedRead may render twice (cache, then server); never wipe a test in progress.
  const draw = (data, force) => {
    const sig = JSON.stringify(data.quiz);
    if (force !== true && body.dataset.sig === sig) return;
    body.dataset.sig = sig;
    clear(body);
    const quiz = data.quiz;
    const form = h('form', { class: 'space-y-6' });
    let n = 0;
    for (const type of QUIZ_TYPES) {
      const items = quiz[type] || [];
      if (!items.length) continue;
      const sec = h('fieldset', { class: 'space-y-3' }, h('legend', { class: 'font-semibold text-lg mb-2' }, TYPE_TITLES[type]));
      items.forEach((item, i) => {
        const qid = `${type}-${i}`;
        sec.appendChild(h('div', { class: 'q-block', dataset: { qid } },
          h('p', { class: 'font-medium mb-2' }, `${++n}. ${questionText(item)}`),
          renderQuestionInput(type, item, qid)));
      });
      form.appendChild(sec);
    }
    const submit = h('button', { type: 'submit', class: 'btn-primary w-full sm:w-auto' }, 'Check my answers');
    const result = h('div', { 'aria-live': 'polite' });
    form.append(submit, result);

    form.addEventListener('submit', async e => {
      e.preventDefault();
      const answers = {};
      for (const type of QUIZ_TYPES) (quiz[type] || []).forEach((_, i) => {
        const v = readAnswer(form, type, `${type}-${i}`);
        if (v !== undefined && v !== '') answers[`${type}-${i}`] = v;
      });
      setBusy(submit, true, 'Checking…');
      try {
        const res = await saveAndCache('/api/progress/submit', { chapter_id: ch.id, answers },
          { store: 'progress', key: `last:${ch.id}` });
        submit.remove();
        $$('input, textarea', form).forEach(el => { el.disabled = true; });
        res.results.forEach(r => markResult($(`[data-qid="${r.qid}"]`, form), r));
        $$('.q-block', form).filter(b => /^(short|long)-/.test(b.dataset.qid)).forEach(b => {
          const model = (res.written || []).find(w => w.qid === b.dataset.qid);
          b.appendChild(h('div', { class: 'text-sm mt-2 text-slate-600' }, '📝 Your parent will read this answer.',
            model && model.model_answer ? h('div', {}, 'Sample answer: ', model.model_answer) : null));
        });
        const stars = res.score === null ? '' : res.score >= 90 ? '⭐⭐⭐' : res.score >= 60 ? '⭐⭐' : '⭐';
        clear(result).append(h('div', { class: 'score-banner' },
          h('p', { class: 'text-3xl' }, stars),
          h('p', { class: 'text-xl font-bold' }, res.score === null ? 'Answers sent!' : `You scored ${res.score}% (${res.correct} of ${res.total})`),
          h('p', { class: 'text-sm' }, res.answer_key_visible ? 'Check the answers above.' : 'Mistakes come back later in a Revision Round.'),
          h('button', { type: 'button', class: 'btn-secondary mt-3', on: { click: () => draw(data, true) } }, 'Try again')));
        result.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch { setBusy(submit, false); }
    });
    body.appendChild(form);
  };

  try {
    await cachedRead('quiz', ch.id, `/api/quiz/${encodeURIComponent(ch.id)}`, draw);
  } catch (e) {
    clear(body).appendChild(emptyState(e.status === 404 ? 'Your test is not ready yet — ask your parent. 🙂' : 'Could not load the test. Check your connection.'));
  }
}

// ---------- 📝 Test: parent — generate, review/edit, approve, answer key ----------

async function renderParentTest(body, ch) {
  clear(body).appendChild(h('p', { class: 'text-slate-400 text-sm' }, 'Loading…'));
  let data;
  try {
    data = await apiFetch(`/api/quiz/${encodeURIComponent(ch.id)}`, { silent: true });
    await idbPut('quiz', ch.id, data);
  } catch (e) {
    if (e.status !== 404) {
      data = await idbGet('quiz', ch.id);
      if (!data) { clear(body).appendChild(emptyState('Could not load questions. Check your connection.')); return; }
    }
  }
  if (!data) {
    clear(body);
    if (!ch.content_text) { body.appendChild(needsTextNote(true)); return; }
    const btn = h('button', { type: 'button', class: 'btn-primary' }, '✨ Generate questions with AI');
    btn.addEventListener('click', async () => {
      setBusy(btn, true, 'Writing questions… (~30 s)');
      try {
        const res = await saveAndCache('/api/quiz/generate', { chapter_id: ch.id }, { store: 'quiz', key: ch.id });
        renderQuizEditor(body, ch, res);
      } catch { setBusy(btn, false); }
    });
    body.append(emptyState('No questions yet. The AI writes 5 MCQs, 3 fill-in-the-blanks, 2 true/false, 2 short and 1 long question from the chapter text. You review them before your child sees anything.'), btn);
    return;
  }
  renderQuizEditor(body, ch, data);
}

function renderQuizEditor(body, ch, data) {
  clear(body);
  const status = h('span', { class: `badge ${data.approved ? 'badge-ok' : 'badge-warn'}` },
    data.approved ? 'Approved ✓ — visible to child' : 'Draft — child cannot see it yet');

  const keyToggle = h('input', { type: 'checkbox', checked: !!data.answer_key_visible });
  keyToggle.addEventListener('change', async () => {
    try {
      const res = await saveAndCache('/api/quiz/answer-key', { chapter_id: ch.id, visible: keyToggle.checked });
      data.answer_key_visible = res.answer_key_visible;
      data.updated_at = res.updated_at;
      await idbPut('quiz', ch.id, data);
    } catch { keyToggle.checked = !keyToggle.checked; }
  });

  const regen = h('button', { type: 'button', class: 'btn-danger' }, '↻ Regenerate');
  regen.addEventListener('click', async () => {
    if (!confirm('Regenerate all questions?\n\nThis uses today\'s free AI quota and replaces the current set. Your child will not see the new set until you approve it.')) return;
    setBusy(regen, true, 'Regenerating…');
    try {
      const res = await saveAndCache('/api/quiz/generate', { chapter_id: ch.id, regenerate: true }, { store: 'quiz', key: ch.id });
      renderQuizEditor(body, ch, res);
    } catch { setBusy(regen, false); }
  });

  const sections = h('div', { class: 'space-y-6' });
  for (const type of QUIZ_TYPES) sections.appendChild(renderTypeEditor(type, data.quiz[type] || []));

  const save = async approved => {
    const btn = approved ? approveBtn : draftBtn;
    setBusy(btn, true, 'Saving…');
    try {
      const res = await saveAndCache('/api/quiz/approve',
        { chapter_id: ch.id, questions: collectQuiz(sections), approved, updated_at: data.updated_at },
        { store: 'quiz', key: ch.id });
      renderQuizEditor(body, ch, res);
    } catch (e) {
      setBusy(btn, false);
      if (e.status === 409) renderParentTest(body, ch);
    }
  };
  const draftBtn = h('button', { type: 'button', class: 'btn-secondary', on: { click: () => save(false) } }, 'Save draft');
  const approveBtn = h('button', { type: 'button', class: 'btn-primary', on: { click: () => save(true) } }, data.approved ? 'Save changes ✓' : 'Approve for child ✓');

  body.append(
    h('div', { class: 'flex flex-wrap items-center justify-between gap-3 mb-4' },
      status,
      h('label', { class: 'flex items-center gap-2 text-sm' }, keyToggle, 'Show answer key to child'),
      regen),
    h('p', { class: 'text-sm text-slate-500 mb-4' }, 'Read every question. Fix anything wrong or off-syllabus, then approve.'),
    sections,
    h('div', { class: 'editor-actions' }, draftBtn, approveBtn));
}

function renderTypeEditor(type, items) {
  const list = h('div', { class: 'space-y-3' });
  const sec = h('section', { dataset: { type } },
    h('h3', { class: 'font-semibold mb-2' }, `${TYPE_TITLES[type]} (${type.replace('_', ' ')})`), list);
  const add = item => list.appendChild(renderItemEditor(type, item));
  items.forEach(add);
  sec.appendChild(h('button', { type: 'button', class: 'link text-sm mt-2', on: { click: () => add({}) } }, '+ Add question'));
  return sec;
}

function renderItemEditor(type, item) {
  const wrap = h('div', { class: 'q-edit', dataset: { type } });
  const remove = h('button', { type: 'button', class: 'icon-btn float-right', 'aria-label': 'Delete question', on: { click: () => wrap.remove() } }, '🗑');
  const field = (name, value, opts = {}) => {
    const el = opts.area ? h('textarea', { class: 'input w-full', name, rows: opts.rows || 2 }) : h('input', { class: 'input w-full', name });
    el.value = value ?? '';
    if (opts.placeholder) el.placeholder = opts.placeholder;
    return el;
  };
  wrap.appendChild(remove);
  wrap.appendChild(field(type === 'true_false' ? 'statement' : 'question', questionText(item), { area: true, placeholder: type === 'true_false' ? 'Statement' : 'Question' }));

  if (type === 'mcq') {
    const opts = [...(item.options || [])];
    while (opts.length < 4) opts.push('');
    const optInputs = opts.map((o, i) => field('option', o, { placeholder: `Option ${String.fromCharCode(65 + i)}` }));
    const answer = h('select', { class: 'input w-full', name: 'answer' });
    const refresh = () => {
      const keep = answer.value || item.answer;
      clear(answer).appendChild(h('option', { value: '' }, '— correct option —'));
      optInputs.map(i => i.value.trim()).filter(Boolean).forEach(v => answer.appendChild(h('option', { value: v, selected: v === keep }, v)));
    };
    optInputs.forEach(i => i.addEventListener('input', refresh));
    refresh();
    wrap.append(h('div', { class: 'grid gap-2 sm:grid-cols-2 my-2' }, optInputs), h('label', { class: 'text-sm' }, 'Correct answer', answer));
  } else if (type === 'true_false') {
    const sel = h('select', { class: 'input', name: 'answer' },
      h('option', { value: '' }, '— choose —'),
      h('option', { value: 'true', selected: item.answer === true }, 'True'),
      h('option', { value: 'false', selected: item.answer === false }, 'False'));
    wrap.append(h('label', { class: 'text-sm block my-2' }, 'Answer ', sel));
  } else {
    wrap.append(h('label', { class: 'text-sm block my-2' }, type === 'fill_blank' ? 'Answer (use / for alternatives)' : 'Model answer',
      field('answer', item.answer, { area: type !== 'fill_blank', rows: type === 'long' ? 4 : 2 })));
  }
  wrap.append(h('label', { class: 'text-sm block' }, 'Explanation (shown with answer key)', field('explanation', item.explanation)));
  return wrap;
}

function collectQuiz(root) {
  const quiz = {};
  for (const type of QUIZ_TYPES) {
    quiz[type] = $$(`section[data-type="${type}"] .q-edit`, root).map(el => {
      const v = n => { const f = $(`[name="${n}"]`, el); return f ? f.value.trim() : ''; };
      const base = { explanation: v('explanation') };
      if (type === 'mcq') return { ...base, question: v('question'), options: $$('[name=option]', el).map(i => i.value.trim()).filter(Boolean), answer: v('answer') };
      if (type === 'true_false') return { ...base, statement: v('statement'), answer: v('answer') === '' ? null : v('answer') === 'true' };
      return { ...base, question: v('question'), answer: v('answer') };
    }).filter(x => x.question || x.statement);
  }
  return quiz;
}

// =====================================================================
// Phase 5 — Progress dashboards + Revision Round
// =====================================================================

const charts = {};
function drawChart(key, canvas, config) {
  if (charts[key]) charts[key].destroy();
  charts[key] = new Chart(canvas, config);
}

async function fetchProgress(childId, render) {
  return cachedRead('progress', childId, `/api/progress/${encodeURIComponent(childId)}`, render);
}

function subjectTiles(subjects, simple) {
  return h('div', { class: 'grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4' }, sortBooks(subjects.map(s => ({ ...s, title: s.subject }))).map(s => {
    const pct = s.chapters ? Math.round((s.completed / s.chapters) * 100) : 0;
    return h('div', { class: 'stat-tile' },
      h('p', { class: 'font-semibold' }, `${SUBJECT_ICON[s.subject] || '📘'} ${s.subject}`),
      h('p', { class: 'text-sm text-slate-600' }, `${s.completed} / ${s.chapters} chapters`),
      h('div', { class: 'bar my-1' }, h('span', { style: `width:${pct}%` })),
      s.average === null ? h('p', { class: 'text-xs text-slate-400' }, 'no tests yet')
        : h('p', { class: 'text-xs' }, simple ? `${'⭐'.repeat(Math.max(1, Math.round(s.average / 34)))} ${s.average}%` : `avg ${s.average}%`));
  }));
}

// ---------- Parent ----------

function initParentProgress(children) {
  const panel = $('#progress-panel');
  if (!panel) return;
  if (!children.length) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');
  const sel = clear($('#progress-child'));
  children.forEach(c => sel.appendChild(h('option', { value: c.id }, c.email)));
  sel.classList.toggle('hidden', children.length < 2);
  const load = () => fetchProgress(sel.value, renderParentProgress).catch(() => {
    clear($('#progress-root')).appendChild(emptyState('Could not load progress.'));
  });
  sel.onchange = load;
  load();
}

async function renderParentProgress(p) {
  const root = clear($('#progress-root'));
  const tests = p.attempts.filter(a => a.kind === 'test' && a.score !== null);
  root.appendChild(subjectTiles(p.subjects, false));
  if (!tests.length) {
    root.appendChild(emptyState('No tests taken yet. Approve a chapter test and your child can start.'));
    return;
  }
  const lineCanvas = h('canvas', { 'aria-label': 'Scores over time' });
  const barCanvas = h('canvas', { 'aria-label': 'Average score by subject' });
  root.appendChild(h('div', { class: 'grid gap-4 md:grid-cols-2' },
    h('div', {}, h('h3', { class: 'font-semibold text-sm mb-1' }, 'Scores over time'), h('div', { class: 'chart-box' }, lineCanvas)),
    h('div', {}, h('h3', { class: 'font-semibold text-sm mb-1' }, 'Average by subject'), h('div', { class: 'chart-box' }, barCanvas))));

  const weak = h('div', { class: 'mt-4' }, h('h3', { class: 'font-semibold text-sm mb-1' }, '🎯 Needs more practice'));
  if (p.weak.length) {
    weak.appendChild(h('ul', { class: 'text-sm space-y-1' }, p.weak.map(w => h('li', {},
      h('a', { class: 'link', href: `/chapter?id=${encodeURIComponent(w.chapter_id)}#test` }, `${w.subject} · ${w.title}`),
      ` — ${w.score ?? '–'}%, ${w.wrong_count} wrong answer${w.wrong_count === 1 ? '' : 's'} to revise`))));
  } else weak.appendChild(h('p', { class: 'text-sm text-slate-500' }, 'No weak areas right now. 👏'));
  root.appendChild(weak);
  root.appendChild(h('p', { class: 'text-sm mt-2' }, `🔁 Revision questions due now: ${p.revision_due}`));

  const written = p.attempts.filter(a => a.written && a.written.length).slice(-5).reverse();
  if (written.length) {
    root.appendChild(h('details', { class: 'mt-4' },
      h('summary', { class: 'cursor-pointer font-semibold text-sm' }, '📝 Recent written answers to check'),
      written.map(a => h('div', { class: 'mt-2 text-sm' },
        h('p', { class: 'font-medium' }, `${a.subject} · ${a.title} — ${fmtDate(a.created_at)}`),
        h('ul', { class: 'pl-4 list-disc' }, a.written.map(w => h('li', {}, h('span', { class: 'text-slate-500' }, `${w.question} → `), w.answer)))))));
  }

  try {
    await loadScript(CDN.chart);
    drawChart('line', lineCanvas, {
      type: 'line',
      data: {
        labels: tests.map(t => fmtDate(t.created_at)),
        datasets: [{ label: 'Score %', data: tests.map(t => t.score), tension: .25, borderColor: '#1e3a8a', backgroundColor: '#1e3a8a' }]
      },
      options: {
        maintainAspectRatio: false,
        scales: { y: { min: 0, max: 100 } },
        plugins: { legend: { display: false }, tooltip: { callbacks: { title: items => `${tests[items[0].dataIndex].subject} · ${tests[items[0].dataIndex].title}` } } }
      }
    });
    const subs = p.subjects.filter(s => s.average !== null);
    drawChart('bar', barCanvas, {
      type: 'bar',
      data: { labels: subs.map(s => s.subject), datasets: [{ label: 'Average %', data: subs.map(s => s.average), backgroundColor: '#16a34a', maxBarThickness: 64 }] },
      options: { maintainAspectRatio: false, scales: { y: { min: 0, max: 100 } }, plugins: { legend: { display: false } } }
    });
  } catch { /* charts are a bonus; the tiles above still show the numbers */ }
}

// ---------- Child ----------

async function initChildProgress(childId) {
  const panel = $('#progress-panel');
  const byChapter = {};
  try {
    const p = await fetchProgress(childId, renderChildProgress);
    p.chapters.forEach(c => { if (c.score !== null) byChapter[c.chapter_id] = c; });
  } catch { if (panel) panel.classList.add('hidden'); }
  return byChapter;
}

async function renderChildProgress(p) {
  const panel = $('#progress-panel');
  const root = clear($('#progress-root'));
  panel.classList.remove('hidden');
  root.appendChild(subjectTiles(p.subjects, true));
  const subs = p.subjects.filter(s => s.average !== null);
  if (!subs.length) {
    root.appendChild(h('p', { class: 'text-sm text-slate-600' }, 'Finish a chapter test to earn your first stars! ⭐'));
    return;
  }
  const canvas = h('canvas', { 'aria-label': 'My scores by subject' });
  root.appendChild(h('div', { class: 'chart-box', style: 'height:180px' }, canvas));
  try {
    await loadScript(CDN.chart);
    drawChart('child', canvas, {
      type: 'bar',
      data: { labels: subs.map(s => `${SUBJECT_ICON[s.subject] || ''} ${s.subject}`), datasets: [{ data: subs.map(s => s.average), backgroundColor: '#f59e0b', borderRadius: 6, maxBarThickness: 32 }] },
      options: { maintainAspectRatio: false, indexAxis: 'y', scales: { x: { min: 0, max: 100 } }, plugins: { legend: { display: false } } }
    });
  } catch { /* tiles already show the numbers */ }
}

// ---------- Revision Round: wrong answers come back after a few days ----------

async function initRevision() {
  const panel = $('#revision-panel');
  if (!panel) return;
  let data;
  try {
    data = await apiFetch('/api/progress/revision', { silent: true });
  } catch { return; }
  const root = clear($('#revision-root'));
  if (!data.items.length) {
    if (data.upcoming) {
      panel.classList.remove('hidden');
      root.appendChild(h('p', { class: 'text-sm text-slate-600' },
        `${data.upcoming} question${data.upcoming === 1 ? '' : 's'} to practise again from ${fmtDate(data.next_due)}. Keep going! 💪`));
    } else panel.classList.add('hidden');
    return;
  }
  panel.classList.remove('hidden');
  const form = h('form', { class: 'space-y-3' });
  data.items.forEach((item, i) => {
    const name = `rev-${i}`;
    form.appendChild(h('div', { class: 'q-block', dataset: { qid: item.qid, chapter: item.chapter_id, i } },
      h('p', { class: 'text-xs text-slate-500' }, `${item.subject} · ${item.chapter_title}`),
      h('p', { class: 'font-medium mb-2' }, `${i + 1}. ${questionText(item)}`),
      renderQuestionInput(item.type, item, name)));
  });
  const submit = h('button', { type: 'submit', class: 'btn-primary' }, 'Check revision answers');
  form.appendChild(submit);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const answers = data.items.map((item, i) => ({ chapter_id: item.chapter_id, qid: item.qid, value: readAnswer(form, item.type, `rev-${i}`) }))
      .filter(a => a.value !== undefined && a.value !== '');
    if (!answers.length) { showToast('Answer at least one question', 'error'); return; }
    setBusy(submit, true, 'Checking…');
    try {
      const res = await saveAndCache('/api/progress/revision', { answers });
      submit.remove();
      $$('input, textarea', form).forEach(el => { el.disabled = true; });
      res.results.forEach(r => markResult($(`[data-qid="${r.qid}"][data-chapter="${r.chapter_id}"]`, form), r));
      form.appendChild(h('div', { class: 'score-banner' }, h('p', { class: 'font-bold' }, `${res.correct} of ${res.total} right this time!`),
        h('p', { class: 'text-sm' }, 'Correct ones are cleared. The rest come back in a few days.')));
    } catch { setBusy(submit, false); }
  });
  root.append(h('p', { class: 'text-sm text-slate-600 mb-3' }, `Let's try these again (${data.due} due).`), form);
}

// =====================================================================
// Phase 6 — Service worker (static shell only; /api is never cached there)
// =====================================================================

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
  navigator.serviceWorker.register('/sw.js').catch(() => { /* app works without it */ });
}
