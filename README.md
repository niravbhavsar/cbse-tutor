# cbse-tutor

CBSE Personal Tutor (Grade 4) — plain HTML/CSS/JS on Cloudflare Pages + Pages Functions + D1.
No framework, no bundler, no npm build step. See [PROJECT.md](PROJECT.md) for the full spec.

## Status: Phases 0–6 implemented

| Phase | What you get |
|---|---|
| 0 | Pages + D1 skeleton, `/api/ping` health panel |
| 1 | Parent signup/login (first user = parent), child accounts, HttpOnly server sessions (per device), books seeded from `books.json`, JSON export/import |
| 2 | Book capture: camera/photo → Tesseract.js OCR in the browser (Workers AI vision fallback) → fuzzy match → duplicate detection by fingerprint |
| 3 | Chapter text, AI quiz generation (Workers AI, cached in D1), parent review/edit, **mandatory approval**, answer key hidden by default |
| 4 | Learning tabs: 🧠 Visual mind map (Mermaid), 🔬 Practical activity, 🎮 Matching game (drag or tap-tap, works on touch) |
| 5 | Child tests graded on the server, attempts log, Revision Round (wrong answers return after `REVISION_DAYS`), parent dashboard with Chart.js |
| 6 | Service worker (static shell only), weekly D1 → R2 backup Worker |

### Files

| Path | Purpose |
|---|---|
| `index.html`, `parent.html`, `child.html`, `chapter.html` | Pages (served extensionless: `/parent`, `/child`, `/chapter?id=…`) |
| `app.js` | All front-end JS: `apiFetch`, `saveAndCache`, IndexedDB cache, toasts, pages |
| `style.css` | Custom styles beyond Tailwind CDN |
| `sw.js` | Service worker — caches static files; never `/api/*` |
| `functions/api/**` | Pages Functions (REST API on D1 / Workers AI / R2) |
| `schema.sql` | Full D1 schema (idempotent) |
| `migrations/0001_phase1_additions.sql` | Only for databases created during Phase 0 |
| `backup-worker/` | Separate tiny Worker with the weekly cron backup |
| `books.json` | Grade 4 NCERT seed: Santoor, Maths Mela, Our Wondrous World, Veena |

## One-time Cloudflare setup

```bash
npm install -g wrangler         # CLI only — the app itself has no npm build
wrangler login

# 1. D1
wrangler d1 create app-db       # copy database_id into wrangler.toml (and backup-worker/wrangler.toml)
wrangler d1 execute app-db --remote --file=schema.sql
```

If your D1 database was created during **Phase 0**, also run:

```bash
wrangler d1 execute app-db --remote --file=migrations/0001_phase1_additions.sql
```
(`schema.sql` is safe to re-run; the migration adds the `quiz_cache.updated_at` column that `CREATE TABLE IF NOT EXISTS` cannot add.
If it says "duplicate column", it was already applied.)

2. Cloudflare dashboard → Workers & Pages → Create → Pages → **Connect to Git** → pick this repo.
   - Framework preset: **None**
   - Build command: *(leave empty)*
   - Build output directory: `.`
   Bindings (D1 `DB`, Workers AI `AI`, vars) are read from `wrangler.toml`.
3. Open the site, create the **parent** account (the very first signup), then add child accounts from the parent page.
   Tap **“+ Add any missing NCERT books”** to seed the four Grade 4 books.

### Optional settings (`[vars]` in `wrangler.toml` or dashboard → Settings → Variables)

| Variable | Default | Meaning |
|---|---|---|
| `GRADE` | `4` | Grade used for books and prompts |
| `REVISION_DAYS` | `3` | Days before a wrong answer comes back in the Revision Round |
| `AI_TEXT_MODEL` | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | Quiz / learning generation model |
| `AI_VISION_MODEL` | `@cf/meta/llama-3.2-11b-vision-instruct` | OCR fallback model |
| `AI_MOCK` | *(unset)* | **Local only.** `1` returns canned AI output so you can test without quota |

## Backups (Phase 6)

Three independent layers, all restorable:

1. **Export JSON** (parent page → Data safety). Download any time; **Import JSON** upserts it back
   (safe to import twice, keeps foreign keys valid). Sessions are never exported.
2. **Weekly R2 backup** — `backup-worker/` runs every Sunday 20:00 UTC and writes
   `backups/YYYY-MM-DD/<timestamp>-weekly.json` to the R2 bucket. The parent page's
   **Back up to R2 now** button does the same on demand (returns 503 until R2 is bound).
3. **D1 Time Travel** — Cloudflare keeps 30 days of point-in-time history:
   `wrangler d1 time-travel restore app-db --timestamp=<ISO time>`.

> **R2 note:** Cloudflare requires a card or PayPal on file to activate R2, even for the free tier.
> Everything except layer 2 works without it. To enable it:
> ```bash
> wrangler r2 bucket create cbse-tutor-backup
> # uncomment [[r2_buckets]] in wrangler.toml (enables "Back up to R2 now")
> cd backup-worker && wrangler deploy      # put the D1 database_id in backup-worker/wrangler.toml first
> ```
> Restore from R2: dashboard → R2 → `cbse-tutor-backup` → download the JSON → parent page → **Import JSON**.

## Verification checklist

1. `https://<project>.pages.dev` — status panel shows three green dots; `/api/ping` has `"missing": []`.
2. Sign up (parent), add a child, log in as the child on another device — both stay logged in; logging out one device doesn't affect the other.
3. Parent: capture a book cover → OCR matches it; capturing the same book again says “already added”.
4. Parent: open a chapter → paste/save text → **Generate quiz** → edit → **Approve**. The child can't see the test until it is approved.
   The answer key stays hidden from the child until **Show answer key** is turned on.
5. Parent: generate 🧠 / 🔬 / 🎮 learning; the child sees the mind map and can play the matching game by dragging or tapping.
6. Child: take the test → score shown and saved (“Saved ✓”). Parent dashboard shows the score on the charts.
7. Wrong answers appear under 🔁 Revision Round after `REVISION_DAYS`.
8. Edit the same chapter on two devices — the second save gets “changed on another device” instead of overwriting.
9. Turn off Wi-Fi: pages still open from the service worker and show cached data; saves fail with “Not saved ✗”.

## Notes

- **D1 is the source of truth.** Writes go to the server first; IndexedDB is only updated after a 2xx.
  The service worker never caches `/api/*`.
- Bump `VERSION` in `sw.js` when you change `app.js`/`style.css`/HTML so devices pick up the update quickly
  (stale-while-revalidate means they update on the next visit anyway).
- NCERT-API / Oriz-PDF import hooks: the `source` values `ncert-api` and `oriz-pdf` are accepted by
  `POST /api/books`, but no automatic fetchers are enabled (no stable free API exists). Books come from
  `books.json` or capture.
- The Llama 3.2 vision model needs a one-time licence acceptance; `_ai.js` sends `agree` automatically.

## Local dev

```bash
wrangler pages dev .                           # local sandbox D1 (separate from production)
wrangler d1 execute app-db --file=schema.sql   # schema for the local sandbox
echo 'AI_MOCK=1' > .dev.vars                   # optional: canned AI responses
```
Use `--remote` flags when you need real production data (PROJECT.md 8.4).
