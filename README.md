# Jaipur 3D

Real-time 3D Jaipur (the Walled City, Hawa Mahal, Jantar Mantar, Jal Mahal and the Aravalli forts) in the browser.
Built with Claude Code. Work in progress; see [PROGRESS.md](PROGRESS.md) for status, decisions and known shortfalls.

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL).
Terrain: Mapzen Terrarium tiles on AWS Open Data (derived from SRTM, and other sources).

## Run

```
npm install
npm run dev        # http://127.0.0.1:5173
npm run build      # -> dist/
```

Add `?perf=1` (or press `p`) for the performance overlay; `?tier=low|medium|high` forces a quality tier.
