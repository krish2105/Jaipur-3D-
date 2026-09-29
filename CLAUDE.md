# Jaipur 3D: project rules

- Static Vite site; `npm run build` outputs `dist/`. Pushes to main auto-deploy on Vercel. Never use Vercel credentials or the CLI.
- The repo is PUBLIC: never commit keys, tokens or `.env` files.
- Cloud sandbox has no GPU: verify with Playwright + software rendering (SwiftShader/ANGLE) at low resolution, WebGL2 only. WebGPU is not implemented. Fps from the sandbox is meaningless; use the in-app performance overlay and `npm run check:budgets` (draw calls, triangles, texture MB, instance counts per tier) instead.
- Network is allow-listed. If a domain is blocked, stop that step and tell the user which domain to allow. Never fake data, never scrape map services. (Synthetic fixtures are allowed only under `tests/` for unit tests and are never baked into `public/data`.)
- Work in phases; commit and push after every phase; keep `PROGRESS.md` updated (done, next, decisions, known shortfalls).
- Keep baked data under about 30 MB total, chunked by tile (`npm run check:data`). No big binaries in git; raw downloads go in git-ignored `data-raw/`.
- Data: OpenStreetMap via Overpass, baked into static chunks at build time; credit "OpenStreetMap contributors" in the README and in the app.
- Landmark facts are verified against sources (see `docs/LANDMARK_FACTS.md`), not memory.
- Simulation uses fixed timesteps and clamped frame deltas; one simulation clock drives time of day, weather, traffic, festival and audio.
