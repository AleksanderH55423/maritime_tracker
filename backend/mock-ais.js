// A tiny fake AISStream server so you can develop without an API key or network.
// Run: npm run mock   (then set AIS_URL=ws://localhost:9999/v0/stream in .env)
import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({ port: 9999, path: '/v0/stream' });

const ships = [
  { mmsi: 244630000, name: 'MOCK CARGO', type: 70, lat: 51.2, lon: 1.8, cog: 45, sog: 14, dest: 'ROTTERDAM', imo: 9000001 },
  { mmsi: 219000111, name: 'MOCK TANKER', type: 80, lat: 52.5, lon: 3.2, cog: 200, sog: 11, dest: 'ANTWERP', imo: 9000002 },
  { mmsi: 235000222, name: 'MOCK FERRY', type: 60, lat: 51.0, lon: 1.5, cog: 320, sog: 20, dest: 'DOVER', imo: 9000003 },
];

const SPEEDUP = 60; // make ships visibly move each second

wss.on('connection', (ws) => {
  console.log('[mock] client connected');

  ws.once('message', (raw) => {
    const sub = JSON.parse(raw.toString());
    console.log('[mock] subscription received:', { ...sub, APIKey: sub.APIKey ? '***' : undefined });

    for (const s of ships) {
      ws.send(
        JSON.stringify({
          MessageType: 'ShipStaticData',
          MetaData: { MMSI: s.mmsi, ShipName: `${s.name}   `, latitude: s.lat, longitude: s.lon },
          Message: {
            ShipStaticData: {
              UserID: s.mmsi,
              Name: `${s.name}@@@`,
              Type: s.type,
              ImoNumber: s.imo,
              CallSign: 'MOCK1  ',
              Destination: s.dest,
              Eta: { Month: 9, Day: 20, Hour: 14, Minute: 30 },
              MaximumStaticDraught: 9.5,
              Dimension: { A: 150, B: 30, C: 10, D: 12 },
            },
          },
        }),
      );
    }

    const timer = setInterval(() => {
      for (const s of ships) {
        const rad = (s.cog * Math.PI) / 180;
        const distNm = (s.sog / 3600) * SPEEDUP;
        s.lat += (distNm * Math.cos(rad)) / 60;
        s.lon += (distNm * Math.sin(rad)) / (60 * Math.cos((s.lat * Math.PI) / 180));
        ws.send(
          JSON.stringify({
            MessageType: 'PositionReport',
            MetaData: { MMSI: s.mmsi, ShipName: s.name, latitude: s.lat, longitude: s.lon },
            Message: {
              PositionReport: {
                UserID: s.mmsi,
                Latitude: s.lat,
                Longitude: s.lon,
                Sog: s.sog,
                Cog: s.cog,
                TrueHeading: Math.round(s.cog),
                NavigationalStatus: 0,
              },
            },
          }),
        );
      }
    }, 1000);

    ws.on('close', () => clearInterval(timer));
  });
});

console.log('[mock] fake AIS feed on ws://localhost:9999/v0/stream');
