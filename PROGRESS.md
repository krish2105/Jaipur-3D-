# PROGRESS

Living log. A resumed session should read this first.

## Status board

| Phase | Scope | State |
|---|---|---|
| 1 | Scaffold, Vite build, perf overlay, tier detection | done |
| 2 | Data pipeline (Overpass + terrain, baking, chunking) | **done, real data baked** (69 Overpass tiles, OSM timestamp 2026-09-29T10:32Z; terrain 2.6 MB; total 7.4 MB) |
| 3 | Terrain, streets, OSM buildings, real-metre facades | done; real city seen and judged (see Task A verdict) |
| 4 | Landmarks | **wired**: Hawa Mahal (953 windows), Jantar Mantar (real OSM layout), Jal Mahal (real OSM footprint), Chandra Mahal (7 levels), Mubarak Mahal, city gatehouses, OSM wall solids, OSM-driven Amer/Jaigarh/Nahargarh masses. Polish outstanding, see shortfalls |
| 5 | Sky, sun, moon, materials, time of day | mostly done; this session: city-realistic star field, cloud grain, night cloud fade |
| 6 | Weather | pending |
| 7 | Traffic + people (worker), birds, cows | pending |
| 8 | Festival, night, kite modes | pending |
| 9 | Spatial audio | pending |
| 10 | Cinematic tour, free-fly, touch, compact UI | pending |
| 11 | Verification loop, budgets, fixes | `scripts/check-budgets.mjs` done and passing on all tiers; matrix + reviewer pass pending |
| 12 | README, final push | pending |

## DECISION NEEDED (owner): OSM has no buildings for most of the Walled City's bazaar blocks

Measured on the real baked data (`node scripts/coverage-map.mjs` writes `shots-tmp/coverage.png`): the Walled City street grid and roads are mapped completely, but **building footprints are mapped only in strips**
(Tripolia / Chandpole / parts of Badi Chaupar); whole blocks between the bazaars, including most of Johari Bazaar, have **no buildings in OSM at all** (9,734 buildings for the ~7 km x 7 km baked area, of which 99 % have inferred heights).
The renderer shows exactly what OSM contains, so street-level views of Johari Bazaar show an empty plain instead of a continuous wall of shopfronts.
Per the project rules nothing is invented or "filled in". Options (none has been done):
1. Keep OSM-only (current). Honest, sparse.
2. Allow one additional **real** footprint source for the missing blocks (e.g. Overture Maps buildings, which merge Microsoft/Google imagery-derived footprints with OSM; open licences, needs attribution). Real footprints, no real heights (heights stay inferred).
3. Procedural infill of blank blocks. Fabricated by definition; only with explicit permission.

## Decisions

- Plain JS ES modules + three.js (WebGL2 only). No TypeScript, no framework: smaller build, fewer moving parts.
- Local east/north metre projection around Badi Chaupar (26.9235 N, 75.8265 E); three.js axes: +x east, -z north.
- Quality tiers live in `src/core/budgets.js` (settings + hard budgets); scripts read the same table.
- Fixed-timestep loop (1/30 s) with clamped frame delta (0.1 s) in `src/core/loop.js`.
- Dynamic resolution + optional fps cap (30 on phones) to limit heat.
- Landmark facts are verified against pages that were actually opened (raw Wikipedia wikitext, Sahapedia, Incredible India, jantarmantar.org) and recorded with conflicts in `docs/LANDMARK_FACTS.md`.
- The verification harness now runs on this Mac: the installed Google Chrome with ANGLE/Metal (real GPU). `GL_MODE=software` and `CHROMIUM_PATH` override it (cloud sandbox: SwiftShader).
- OSM is the source of truth for positions and orientation. Hawa Mahal is only a node in OSM, so the facade is placed on the east edge of the building polygon that contains the node (facade faces east onto the street, as documented).
- Walls: `barrier=city_wall` ways/areas are baked as 6 m x 3 m solids (thin `area=yes` polygons keep their outline; fat polygons and closed loops become ring walls; lines are buffered). Other wall kinds are still not rendered.
- Land cover (water, vegetation, parks, built-up land) is rasterised from OSM polygons into a 10 m raster (`public/data/osm/cover.dat`, gzip, 23 KB) that the terrain shader samples; unmapped ground keeps the terrain shading.

## Phase 2 notes

- `npm run bake:terrain` -> `public/data/terrain/` (near 16 km @ 15.6 m/texel in 4x4 chunks; far 72 km @ 141 m/texel; uint16 = metres*20).
  City datum ~443 m; lake surface 411.0 m; Nahargarh ridge ~588 m. SRTM is a surface model, so heights under the dense city carry urban noise.
- `npm run fetch:osm` -> `data-raw/osm/*.json` (git-ignored). Zones: core (Walled City + margin), ring (low-detail fabric + main roads + water), amer / jalmahal / nahargarh. Primary endpoint is retried with backoff (Overpass answers 504 when busy), mirrors have short timeouts,
  a failing tile is split into four and merged. Took ~25 minutes on 2026-09-29 (many transient 504s, no data was substituted).
- `npm run bake:osm` -> `public/data/osm/{manifest,graph,cover.dat,b_*,r_*,m_*}.json`, 500 m tiles, decimetre-int coordinates. Height rule: `height` tag > `building:levels` x 3.3 m > inferred (distance-weighted log-mean of known neighbours within 90 m blended with class prior, +-14 % jitter).
  Real data exposed and fixed: landmark name matches on bus routes / shops / stops (ranked + excluded now), gates mapped as building outlines, walls mapped as area polygons and hill-enclosing loops, OSM spelling "Jaighar", relation water bodies.
