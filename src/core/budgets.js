// Quality tiers and hard budgets. This file is the single source of truth: the renderer reads
// the `settings`, and scripts/check-budgets.mjs enforces the `budget` numbers by running the
// app under software rendering and reading renderer.info (GPU-independent counts).
//
// Frame-time numbers from the cloud sandbox are meaningless; draw calls / triangles /
// texture memory / instance counts are not, so those are what we gate on.

export const TIER_ORDER = ['low', 'medium', 'high'];

export const TIERS = {
  high: {
    label: 'High',
    targetFps: 60,
    settings: {
      maxPixelRatio: 2,
      minPixelRatio: 1,
      dynamicResolution: true,
      shadowCascades: 3,
      shadowMapSize: 2048,
      shadowDistance: 900, // metres from camera covered by cascades
      cloudShadows: true,
      reflections: 'planar', // wet-street planar reflection
      reflectionScale: 0.5,
      bloom: true,
      terrainRings: 8,
      terrainGrid: 96,
      tileRadius: 1300, // m: full-detail OSM tiles streamed within this radius
      farTileRadius: 3200, // m: low-detail (extruded footprints, no facade detail) beyond
      detailRadius: 260, // m: instanced jharokhas/chhatris/arcade geometry
      vehicles: 900,
      pedestrians: 1600,
      animals: 90,
      birds: 220,
      kites: 70,
      rainParticles: 9000,
      dustParticles: 1800,
      lights: 96, // point-light pool for festival / night hot-spots
      audioVoices: 24,
      fpsCap: 0,
      skyCubeSize: 128,
      starCount: 2600,
    },
    budget: { drawCalls: 700, triangles: 5_500_000, textureMB: 320, geometries: 400, instances: 30_000 },
  },
  medium: {
    label: 'Medium',
    targetFps: 60,
    settings: {
      maxPixelRatio: 1.5,
      minPixelRatio: 0.75,
      dynamicResolution: true,
      shadowCascades: 2,
      shadowMapSize: 2048,
      shadowDistance: 600,
      cloudShadows: true,
      reflections: 'planar',
      reflectionScale: 0.35,
      bloom: true,
      terrainRings: 7,
      terrainGrid: 64,
      tileRadius: 900,
      farTileRadius: 2400,
      detailRadius: 160,
      vehicles: 450,
      pedestrians: 800,
      animals: 45,
      birds: 110,
      kites: 40,
      rainParticles: 5000,
      dustParticles: 1000,
      lights: 48,
      audioVoices: 16,
      fpsCap: 0,
      skyCubeSize: 64,
      starCount: 1800,
    },
    budget: { drawCalls: 480, triangles: 2_800_000, textureMB: 192, geometries: 300, instances: 15_000 },
  },
  low: {
    label: 'Low (phone)',
    targetFps: 30,
    settings: {
      maxPixelRatio: 1.25,
      minPixelRatio: 0.6,
      dynamicResolution: true,
      shadowCascades: 1,
      shadowMapSize: 1024,
      shadowDistance: 260,
      cloudShadows: false,
      reflections: 'env', // sky-cube only, no extra scene pass
      reflectionScale: 0,
      bloom: false,
      terrainRings: 6,
      terrainGrid: 40,
      tileRadius: 520,
      farTileRadius: 1500,
      detailRadius: 70,
      vehicles: 160,
      pedestrians: 260,
      animals: 14,
      birds: 40,
      kites: 16,
      rainParticles: 1800,
      dustParticles: 350,
      lights: 16,
      audioVoices: 10,
      fpsCap: 30,
      skyCubeSize: 32,
      starCount: 900,
    },
    budget: { drawCalls: 260, triangles: 1_000_000, textureMB: 96, geometries: 220, instances: 6_000 },
  },
};

export function tierByName(name) {
  return TIERS[name] ? name : 'medium';
}
