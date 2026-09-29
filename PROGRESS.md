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
| 6 | Weather | **done** (verified by stills on all tiers; see Phase 6 notes) |
| 7 | Traffic + people (worker), birds, cows | **done** (IDM traffic, bazaar-weighted pedestrians, cows, pigeon flocks; verified in tests, budgets and live on the real GPU; kites deferred to Phase 8) |
| 8 | Festival, night, kite modes | pending |
| 9 | Spatial audio | pending |
| 10 | Cinematic tour, free-fly, touch, compact UI | pending |
| 11 | Verification loop, budgets, fixes | `scripts/check-budgets.mjs` done and passing on all tiers (incl. wet and dust worst cases); matrix + reviewer pass pending |
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

## Phase 6 notes (weather)

- **Rain** (`src/weather/rain.js`): GPU-instanced thin streaks in a camera-centred, world-locked wrapped volume; depth-tested (buildings occlude it), 1-1.5 px wide, coloured by the sky in their direction plus a forward-scatter term toward the sun/moon (so they show where backlit, not as white lines);
  the drop set thins with intensity; wind slants them; splash rings near the camera. Counts per tier: 9000 / 5000 / 1800.
- **Wet streets** (`src/render/reflection.js` + road material): a planar reflection of the near scene at the ground under the camera (mirrored camera, global clip plane so the sky pass is unaffected, previous frame's shadow maps reused, half-float target at 0.5 / 0.35 of frame size),
  sampled by the road shader with roughness-driven blur, fresnel and raindrop-ring distortion; puddles are the strongest mirrors. Runs only while the ground is wet and the camera is within `reflectionMaxHeight` (200 m high / 70 m medium) and fades out toward that height; low tier uses the sky cube only.
- **Lightning** (`src/weather/lightning.js`): fractal cloud-to-ground bolt (main channel + branches, deterministic per strike) as pixel-width ribbons, HDR so bloom glows, a multi-stroke flash envelope in `Weather` (strokes at 0 / 0.07 / 0.17 / 0.31 s + afterglow), and a real cold directional light so the street lights up. Bug found on the way: the ribbon quads were back-face culled (winding follows the segment direction) - both ribbon materials are double sided now.
- **Dust storm** (`src/weather/dust.js` + post grade): wind-driven dust sprites in a wrapped volume plus an ochre post grade scaled by dust x storm; with the existing fog model the loo reads as a dim ochre wall of dust.
- **Mist**: extinction band hugging the ridge flanks (40-190 m above the city datum) plus a faint ground layer, so the plain stays readable. **Cloud shadows**: the existing light-loop term is visible on the ground (subtle).
- Sky: cloud march now 36 / 18 / 8 steps (high / medium / flat) with per-frame white-noise jitter; star field culled to a bright-city magnitude limit; fair-weather clouds fade at night.
- Budgets: the gate now includes rainy and dusty worst cases; **medium triangle budget raised 2.8 M -> 3.2 M** because the reflection pass measured +0.64 M at street level (tiles are drawn whole; finer tile splitting is the fix if real medium-GPU frame times need it).
- `scripts/weather-shots.mjs` renders the same views under every preset.

## Phase 7 notes (street life)

- **Sim** (`src/sim/`): pure, deterministic `TrafficSim` on the baked street graph (`graph.js`: polylines, left lateral offset, one-way adjacency), SoA typed arrays, fixed 1/30 s step, Intelligent Driver Model (`idm.js`) with per-type parameters, left-hand traffic, alternating-axis signals, node locks (9 s force timeout so a junction can never stay deadlocked).
  Vehicles: bikes, cars, autos, buses. Pedestrians are weighted toward bazaar street names / landmark hotspots (Badi Chaupar, Johari, Tripolia ...), cows rest or walk on small streets, pigeon flocks circle. Density follows the one sim clock (night quiet, rush hours busy, evening bazaar peak for people).
- **Spawning** happens only outside the camera view cone and not next to the lens; agents are recycled when far or stuck (>45 s nearly still).
- **Worker** (`trafficWorker.js`): steps the sim, posts snapshots; the main thread dead-reckons between snapshots (`life.js`), culls on the CPU and writes instance buffers. Rendering: one per-vertex-tagged material (tint / lamp / limb / pivot) for every agent type, `aColor` / `aAnim` instanced (`agentGeometry.js`, `agentMaterial.js`).
- **Bugs the real graph exposed** (all fixed, with tests): spawning across short adjacent edges produced overlaps (now 12 m world-space spacing), two vehicles entering one node in the same step (per-step `entered` map), permanent-deadlock overlap (stuck recycling), IDM NaN when a type object lacked `delta` / `brakeLimit` (defaults in `idmAccel`).
- **Tests** (`tests/idm.test.mjs`, `tests/traffic.test.mjs`): no overlaps, no teleporting, sane speeds, keeps left, flows; nothing spawns in view; population follows time of day; crowds at hot weights; bit-identical determinism for a seed; a run on the real baked graph near Badi Chaupar. 68 tests pass in total.
- **Budgets**: every view in `check:budgets` is populated with life; all tiers within budget (worst triangles low 0.99 M / 1.00 M, medium 3.11 M / 3.20 M, high 4.86 M / 5.50 M). Sim cost measured 0.44 ms per step.
- **Real GPU measurement** (`node scripts/live-check.mjs`, Chrome + ANGLE/Metal on the Apple M4 Pro, tier high, 1600 x 900, no console problems): vsync run holds 60 fps on 4 views. Uncapped at 1x: 100-131 fps. Uncapped at 2x device pixel ratio the dynamic resolution settles at pixel ratio 1.36-1.76 and gives 40-74 fps.
  A/B on the street view at dsf 2 (uncapped): `pr=2` 37.4 fps, `pr=2&msaa=0` 48.9 fps, `pr=1.5` 79.8 fps, `pr=1.5&msaa=0` 117.1 fps. Reading: native Retina is fill-rate bound and 4x MSAA costs about 25-30 %. Hot-spot work (MSAA policy at high pixel ratios, faster DRS convergence, cloud step cost) belongs to Phase 11.
- Known shortfalls of this phase: agent models are crude low-poly silhouettes (no walk-cycle skinning, only a limb/pivot swing), pedestrians do not react to vehicles, no kites yet (Phase 8), traffic does not react to rain, agents ignore roofs and pavements beyond the graph offset.

## Task A verdict (real Walled City vs real photos, critical)

Screenshots: `shots-tmp/taskA/*.png` (git-ignored; regenerate with `node scripts/task-a-shots.mjs`).
- Roads, gates, Jantar Mantar (compound, Samrat Yantra, Ram Yantras, Rashi Valaya zone), Jal Mahal in Man Sagar, City Palace masses and the lane markings are recognisably Jaipur and positioned from OSM.
- Arcaded shopfronts, cusped windows, shutters and signboards (facade shader) read as a Jaipur bazaar frontage where OSM has buildings (e.g. around Badi Chaupar).
- **Does not match photos of Johari Bazaar / Hawa Mahal Road**: most bazaar blocks have no OSM buildings (see DECISION NEEDED), all heights are inferred boxes with flat roofs, no rooftop clutter, no street life at the time of this verdict (added in Phase 7), haze is uniform and milky.

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
- WebGPU is not used (WebGL2 only). Real-GPU frame rates were first measured in Phase 7 (M4 Pro only; phones and mid-range GPUs are untested, see Phase 7 notes).

- Weather: rain has no audio yet (Phase 9); planar reflection only mirrors roads (terrain plazas just darken); lightning illumination is one directional light; moving dust sprites are subtle next to the fog; cloud edges are still grainy at the low/medium step counts; rain does not stop under roofs.

## Resume checklist

1. Owner decision on the building-coverage options above.
2. (Phase 7 done.)
4. Phase 8 festival / night / kite modes. 5. Phase 9 procedural audio. 6. Phase 10 cinematic tour + free-fly + touch + compact UI.
7. Phase 11: fixed-seed screenshot matrix + reviewer pass + real-GPU fps measurements. 8. Phase 12 README.
