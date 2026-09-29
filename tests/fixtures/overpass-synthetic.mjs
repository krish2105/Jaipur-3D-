// SYNTHETIC TEST FIXTURE. NOT Jaipur data. Never baked into public/data.
// It only reproduces the *shape* of an Overpass `out geom` response so the baker can be unit-tested.
import { unproject } from '../../src/core/geo.js';

const ll = (x, z) => { const p = unproject(x, z); return { lat: p.lat, lon: p.lon }; };
const rect = (x, z, w, d) => [ll(x, z), ll(x + w, z), ll(x + w, z + d), ll(x, z + d), ll(x, z)];

export const elements = [
  { type: 'way', id: 1, tags: { building: 'yes', height: '12 m' }, geometry: rect(10, 10, 20, 10) },
  { type: 'way', id: 2, tags: { building: 'yes', 'building:levels': '3' }, geometry: rect(40, 10, 12, 10) },
  { type: 'way', id: 3, tags: { building: 'yes' }, geometry: rect(60, 10, 14, 12) },          // height inferred
  { type: 'way', id: 4, tags: { building: 'temple', name: 'Test Temple' }, geometry: rect(10, 40, 10, 10) },
  { type: 'way', id: 5, tags: { building: 'yes', height: '20' }, geometry: rect(-30, -30, 20, 20) },
  { type: 'way', id: 6, tags: { 'building:part': 'yes', height: '9' }, geometry: rect(-25, -25, 6, 6) },   // part inside #5
  { type: 'way', id: 7, tags: { building: 'yes' }, geometry: rect(500, 10, 10, 10) },        // second tile
  { type: 'way', id: 8, tags: { building: 'yes' }, geometry: rect(1000, 10, 1, 1) },         // too small
  {
    type: 'relation', id: 9, tags: { type: 'multipolygon', building: 'yes', height: '10' },
    members: [
      { type: 'way', role: 'outer', ref: 90, geometry: [ll(200, 200), ll(230, 200), ll(230, 215)] },
      { type: 'way', role: 'outer', ref: 91, geometry: [ll(230, 215), ll(230, 230), ll(200, 230), ll(200, 200)] },
      { type: 'way', role: 'inner', ref: 92, geometry: rect(210, 210, 5, 5) },
    ],
  },
  { type: 'way', id: 20, tags: { highway: 'primary', name: 'Test Road', oneway: 'yes', lanes: '2' }, nodes: [1, 2, 3], geometry: [ll(-100, 0), ll(400, 0), ll(700, 0)] },
  { type: 'way', id: 21, tags: { highway: 'residential' }, nodes: [10, 2, 11], geometry: [ll(400, -200), ll(400, 0), ll(400, 200)] },
  { type: 'way', id: 22, tags: { highway: 'footway' }, nodes: [30, 31], geometry: [ll(0, 50), ll(30, 50)] },
  { type: 'node', id: 100, lat: ll(5, 5).lat, lon: ll(5, 5).lon, tags: { highway: 'street_lamp' } },
  { type: 'node', id: 101, lat: ll(6, 6).lat, lon: ll(6, 6).lon, tags: { natural: 'tree' } },
  { type: 'way', id: 30, tags: { barrier: 'city_wall', name: 'Test Wall' }, geometry: [ll(-100, 300), ll(600, 300)] },
  { type: 'way', id: 31, tags: { natural: 'water' }, geometry: rect(300, 300, 100, 60) },
  { type: 'way', id: 40, tags: { building: 'yes', name: 'Hawa Mahal Test' }, geometry: rect(100, 100, 30, 8) },
];
