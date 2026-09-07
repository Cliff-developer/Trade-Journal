# Ledger — Pictorial Trade Journal

A companion app to Sovereignty: log trades as multi-image breakdowns (up to 6
screenshots each), browse them on a calendar heatmap, and view the whole
journal from your phone — no server, no accounts, just a GitHub repo acting
as the shared store.

**Theme:** same "Ledger Noir" identity as Sovereignty — ink-black panels,
platinum accent, Sora for display type, JetBrains Mono for numbers.

## How the sync works

- **Laptop (edit mode):** you enter a GitHub personal access token in
  Settings. The app then writes directly to your repo via the GitHub API —
  every trade you log or image you upload becomes a commit.
- **Phone (view-only mode):** leave the token blank. The app reads the same
  repo's public raw files (`trades.json` + `images/`) — no login needed.
- The repo itself is the sync layer. As long as it's public, any device with
  the app installed and pointed at the same `owner/repo` sees the same data.

## One-time setup

1. Create a new **public** GitHub repo (e.g. `trade-journal`).
2. Deploy this folder to GitHub Pages (same steps as Sovereignty):
   ```
   git init
   git add .
   git commit -m "Ledger pictorial trade journal"
   git branch -M main
   git remote add origin https://github.com/<your-username>/trade-journal.git
   git push -u origin main
   ```
3. In the repo: **Settings → Pages → Build and deployment → Source** →
   Deploy from a branch → `main` → `/ (root)`. Save.
4. Visit `https://<your-username>.github.io/trade-journal/` — first deploy
   can take a minute.
5. **On your laptop:** open the app → Settings → fill in your GitHub
   username, the repo name, and a **personal access token**:
   - GitHub → Settings → Developer settings → Personal access tokens →
     generate a classic token with the `repo` scope (or a fine-grained token
     with read/write access to Contents for this one repo).
   - Save settings. The header should now say **edit mode** and the "Add
     Trade" tab unlocks.
6. **On your phone:** open the same URL, install it to your home screen
   (Android: ⋮ menu → *Add to Home screen*; iPhone: Share → *Add to Home
   Screen*), then go to Settings and fill in just the username and repo —
   **leave the token blank**. It'll show **view-only**.

## What's inside

- **Calendar** — a monthly grid; days with trades are tinted green/red by net
  PnL and show a peek of that day's first screenshot. Tap a day to see the
  full trade breakdown underneath.
- **Trades** — every logged trade, newest first.
- **Add Trade** (laptop only) — instrument, direction, open/close price,
  volume, contract size, leverage, tags, notes, and up to 6 images. PnL,
  margin, and RoM compute live as you type, using the same math as
  Sovereignty:
  ```
  Position Value = Contract Size × Volume × Open Price
  Margin          = Position Value ÷ Leverage
  PnL (Long)      = (Close − Open) × Contract Size × Volume
  PnL (Short)     = (Open − Close) × Contract Size × Volume
  Return on Margin (RoM) = PnL ÷ Margin × 100
  ```
- **Settings** — where the repo pointer and token live.

## Notes and limitations

- Images are compressed client-side (max 1600px wide, JPEG ~82% quality)
  before upload, to keep the repo light.
- Deleting a trade removes it from the journal list but currently leaves its
  image files in the repo (safe, just unused storage — you can clean the
  `images/` folder manually if it matters to you).
- Because writes go straight to GitHub's API from the browser, edit mode
  needs an internet connection. View mode also needs a connection (it's
  reading live from GitHub, not from a local cache) — there's no offline
  journal browsing yet.
- The token is stored only in that browser's `localStorage`. Don't use edit
  mode on a shared/public computer.

## File map

```
index.html            the whole UI (Calendar / Trades / Add / Settings)
style.css             Ledger Noir theme
app.js                state, GitHub sync, PnL calc, calendar rendering
manifest.json         PWA install metadata
service-worker.js     app-shell caching (GitHub requests are never cached)
icons/                app icons
```
