# Maritime Tracker

A personal OSINT project that tracks live ship positions from AIS (Automatic Identification System) data and displays them on an interactive 3D globe.

## Status

The backend is live and pulling real AIS data. The frontend displays live ships as clickable markers on a rotating 3D globe. Clicking a ship opens a HUD with its identifying and navigation information.

The HUD also displays the Maritime Tracker logo when no ship is selected, and moves the logo to the bottom when viewing ship details.

## How it works

Ships broadcast their position, speed, course, and identity over VHF radio as part of AIS, a maritime safety system. [AISStream.io](https://aisstream.io) collects these broadcasts from a network of receivers and re-publishes them over a WebSocket. AISStream allows anyone to access this data for free.

```text
AISStream.io  --WebSocket-->  server.js  --REST + WebSocket-->  public/index.html
   (raw AIS)      (ingest)     (in-memory vessel store)          (globe + HUD)
```

* **`server.js`** connects to AISStream, merges incoming messages into one record per ship (keyed by MMSI, the ship's unique ID), and serves that data two ways:

  * `GET /api/vessels` — a REST snapshot of every tracked ship
  * `GET /api/vessels/:mmsi` — one ship's full details plus its recent track
  * `GET /api/health` — whether the AIS connection is alive and how many ships are tracked
  * `ws://localhost:3000/live` — pushes live position updates to the browser
* **`public/index.html`** is the frontend: a WebGL globe (via [globe.gl](https://globe.gl)) that renders ships as clickable markers and displays their details in a sidebar HUD.
* **`mock-ais.js`** is a fake AIS feed with a few moving ships, for developing the frontend without needing a real API key or network traffic.

Ships broadcast their position updates frequently, while identifying and voyage information such as their name, type, and destination is transmitted separately. As a result, a ship's full details can take a minute or two to fill in after it first appears.

## Ship information

The tracker currently displays information such as:

* Vessel name
* Vessel category/type
* MMSI
* IMO number
* Speed over ground
* Course over ground
* Destination
* Estimated time of arrival
* Latitude and longitude
* Last update time

AIS data can also be used to derive a ship's **flag/country association** from the Maritime Identification Digits (MID) contained in the MMSI. This is not necessarily the same thing as the nationality of the vessel's owner or crew, so the application should refer to it as the vessel's **flag** or **MMSI country** rather than nationality.

## Setup

**Requirements:** [Node.js](https://nodejs.org) 20.6 or newer, and a free API key from [aisstream.io](https://aisstream.io) (sign in with GitHub).

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the example environment file and add your key:

   ```bash
   cp env.example .env
   ```

   Then open `.env` and set:

   ```text
   AISSTREAM_API_KEY=your_key_here
   ```

3. Start the server:

   ```bash
   npm start
   ```

4. Open **http://localhost:3000** in your browser.

### Environment variables (`.env`)

| Variable            | Default                              | What it does                                                                     |
| ------------------- | ------------------------------------ | -------------------------------------------------------------------------------- |
| `AISSTREAM_API_KEY` | *(required)*                         | Your AISStream API key                                                           |
| `PORT`              | `3000`                               | Port the server listens on                                                       |
| `BOUNDING_BOXES`    | English Channel / southern North Sea | Geographic area(s) to track, as `[[lat,lon],[lat,lon]]` corner pairs             |
| `STALE_MINUTES`     | `60`                                 | Drop a ship if it hasn't been heard from in this long                            |
| `LOG_SAMPLES`       | off                                  | Set to `1` to print a sample of each raw AIS message type (useful for debugging) |
| `AIS_URL`           | AISStream's real endpoint            | Override to point at the mock feed instead                                       |

### Developing without a real API key

Run the fake feed in one terminal:

```bash
npm run mock
```

Then in `.env`, point the server at it:

```text
AIS_URL=ws://localhost:9999/v0/stream
```

and run `npm start` as usual. You'll see three fake ships moving in the English Channel.

## Project layout

```text
maritime_tracker/
├── public/
│   └── index.html          — the globe frontend and ship details HUD
├── media/
│   └── Hovland_Maritime_Logo.jpg — Maritime Tracker logo
├── server.js               — AIS ingest + REST/WebSocket API
├── mock-ais.js             — fake AIS feed for offline development
├── package.json
├── env.example             — copy to .env and fill in your key
└── .env                    — your real config (not committed to git)
```

## Known limitations

* Everything is stored in memory — restarting the server clears all ship data and history.
* Free AIS coverage is land-based, so it's dense near coasts and thin in open ocean. Ships can also switch AIS off or lack it entirely.
* The bounding-box filter doesn't handle areas that cross the 180° meridian.
* AIS does not directly provide a vessel's owner nationality or crew nationality. A country/flag association can generally be derived from the MMSI's Maritime Identification Digits, but this should not be treated as a definitive statement about ownership or nationality.

## Next steps

* Add vessel flag/country information derived from MMSI
* Draw recent tracks as trails
* Filter by ship category and search by name or MMSI
* Improve vessel classification and display
* Add additional OSINT data sources for vessel identification and enrichment
* Persist vessel history instead of storing everything in memory