- Real-data facts (baked 2026-09-29): 20,156 elements, 9,734 buildings (71 with `height`, 31 with `building:levels`, 9,632 inferred = 99 %), 9,289 road ways, street graph 16,047 nodes / 21,639 edges, 18 gates, 52 wall solids, 381 land-cover polygons.
- `npm run check:data` enforces the ~30 MB budget and a 4 MB single-chunk limit.

## Phase 3 / 4 notes

- Terrain: geometry-clipmap rings, heights in the vertex shader from baked half-float textures; normals + Aravalli rock/scrub/soil albedo + land cover in the fragment shader.
- Roads: the road material's polygon offset now out-pulls every terrain ring (before it, roads were buried at street-level grazing angles).
- Buildings: hand extrusion in `src/world/buildingGeometry.js`; facade shader in `src/world/facadeMaterial.js`; streaming in `src/world/city.js` (worker-built tiles, LOD by distance). The tile worker now drops the OSM footprints that hand-built landmarks replace (`src/world/landmarks/plan.js`: by id, inside an inflated ring, or mostly under the model footprint).
- Landmarks: `src/world/landmarks/index.js` (`planLandmarks` -> pure plan + exclusion, `Landmarks` -> meshes). Models: hawaMahal.js, jantarMantar.js (`buildJantarMantarFromSite` uses the real OSM ring and instruments), jalMahal.js (parametrised to the mapped 59 x 55 m body), cityPalace.js (Chandra Mahal, Mubarak Mahal, generic gatehouse).
- **Renderer lab**: `npm run build:lab` builds `dist-lab/` with `VITE_LAB=1` (synthetic district from `tests/fixtures/`, labelled on screen, never in the production bundle). Verified: `grep -l "Test Bazaar" dist/assets/*` prints nothing.

## Task A verdict (real Walled City vs real photos, critical)

Screenshots: `shots-tmp/taskA/*.png` (git-ignored; regenerate with `node scripts/task-a-shots.mjs`).
- Roads, gates, Jantar Mantar (compound, Samrat Yantra, Ram Yantras, Rashi Valaya zone), Jal Mahal in Man Sagar, City Palace masses and the lane markings are recognisably Jaipur and positioned from OSM.
- Arcaded shopfronts, cusped windows, shutters and signboards (facade shader) read as a Jaipur bazaar frontage where OSM has buildings (e.g. around Badi Chaupar).
- **Does not match photos of Johari Bazaar / Hawa Mahal Road**: most bazaar blocks have no OSM buildings (see DECISION NEEDED), all heights are inferred boxes with flat roofs, no rooftop clutter, no street life yet (Phase 7), haze is uniform and milky.

## Known shortfalls (honest)

- OSM building coverage gap (above). Heights: 99 % inferred.
- Hawa Mahal is a stylised pyramid: better than the first version (slim octagonal corner bays, projecting oriel units with white arch frames, per-window tint) but not a photographic facade; its rear block and the Saraogi block around it are approximations.
- Jantar Mantar: only the 5 instruments OSM maps are placed; Jai Prakash, Laghu Samrat etc. are absent because their positions are not in any opened source.
- Chandra Mahal / Mubarak Mahal / gatehouse proportions and storey heights are *approx* (footprints are real).
- Forts: Amer / Jaigarh / Nahargarh are OSM buildings and 6 m wall solids on smooth SRTM hills in a generic limewash colour; no crenellations, no bespoke gate towers, wall colour not plumbed to the shader. Poor silhouette from a distance. Maota Lake is now painted from the OSM water polygon, the land is otherwise bare.
- Terrain hills are smooth (15.6 m DEM) and the atmosphere reads pale/milky in wide shots (fog tuning pending); volumetric clouds are grainy (white-noise jitter, no temporal accumulation).
- The Walled City boundary is not in OSM: `manifest.walledCity` = the brief's bounds (`approx-brief`).
- Other wall kinds (`barrier=wall`, fences, retaining walls) and OSM `water`/`green` polygons from the `m_*` chunks are not rendered as geometry (water and green are in the land-cover raster).
- Lamps: OSM has almost no `street_lamp` nodes in the area (0 instances), so night street lighting cannot come from OSM lamps; Phase 8 will use the street graph.
- Facade shader `c` (building colour) is baked but not used by the shader.
- Budget headroom: the **low tier is at 0.99 M of its 1.00 M triangle budget** (`npm run check:budgets`); any new geometry needs a cheaper far-LOD for that tier first. Medium is at 2.46 M / 2.80 M.
- WebGPU is not used (WebGL2 only). Frame-rate numbers have not been measured yet.

## Resume checklist

1. Owner decision on the building-coverage options above.
2. Phase 6 weather rendering (rain streaks, wet-street planar reflection, lightning, dust) - state model in `src/weather/weather.js`, `uWet` hooks and cloud shadows exist.
3. Phase 7 traffic/people worker (IDM) on `public/data/osm/graph.json`, birds, cows.
4. Phase 8 festival / night / kite modes. 5. Phase 9 procedural audio. 6. Phase 10 cinematic tour + free-fly + touch + compact UI.
7. Phase 11: fixed-seed screenshot matrix + reviewer pass + real-GPU fps measurements. 8. Phase 12 README.
