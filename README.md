# cbse-tutor

CBSE Personal Tutor — plain HTML/CSS/JS on Cloudflare Pages + Pages Functions + D1.
No framework, no bundler, no npm build step. See [PROJECT.md](PROJECT.md) for the full spec.

## Status: Phase 0 (Setup)

| File | Purpose |
|---|---|
| `index.html` | Landing / login shell + live system-status panel |
| `app.js` | Shared JS (`apiFetch`, `showToast`, health check) |
| `style.css` | Custom styles beyond Tailwind CDN |
| `functions/api/ping.js` | `GET /api/ping` → `{ ok: true, d1: { tables, missing } }` |
| `schema.sql` | D1 schema (Section 5) |
| `books.json` | Grade 4 seed: Santoor (English), Maths Mela, Our Wondrous World (EVS), Veena (Hindi) |
| `wrangler.toml` | Pages config + D1 / AI bindings |

## One-time Cloudflare setup

```bash
npm install -g wrangler         # CLI only — the app itself has no npm build
wrangler login

# 1. D1
wrangler d1 create app-db       # copy database_id into wrangler.toml
wrangler d1 execute app-db --remote --file=schema.sql

# 2. R2 (needs a payment method on the Cloudflare account — see note)
wrangler r2 bucket create cbse-tutor-backup   # then uncomment [[r2_buckets]] in wrangler.toml
```

3. Cloudflare dashboard → Workers & Pages → Create → Pages → **Connect to Git** → pick this repo.
   - Framework preset: **None**
   - Build command: *(leave empty)*
   - Build output directory: `.`
   Bindings are read from `wrangler.toml`.

> **R2 note:** Cloudflare requires a card or PayPal on file to activate R2, even for the free tier.
> R2 is only needed in Phase 6 (weekly backup), so its binding is commented out and Phase 0 works without it.

## Phase 0 verification

1. Open `https://<project>.pages.dev` — the status panel should show three green dots.
2. `https://<project>.pages.dev/api/ping` returns `{"ok":true, ...}` with `"missing": []`.
3. `wrangler d1 execute app-db --remote --command="SELECT name FROM sqlite_master WHERE type='table'"`

## Local dev

```bash
wrangler pages dev .                 # local sandbox D1 (separate from production)
wrangler d1 execute app-db --file=schema.sql   # schema for the local sandbox
```
Use `--remote` flags when you need real production data (PROJECT.md 8.4).
