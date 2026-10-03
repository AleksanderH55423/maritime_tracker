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

/**
 * Merge a partial update into a vessel. `undefined` means "this message didn't
 * tell us" and is skipped. `null` means "explicitly unknown" and overwrites.
 * This is what lets position and static messages, which arrive separately,
 * build up one complete record per MMSI.
 */
function upsert(mmsi, patch) {
  const v = vessels.get(mmsi) ?? { mmsi };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) v[key] = value;
  }
  v.updatedAt = Date.now();
  vessels.set(mmsi, v);
  dirty.add(mmsi);
  return v;
}

function addTrailPoint(mmsi, lat, lon) {
  const trail = trails.get(mmsi) ?? [];
  const last = trail.at(-1);
  const now = Date.now();
  if (!last || now - last[2] >= TRAIL_SPACING_MS) {
    trail.push([lon, lat, now]);
    if (trail.length > MAX_TRAIL_POINTS) trail.shift();
    trails.set(mmsi, trail);
  }
}

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

function formatEta(eta) {
  if (!eta || !eta.Month || !eta.Day) return undefined; // 0 = not available
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(eta.Month)}-${pad(eta.Day)} ${pad(eta.Hour ?? 0)}:${pad(eta.Minute ?? 0)} UTC`;
}

function handlePosition(msg) {
  const p = msg.Message[msg.MessageType];
  const lat = p.Latitude;
  const lon = p.Longitude;
  // 91 / 181 are AIS "not available" values, so this also filters those
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return;

  const mmsi = String(p.UserID ?? msg.MetaData?.MMSI);
  const isExtended = msg.MessageType === 'ExtendedClassBPositionReport';

  upsert(mmsi, {
    name: cleanText(msg.MetaData?.ShipName) ?? (isExtended ? cleanText(p.Name) : undefined),
    lat,
    lon,
    sog: sog(p.Sog),
    cog: cog(p.Cog),
    heading: heading(p.TrueHeading),
    navStatus: p.NavigationalStatus, // only present on Class A
    shipType: isExtended ? p.Type : undefined,
    category: isExtended ? shipCategory(p.Type) : undefined,
    positionAt: Date.now(),
  });
  addTrailPoint(mmsi, lat, lon);
}

function handleShipStatic(msg) {
  const s = msg.Message.ShipStaticData;
  const d = s.Dimension;
  const length = d ? d.A + d.B : 0;
  const beam = d ? d.C + d.D : 0;

  upsert(String(s.UserID), {
    name: cleanText(s.Name) ?? cleanText(msg.MetaData?.ShipName),
    imo: s.ImoNumber || undefined,
    callSign: cleanText(s.CallSign),
    shipType: s.Type,
    category: shipCategory(s.Type),
    destination: cleanText(s.Destination),
    eta: formatEta(s.Eta),
    draught: s.MaximumStaticDraught || undefined,
    length: length > 0 ? length : undefined,
    beam: beam > 0 ? beam : undefined,
  });
}

// Class B static data arrives in two parts (A = name, B = type/callsign/dimensions).
// Written defensively: check field names against the AISStream docs if names don't show up.
function handleClassBStatic(msg) {
  const r = msg.Message.StaticDataReport;
  const type = r.ReportB?.ShipType;
  upsert(String(r.UserID), {
    name: cleanText(r.ReportA?.Name),
    callSign: cleanText(r.ReportB?.CallSign),
    shipType: type,
    category: type !== undefined ? shipCategory(type) : undefined,
  });
}

const seenTypes = new Set();

function handleMessage(msg) {
  if (msg.error) {
    console.error('[ais] server error:', msg.error);
    return;
  }
  if (LOG_SAMPLES && !seenTypes.has(msg.MessageType)) {
    seenTypes.add(msg.MessageType);
    console.log(`[sample] ${msg.MessageType}:\n${JSON.stringify(msg, null, 2)}`);
  }
  if (POSITION_TYPES.has(msg.MessageType)) handlePosition(msg);
  else if (msg.MessageType === 'ShipStaticData') handleShipStatic(msg);
  else if (msg.MessageType === 'StaticDataReport') handleClassBStatic(msg);
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
const app = express();

// Permissive CORS so a frontend on another port (Vite, etc.) can call this in dev
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  next();
});

app.use(express.static('public')); // drop your globe frontend in ./public

const hasPosition = (v) => v.lat !== undefined && v.lon !== undefined;

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    upstreamConnected: upstream?.readyState === WebSocket.OPEN,
    vessels: vessels.size,
    messagesReceived: msgCount,
    secondsSinceLastMessage: lastMessageAt ? Math.round((Date.now() - lastMessageAt) / 1000) : null,
  });
});

// GET /api/vessels?bbox=minLat,minLon,maxLat,maxLon&category=cargo
app.get('/api/vessels', (req, res) => {
  let list = [...vessels.values()].filter(hasPosition);

  if (req.query.bbox) {
    const [minLat, minLon, maxLat, maxLon] = String(req.query.bbox).split(',').map(Number);
    if ([minLat, minLon, maxLat, maxLon].some((n) => !Number.isFinite(n))) {
      return res.status(400).json({ error: 'bbox must be minLat,minLon,maxLat,maxLon' });
    }
    // Note: doesn't handle boxes crossing the antimeridian (lon 180)
    list = list.filter((v) => v.lat >= minLat && v.lat <= maxLat && v.lon >= minLon && v.lon <= maxLon);
  }
  if (req.query.category) {
    list = list.filter((v) => v.category === req.query.category);
  }

  res.json({ count: list.length, vessels: list });
});

// GET /api/vessels/:mmsi -> full record + trail (used by the click panel)
app.get('/api/vessels/:mmsi', (req, res) => {
  const v = vessels.get(req.params.mmsi);
  if (!v) return res.status(404).json({ error: 'vessel not found' });
  res.json({ ...v, trail: trails.get(v.mmsi) ?? [] });
});

/* ------------------------------------------------------------------ *
 * 6. Live push to browsers over WebSocket (/live)
 * ------------------------------------------------------------------ */
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/live' });

const send = (client, obj) => client.readyState === WebSocket.OPEN && client.send(JSON.stringify(obj));

wss.on('connection', (client) => {
  send(client, { type: 'snapshot', vessels: [...vessels.values()].filter(hasPosition) });
});

// Batch changes and flush once a second instead of relaying every message
setInterval(() => {
  if (dirty.size === 0) return;
  const batch = [...dirty].map((m) => vessels.get(m)).filter((v) => v && hasPosition(v));
  dirty.clear();
  if (batch.length === 0 || wss.clients.size === 0) return;
  for (const client of wss.clients) send(client, { type: 'update', vessels: batch });
}, FLUSH_MS);

/* ------------------------------------------------------------------ *
 * 7. Prune stale vessels so memory doesn't grow forever
 * ------------------------------------------------------------------ */
setInterval(() => {
  const cutoff = Date.now() - STALE_MS;
  const removed = [];
  for (const [mmsi, v] of vessels) {
    if (v.updatedAt < cutoff) {
      vessels.delete(mmsi);
      trails.delete(mmsi);
      removed.push(mmsi);
    }
  }
  if (removed.length) {
    console.log(`[prune] removed ${removed.length} stale vessels`);
    for (const client of wss.clients) send(client, { type: 'remove', mmsis: removed });
  }
}, 60_000);

/* ------------------------------------------------------------------ *
 * Go
 * ------------------------------------------------------------------ */
server.listen(PORT, () => {
  console.log(`[http] listening on http://localhost:${PORT}  (WebSocket at /live)`);
  connectAIS();
});
