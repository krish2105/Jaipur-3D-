# PROGRESS

Living log. A resumed session should read this first.

## Status board

| Phase | Scope | State |
|---|---|---|
| 1 | Scaffold, Vite build, perf overlay, tier detection | done |
| 2 | Data pipeline (Overpass + terrain, baking, chunking) | terrain: **done** (2.6 MB baked); OSM fetch+bake scripts done and unit-tested, **data BLOCKED** (see below) |
| 3 | Terrain, streets, OSM buildings, real-metre facades | **code done + verified on synthetic lab district**; real-city output waits on OSM data |
| 4 | Hand-modelled landmarks, Amer/Nahargarh silhouettes | pending |
| 5 | Sky, sun, moon, materials, time of day | pending |
| 6 | Weather | pending |
| 7 | Traffic + people (worker), birds, cows | pending |
| 8 | Festival, night, kite modes | pending |
| 9 | Spatial audio | pending |
| 10 | Cinematic tour, free-fly, touch, compact UI | pending |
| 11 | Verification loop, budgets, fixes | pending |
| 12 | README, final push | pending |

## BLOCKER: network allow-list (found in phase 1)

Probed from the sandbox (HTTP CONNECT via the agent proxy):

- **Denied (403):** `overpass-api.de`, `z.overpass-api.de`, `lz4.overpass-api.de`, `overpass.kumi.systems`, `overpass.private.coffee`, `overpass.openstreetmap.fr`, `overpass.osm.jp`, `maps.mail.ru`, `api.openstreetmap.org`, `download.geofabrik.de`, `planet.openstreetmap.org`, `nominatim.openstreetmap.org`, `en.wikipedia.org`, `www.wikidata.org`, `commons.wikimedia.org`, `whc.unesco.org`, `cdn.jsdelivr.net`, `unpkg.com`, `cdnjs.cloudflare.com`.
- **Allowed:** `registry.npmjs.org`, `raw.githubusercontent.com`, `s3.amazonaws.com` / `elevation-tiles-prod.s3.amazonaws.com` (Terrarium elevation), github.com (git).

**Action needed from the owner:** add **`overpass-api.de`** to the environment's allowed domains
(or set Network access to a broader level). Optional fallbacks: `overpass.kumi.systems`, `overpass.private.coffee`.
Nothing else is required (npm packages are bundled; no CDN is used at runtime).

Until then the OSM-dependent steps (building footprints, street graph, OSM landmark positions, traffic graph) are
**not** baked, and nothing is faked or substituted. The pipeline scripts are written and unit-tested against
tiny synthetic fixtures (tests/ only) so `npm run fetch:osm && npm run bake:osm` completes the job the moment the
domain is reachable. The app shows an on-screen notice while the OSM chunks are absent.

## Decisions

- Plain JS ES modules + three.js (WebGL2 only). No TypeScript, no framework: smaller build, fewer moving parts.
- Local east/north metre projection around Badi Chaupar (26.9235 N, 75.8265 E); three.js axes: +x east, -z north.
- Quality tiers live in `src/core/budgets.js` (settings + hard budgets); scripts read the same table.
- Fixed-timestep loop (1/30 s) with clamped frame delta (0.1 s) in `src/core/loop.js`.
- Dynamic resolution + optional fps cap (30 on phones) to limit heat.
- Web fetch of Wikipedia is blocked; landmark facts are checked through web search snippets and recorded with URLs in `docs/LANDMARK_FACTS.md`.

## Phase 2 notes

- `npm run bake:terrain` -> `public/data/terrain/` (near 16 km @ 15.6 m/texel in 4x4 chunks; far 72 km @ 141 m/texel; uint16 = metres*20).
  City datum ~443 m; lake surface 411.0 m (modal flat SRTM texels near Jal Mahal); Nahargarh ridge ~588 m. SRTM is a surface model, so the app
  smooths the terrain under the Walled City (urban DSM noise).
- `npm run fetch:osm` -> `data-raw/osm/*.json` (git-ignored). Zones: core (Walled City + margin, full features), ring (low-detail fabric +
  main roads + water), amer / jalmahal / nahargarh (forts, walls, buildings, lake). Multi-mirror, tiled, polite delays. Exits 2 and names the blocked hosts.
- `npm run bake:osm` -> `public/data/osm/{manifest,graph,b_*,r_*,m_*}.json`, 500 m tiles, decimetre-int coordinates relative to the tile.
  Height rule: `height` tag > `building:levels` x 3.3 m > inferred (distance-weighted log-mean of known neighbours within 90 m blended with class prior,
  +-14 % deterministic jitter). `building:part` children replace their outline. Multipolygon relations stitched; holes assigned.
- Unit tests (`npm test`) use `tests/fixtures/overpass-synthetic.mjs`: a SYNTHETIC fixture in the Overpass `out geom` shape. It is test-only and is never baked.
- `npm run check:data` enforces the ~30 MB budget.

## Phase 3 notes

- Terrain: geometry-clipmap rings (8 rings, tier-scaled grid), heights fetched in the vertex shader from baked half-float textures; normals + Aravalli
  rock/scrub/soil albedo in the fragment shader; Man Sagar water body from a baked flat-SRTM mask. Rings overlap by one coarse cell + polygon offset.
- Buildings: hand extrusion in `src/world/buildingGeometry.js` (walls with u/v in real metres, courtyard holes, parapets, cornices, mumtys, black
  water tanks, domes/pyramids, jharokha + chhatri instance lists). Winding verified by unit tests (`tests/building-geometry.test.mjs`).
- Facade shader `src/world/facadeMaterial.js`: per-building palette (salmon/rose/ochre/lime/cream/grey), weathering, soot, streaks, plaster loss,
  arched shopfront arcades + signboards + shutters on street-facing bazaar walls, cusped-arch windows, lit windows at night, distance-faded detail.
- Streaming: `src/world/city.js` (500 m tiles, worker-built, LOD by distance, instance pools). Tile worker gets the height arrays so buildings sit on terrain.
- **Renderer lab**: `npm run build:lab` builds `dist-lab/` with `VITE_LAB=1`, which swaps the network source for an in-memory bake of
  `tests/fixtures/synthetic-district.mjs` (an imaginary bazaar quarter; clearly labelled on screen, never in the production bundle, never in `public/data`).
  It exercises the *same* bake -> worker -> mesh -> shader path the real data will take.

## Known shortfalls

(none recorded yet beyond the OSM blocker)
