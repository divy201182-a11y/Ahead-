# Ahead — real-time road intelligence

Landing page + an installable app that watches your routes for traffic and weather and pushes alerts to your phone —
before you leave and while you drive. Vanilla HTML / CSS / JavaScript (ES modules), Node server, one dependency (`web-push`).

## Run it

```bash
npm install
npm start
```

- Website: http://localhost:5173 · App: http://localhost:5173/app (Node 18+)
- Tests: `npm test`

## Setup (.env)

Copy `.env.example` to `.env`:

```
TOMTOM_API_KEY=your_key     # free at developer.tomtom.com — tick Traffic, Map Display, Routing and Search APIs
APP_PASSCODE=1234           # optional: an extra passcode before the login screen
AHEAD_COUNTRY=IN            # optional: place search prefers this country (default IN; empty = worldwide)
AHEAD_SIGNUPS=closed        # optional: stop new sign-ups (existing accounts can still log in)
```

## Accounts

Everyone signs up with name, email and password and gets their own routes, alerts, trips and phone
notifications. Passwords are stored as salted scrypt hashes; sessions are HttpOnly cookies (30 days);
5 wrong passwords in 15 minutes block that email from that address for a while. Log out and Delete account are
under Settings › Privacy & Security.

**The first account to sign up takes over the data from before accounts existed** (the single-user
`data/ahead.json`). A copy of that file was kept as `data/ahead.backup-before-accounts.json`.

Restart `npm start` after changing `.env`. The terminal confirms "TomTom key loaded".

| TomTom API on your key | What it powers |
|---|---|
| Traffic API | live congestion + incidents, traffic colours on maps |
| Map Display API | the dark street map |
| Routing API | routes: travel time, delay, jams/closures on your route (**required for the app's alerts**) |
| Search API | address and place search (without it, search falls back to cities/localities only) |

## Use it on your phone (push notifications)

Push notifications need a secure https link, so the phone can't use `http://<laptop-ip>`.

1. Keep `npm start` running.
2. In a second terminal: `npm run tunnel` (Cloudflare's free quick tunnel; it uses `tools/cloudflared.exe`, or a
   system-wide `cloudflared`). It prints `https://….trycloudflare.com/app`.
3. Open that link on the phone and log in → **Install app** (Android Chrome menu) or **Share → Add to Home Screen**
   (iPhone Safari, iOS 16.4+) → open Ahead from the home screen.
4. **Settings → Notifications → Push notifications → Turn on**, then **Send test**.

The link is public while the tunnel runs: anyone who has it can create an account (`AHEAD_SIGNUPS=closed` stops that).
It changes each time you start the tunnel; the phone keeps its subscription as long as the server's data file is kept.

While Ahead is open, new alerts also slide down as an in-app pop-up. **Settings › General › Appearance** switches
between Light, Dark and Match device (saved per device).

## What the app does

- **Home** — current/next trip, the **Ahead Score** (0–100 from delay, jams, road works/closures and weather on the
  route), road intelligence at a glance, and a Route Overview map with TomTom's alternatives to choose from.
- **Plan Route** — from, to, an optional stop, and leave now / in 15 / 30 / 45 min (predicted traffic). Find Routes
  compares up to three real routes (Fastest, Alternative, Shortest). A chosen alternative is saved as a stop on the way,
  so the watcher keeps checking that road.
- **Routes** — saved routes with All / Fastest / Safest / Low Traffic. Titles always come from the real start and end.
- **Trips** — each finished trip is kept (time, distance, traffic delay, alerts) with insights per day/week/month.
- **Road Intelligence** — traffic, weather, incidents, road works and the next 50 km stretch by stretch.
- **Vehicle & profile** — vehicle name, fuel, gearbox and type (car or two-wheeler routing), saved places, and up to
  five emergency contacts with a Call button. No accounts: everything stays on your Ahead server.
- **Watcher** (server, every minute) — from *departure − 15/30/45 min* to *departure + 20 min* it checks each route every
  5 minutes (TomTom traffic-aware routing + Open-Meteo weather along the route); during a trip, every 2 minutes from your
  live position. Trips end on arrival (within 250 m) or after 3 hours.
- **Alerts** (push + Alerts tab): leave-now briefing ("Leave by 08:52 · +14 min"), delay grew/cleared by your threshold
  (5/10/15 min), new closures or road works, heavy rain / fog / wind / storms on the route, and during trips
  "Jam in 3.2 km · +6 min" for what's ahead. One alert per route per 10 minutes; quiet hours keep them silent.
- **Location** — only with your permission, only while the trip screen is open; only the latest position is stored and
  it's deleted when the trip ends.
- **Your data** stays in `data/ahead.json` on this machine (git-ignored, never served).

## Website (landing page)

Live console with real weather (Open-Meteo), live TomTom traffic + traffic map, and a simulated traffic fallback without a key.
Stats on the page (18 min saved, 2.4 km, etc.) are placeholder marketing copy.

## Structure

```
server.js                ← HTTP server: site, app shell + PWA files, /api/traffic, /api/tiles, /api/app/*, watcher
server/
  store.js               ← JSON data file (serialized, atomic writes)
  routing.js · check.js  ← TomTom routing → RouteCheck; + weather, 60 s cache
  places.js · weather.js ← place search (TomTom / Open-Meteo), weather hazards along a route
  rules.js               ← alert rules (pure, unit-tested)
  watcher.js · push.js   ← background checks; Web Push (VAPID keys generated on first run)
  api.js · auth.js       ← app API; optional passcode gate
  traffic.js · tiles.js  ← landing-page traffic summary; TomTom tile proxy
app.html                 ← app shell
src/app/                 ← the app: main.js, router, api/state, push + location helpers, sw.js, manifest
  components/            ← Shell, RouteForm, PlaceInput, RouteMap, RouteCard, AlertRow, ui (fields, chips, toasts)
  pages/                 ← welcome, home, routes, route-detail, route-edit, trip, alerts, profile, settings, unlock
src/ (site)              ← config.js (copy), components/, sections/, lib/, styles/ (tokens.css = design tokens)
scripts/tunnel.mjs       ← npm run tunnel
tests/                   ← node:test suites (rules, watcher, push, API, routing, places, weather, store, time)
docs/superpowers/        ← design spec and implementation plan
```
