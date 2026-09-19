import http from 'node:http';
import express from 'express';
import WebSocket, { WebSocketServer } from 'ws';

/* ------------------------------------------------------------------ *
 * 1. Config
 * ------------------------------------------------------------------ */
const API_KEY = process.env.AISSTREAM_API_KEY;
const AIS_URL = process.env.AIS_URL || 'wss://stream.aisstream.io/v0/stream';
const PORT = Number(process.env.PORT) || 3000;
const BOUNDING_BOXES = JSON.parse(process.env.BOUNDING_BOXES || '[[[48,-6],[56,10]]]');
const STALE_MS = (Number(process.env.STALE_MINUTES) || 60) * 60_000;
const LOG_SAMPLES = process.env.LOG_SAMPLES === '1';

const FLUSH_MS = 1000; // how often we push batched updates to browsers
const TRAIL_SPACING_MS = 60_000; // store at most one trail point per vessel per minute
const MAX_TRAIL_POINTS = 180; // ~3 hours of trail

if (!API_KEY) {
  console.error('Missing AISSTREAM_API_KEY. Copy env.example to .env and set it.');
  process.exit(1);
}

/* ------------------------------------------------------------------ *
 * 2. In-memory vessel store
 * ------------------------------------------------------------------ */
const vessels = new Map(); // mmsi (string) -> vessel object
const trails = new Map(); // mmsi (string) -> [[lon, lat, timestampMs], ...]
const dirty = new Set(); // mmsis changed since the last flush to browsers

/* ------------------------------------------------------------------ *
 * 3. AIS message handling
 * ------------------------------------------------------------------ */
const POSITION_TYPES = new Set([
  'PositionReport', // Class A (big ships)
  'StandardClassBPositionReport', // Class B (smaller boats)
  'ExtendedClassBPositionReport',
]);

const SUBSCRIBED_TYPES = [
  ...POSITION_TYPES,
  'ShipStaticData', // Class A name, type, destination, dimensions
  'StaticDataReport', // Class B name, type
];

// AIS pads text with '@' and spaces
const cleanText = (s) => {
  const t = typeof s === 'string' ? s.replace(/@+/g, ' ').trim() : '';
  return t || undefined;
};

// AIS uses sentinel values for "not available"
const sog = (v) => (Number.isFinite(v) && v < 102.3 ? v : null); // knots
const cog = (v) => (Number.isFinite(v) && v < 360 ? v : null); // degrees
const heading = (v) => (Number.isFinite(v) && v < 360 ? v : null); // degrees (511 = n/a)

// Ship type codes: https://api.vtexplorer.com/docs/ref-aistypes.html
function shipCategory(t) {
  if (!Number.isFinite(t) || t === 0) return 'unknown';
  if (t === 30) return 'fishing';
  if (t === 31 || t === 32) return 'towing';
  if (t === 35) return 'military';
  if (t === 36) return 'sailing';
  if (t === 37) return 'pleasure';
  if (t >= 40 && t <= 49) return 'highspeed';
  if (t >= 50 && t <= 59) return 'service'; // pilot, SAR, tug, port tender...
  if (t >= 60 && t <= 69) return 'passenger';
  if (t >= 70 && t <= 79) return 'cargo';
  if (t >= 80 && t <= 89) return 'tanker';
  return 'other';
}

/* ------------------------------------------------------------------ *
 * 4. Upstream connection with reconnect + stall watchdog
 * ------------------------------------------------------------------ */
let backoffMs = 1000;
let lastMessageAt = 0;
let upstream = null;
let msgCount = 0;

function connectAIS() {
  console.log(`[ais] connecting to ${AIS_URL}`);
  const ws = new WebSocket(AIS_URL);
  upstream = ws;

  ws.on('open', () => {
    console.log('[ais] connected, subscribing');
    backoffMs = 1000;
    lastMessageAt = Date.now();
    // The subscription must be sent right after connecting or the server drops us
    ws.send(
      JSON.stringify({
        APIKey: API_KEY,
        BoundingBoxes: BOUNDING_BOXES, // [[lat, lon], [lat, lon]] corners
        FilterMessageTypes: SUBSCRIBED_TYPES,
      }),
    );
  });

  ws.on('message', (raw) => {
    lastMessageAt = Date.now();
    msgCount++;
    try {
      handleMessage(JSON.parse(raw.toString()));
    } catch (err) {
      console.error('[ais] failed to handle message:', err.message);
    }
  });

  ws.on('error', (err) => console.error('[ais] socket error:', err.message));

  ws.on('close', (code) => {
    console.warn(`[ais] closed (${code}), reconnecting in ${backoffMs / 1000}s`);
    setTimeout(connectAIS, backoffMs);
    backoffMs = Math.min(backoffMs * 2, 30_000);
  });
}

// If the socket is open but silent for 2 minutes, kill it so 'close' triggers a reconnect
setInterval(() => {
  if (upstream?.readyState === WebSocket.OPEN && Date.now() - lastMessageAt > 120_000) {
    console.warn('[ais] no data for 2 minutes, forcing reconnect');
    upstream.terminate();
  }
}, 30_000);

/* ------------------------------------------------------------------ *
 * 5. HTTP API + static files
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * 6. Live push to browsers over WebSocket (/live)
 * ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ *
 * Go
 * ------------------------------------------------------------------ */
server.listen(PORT, () => {
  console.log(`[http] listening on http://localhost:${PORT}  (WebSocket at /live)`);
  connectAIS();
});
