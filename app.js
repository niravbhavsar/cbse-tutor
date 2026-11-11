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

async function getMe() {
  try {
    return await apiFetch('/api/me', { silent: true });
  } catch {
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
