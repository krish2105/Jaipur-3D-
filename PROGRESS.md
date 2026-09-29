# PROGRESS

Living log. A resumed session should read this first.

## Status board

| Phase | Scope | State |
|---|---|---|
| 1 | Scaffold, Vite build, perf overlay, tier detection | done |
| 2 | Data pipeline (Overpass + terrain, baking, chunking) | terrain: pending; OSM: **BLOCKED** (see below) |
| 3 | Terrain, streets, OSM buildings, real-metre facades | pending |
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

## Known shortfalls

(none recorded yet beyond the OSM blocker)
