// Overpass zones + query builders shared by fetch-osm.mjs and bake-osm.mjs.
// bbox = [south, west, north, east] in degrees.

/** Approximate Walled City bounds from the brief; the fetch also asks OSM for the real boundary. */
export const WALLED_CITY_APPROX = [26.910, 75.812, 26.936, 75.842];

export const ZONES = [
  // Full detail: Walled City + ~450 m margin (bazaars, gates, outside-the-wall frontage).
  { id: 'core', bbox: [26.905, 75.807, 26.941, 75.847], tileDeg: 0.009, kind: 'core' },
  // Low detail ring of surrounding urban fabric (buildings + main roads + water/landuse).
  { id: 'ring', bbox: [26.880, 75.780, 26.966, 75.875], tileDeg: 0.0215, kind: 'ring' },
  // Hero silhouettes beyond the city.
  { id: 'amer', bbox: [26.972, 75.832, 26.998, 75.866], tileDeg: 0.013, kind: 'fort' },
  { id: 'jalmahal', bbox: [26.944, 75.830, 26.975, 75.862], tileDeg: 0.0155, kind: 'fort' },
  { id: 'nahargarh', bbox: [26.925, 75.798, 26.952, 75.828], tileDeg: 0.0135, kind: 'fort' },
];

const bb = (b) => b.map((v) => v.toFixed(5)).join(',');

/** Build the Overpass QL for one tile. */
export function buildQuery(kind, bbox) {
  const B = `(${bb(bbox)})`;
  const head = '[out:json][timeout:240];\n(\n';
  const tail = '\n);\nout geom;';
  let body;
  if (kind === 'core') {
    body = [
      `way["building"]${B};`,
      `relation["building"]${B};`,
      `way["building:part"]${B};`,
      `way["highway"]${B};`,
      `relation["highway"="pedestrian"]${B};`,
      `way["barrier"~"city_wall|wall|fence|retaining_wall|gate"]${B};`,
      `way["historic"]${B};`,
      `relation["historic"]${B};`,
      `node["historic"]${B};`,
      `way["man_made"]${B};`,
      `node["man_made"~"tower|lighthouse|flagpole|water_tower|street_cabinet"]${B};`,
      `nwr["amenity"~"place_of_worship|marketplace|parking|fountain|bus_station|taxi|police|school|college|hospital|bank|restaurant|cafe"]${B};`,
      `nwr["tourism"]${B};`,
      `nwr["shop"]${B};`,
      `node["highway"~"street_lamp|traffic_signals|crossing|bus_stop"]${B};`,
      `node["natural"="tree"]${B};`,
      `way["natural"~"water|wood|scrub|tree_row"]${B};`,
      `relation["natural"="water"]${B};`,
      `way["waterway"]${B};`,
      `way["landuse"]${B};`,
      `way["leisure"]${B};`,
      `relation["leisure"]${B};`,
      `way["public_transport"]${B};`,
      `way["railway"]${B};`,
      `relation["boundary"]["name"~"Walled|Pink|Old City|Parkota|Purana|Chandpole|Surajpole",i]${B};`,
      `relation["place"]${B};`,
      `way["place"]${B};`,
      `nwr["name"~"Hawa Mahal|Jantar Mantar|City Palace|Badi Chaupar|Chhoti Chaupar|Johari|Jal Mahal|Govind|Tripolia|Isarlat|Sargasuli|Chandpole|Surajpole|Ajmeri|Sanganeri|Albert Hall|Ram Niwas|Jama Masjid|Choura Rasta|Kishanpole|Tripolia|Nahargarh|Amer|Amber",i]${B};`,
    ].join('\n');
  } else if (kind === 'ring') {
    body = [
      `way["building"]${B};`,
      `relation["building"]${B};`,
      `way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"]${B};`,
      `way["natural"~"water|wood|scrub"]${B};`,
      `relation["natural"="water"]${B};`,
      `way["waterway"~"river|stream|canal"]${B};`,
      `way["landuse"~"forest|residential|commercial|industrial|retail|farmland|grass|meadow|recreation_ground|cemetery|military"]${B};`,
      `way["leisure"~"park|garden|pitch|stadium|golf_course"]${B};`,
      `way["barrier"~"city_wall"]${B};`,
      `way["historic"~"fort|citywalls|city_gate"]${B};`,
      `nwr["historic"~"fort|palace|castle|monument"]${B};`,
    ].join('\n');
  } else {
    // fort / lake silhouettes
    body = [
      `way["building"]${B};`,
      `relation["building"]${B};`,
      `way["barrier"~"city_wall|wall|retaining_wall|gate"]${B};`,
      `way["historic"]${B};`,
      `relation["historic"]${B};`,
      `nwr["tourism"]${B};`,
      `way["man_made"]${B};`,
      `way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|track|path|footway|steps)$"]${B};`,
      `way["natural"~"water|wood|scrub|cliff|rock"]${B};`,
      `relation["natural"="water"]${B};`,
      `way["waterway"]${B};`,
      `way["landuse"~"forest|reservoir|basin|residential|grass|meadow"]${B};`,
      `way["leisure"]${B};`,
      `nwr["name"~"Jal Mahal|Man Sagar|Amer|Amber|Jaigarh|Nahargarh|Maota|Kesar|Dilaram|Sheesh|Ganesh Pol|Sukh|Jaleb|Sagar|Palace|Fort",i]${B};`,
    ].join('\n');
  }
  return head + body + tail;
}

/** Split a bbox into a grid of roughly tileDeg-sized tiles. */
export function splitBBox(bbox, tileDeg) {
  const [s, w, n, e] = bbox;
  const ny = Math.max(1, Math.ceil((n - s) / tileDeg));
  const nx = Math.max(1, Math.ceil((e - w) / tileDeg));
  const out = [];
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++)
      out.push({ i, j, bbox: [s + ((n - s) * j) / ny, w + ((e - w) * i) / nx, s + ((n - s) * (j + 1)) / ny, w + ((e - w) * (i + 1)) / nx] });
  return out;
}
