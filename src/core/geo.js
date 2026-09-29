// Local east/north metre projection around a fixed origin (Badi Chaupar area).
// three.js axes: +x = east, +y = up, -z = north (so +z = south).
// Equirectangular with cos(lat0) scaling: error over a ~20 km window is well below 0.1 %.

export const ORIGIN = { lat: 26.9235, lon: 75.8265 };

const R = 6378137; // WGS84 equatorial radius (m)
const DEG = Math.PI / 180;
const M_PER_DEG_LAT = R * DEG;
const M_PER_DEG_LON = R * DEG * Math.cos(ORIGIN.lat * DEG);

/** lat/lon (deg) -> world {x, z} in metres. */
export function project(lat, lon) {
  return {
    x: (lon - ORIGIN.lon) * M_PER_DEG_LON,
    z: -(lat - ORIGIN.lat) * M_PER_DEG_LAT,
  };
}

/** world x/z (m) -> {lat, lon}. */
export function unproject(x, z) {
  return {
    lat: ORIGIN.lat - z / M_PER_DEG_LAT,
    lon: ORIGIN.lon + x / M_PER_DEG_LON,
  };
}

export const METRES_PER_DEG = { lat: M_PER_DEG_LAT, lon: M_PER_DEG_LON };
