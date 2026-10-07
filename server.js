// Ahead local server: landing page + app (static files), the app API, live traffic + map tiles,
// and the background watcher that sends push alerts.
// Usage: npm start  ->  http://localhost:5173  (app at /app)
//
// .env: TOMTOM_API_KEY=your_key (Traffic, Maps, Routing, Search APIs) · optional APP_PASSCODE=1234
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { trafficReply } from './server/traffic.js';
import { fetchTile, TileError } from './server/tiles.js';
import { createStore } from './server/store.js';
import { createApi } from './server/api.js';
import { createGate } from './server/auth.js';
import { ensureVapid } from './server/push.js';
import { createServices } from './server/services.js';
import { startWatcher } from './server/watcher.js';
import { ROOT_DEFAULTS, migrateData } from './server/accounts.js';
import { ownerEmails } from './server/owner.js';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
loadEnv(join(ROOT, '.env'));

const PORT = Number(process.env.PORT) || 5173;
const HOST = process.env.HOST || '127.0.0.1';
const TOMTOM_KEY = (process.env.TOMTOM_API_KEY || '').trim();

// Accounts and everyone's data, push keys and the watcher. A single-user file from before
// accounts is kept for the first account that signs up.
const store = createStore(process.env.AHEAD_DATA || join(ROOT, 'data', 'ahead.json'), ROOT_DEFAULTS, migrateData);
await ensureVapid(store);
// Real route check; on the demo route the scripted jam, road works and rain are added on top.
const services = createServices({ key: TOMTOM_KEY });
const { check, options, nearby } = services;
// Push an alert to one person's devices, signed with the server's push keys.
const push = (alert, user) => services.push(alert, user, store.get().vapid);
const watcher = startWatcher({ store, check, push });
const gate = createGate(process.env.APP_PASSCODE);
// Place search prefers this country (ISO code); set AHEAD_COUNTRY= (empty) for worldwide.
const country = (process.env.AHEAD_COUNTRY ?? 'IN').trim().toUpperCase();
// Anyone with the link can create an account; AHEAD_SIGNUPS=closed stops new sign-ups.
const signups = (process.env.AHEAD_SIGNUPS ?? 'open').trim().toLowerCase() !== 'closed';
// The app owner (AHEAD_OWNER_EMAILS, comma-separated) sees the Owner dashboard: who is online, sign-ups, log-ins.
const api = createApi({ store, key: TOMTOM_KEY, check, options, nearby, country, push, gate, poke: watcher.poke, signups, ownerEmails: ownerEmails(process.env.AHEAD_OWNER_EMAILS) });

// PWA files live in src/app but must be served from /app/ so the service worker can control /app.
const APP_FILES = {
  '/app/sw.js': join(ROOT, 'src', 'app', 'sw.js'),
  '/app/manifest.webmanifest': join(ROOT, 'src', 'app', 'manifest.webmanifest'),
};

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

// Only these are ever served to the browser — never .env, data, server code or package files.
const PUBLIC = [join(ROOT, 'index.html'), join(ROOT, 'app.html'), join(ROOT, 'src') + sep];

/** Minimal .env loader (KEY=value lines, # comments). Real environment variables win. */
function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || line.trim().startsWith('#')) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}

async function resolveFile(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, '');
  if (clean.split(/[/\\]/).some((part) => part.startsWith('.'))) return null; // no dotfiles
  const file = join(ROOT, clean);
  try {
    const info = await stat(file);
    const target = info.isDirectory() ? join(file, 'index.html') : file;
    return PUBLIC.some((p) => target === p || target.startsWith(p)) ? target : null;
  } catch {
    return extname(clean) ? null : join(ROOT, 'index.html'); // SPA-style fallback
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function handleTraffic(url, res) {
  return sendJson(res, ...(await trafficReply(url.searchParams, TOMTOM_KEY)));
}

async function handleTile(match, res) {
  if (!TOMTOM_KEY) return sendJson(res, 503, { error: 'no_key' });
  const [, layer, z, x, y] = match;
  try {
    const tile = await fetchTile({ layer, z, x, y, key: TOMTOM_KEY });
    res.writeHead(200, { 'Content-Type': tile.contentType, 'Cache-Control': `public, max-age=${tile.maxAge}` });
    res.end(tile.body);
  } catch (err) {
    if (err instanceof TileError) return sendJson(res, err.status, { error: err.code });
    return sendJson(res, 502, { error: 'upstream' });
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');

  if (url.pathname === '/api/config') return sendJson(res, 200, { liveTraffic: Boolean(TOMTOM_KEY) });
  if (url.pathname === '/api/traffic') return handleTraffic(url, res);
  const tile = url.pathname.match(/^\/api\/tiles\/((?:base|flow|incidents)(?:-light)?)\/(\d+)\/(\d+)\/(\d+)$/);
  if (tile) return handleTile(tile, res);
  if (url.pathname.startsWith('/api/app/')) return api(req, res, url);

  // The app lives under /app/ (its PWA scope); send the bare /app there so it's always in scope.
  if (url.pathname === '/app') {
    res.writeHead(301, { Location: `/app/${url.search}` }).end();
    return;
  }
  // PWA files, then any /app/… route → the app shell (client-side routing)
  const appFile = APP_FILES[url.pathname];
  const isAppRoute = url.pathname === '/app' || (url.pathname.startsWith('/app/') && !extname(url.pathname));
  const file = appFile || (isAppRoute ? join(ROOT, 'app.html') : await resolveFile(url.pathname));
  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}).listen(PORT, HOST, () => {
  console.log(`\n  Ahead is running →  http://localhost:${PORT}`);
  console.log(`  App: http://localhost:${PORT}/app${gate.enabled ? ' (passcode protected)' : ''}`);
  console.log(`  Live traffic: ${TOMTOM_KEY ? 'TomTom key loaded' : 'off (no TOMTOM_API_KEY) — using simulated feed'}\n`);
});
