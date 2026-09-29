#!/usr/bin/env python3
"""Pull the Overture Maps building footprints that are NOT already OpenStreetMap buildings, for the Jaipur zones, into a JSON-lines file.

Called by scripts/fetch-overture.mjs (which has already picked the parquet files that overlap the zones from the Overture STAC catalog).
Requires:  python3 -m pip install duckdb        (development tool only, never shipped)

Each output line: { id, name, height, floors, cls, subtype, roof, facade, ds, lic, geom }   geom = GeoJSON (lon/lat, WGS84)
Only buildings whose sources do not include OpenStreetMap are kept: the OSM ones are already baked from Overpass (this fills the gaps, it does not replace OSM).
Overture buildings are ODbL (they contain OSM) with Microsoft, Google and Esri footprints as the other sources.
"""
import argparse
import json
import sys
import time

import duckdb

ap = argparse.ArgumentParser()
ap.add_argument('--files', required=True, help='JSON list of parquet URLs')
ap.add_argument('--zones', required=True, help='JSON list of [south, west, north, east]')
ap.add_argument('--out', required=True)
args = ap.parse_args()

files = json.load(open(args.files))
zones = json.load(open(args.zones))
con = duckdb.connect()
con.execute('INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial;')
src = '[' + ','.join("'" + f.replace("'", "''") + "'" for f in files) + ']'
box = ' OR '.join(f'(bbox.xmin < {e} AND bbox.xmax > {w} AND bbox.ymin < {n} AND bbox.ymax > {s})' for s, w, n, e in zones)
osm = "list_contains([s.dataset for s in sources], 'OpenStreetMap')"
t0 = time.time()
total, from_osm = con.execute(f'SELECT count(*), count(*) FILTER (WHERE {osm}) FROM read_parquet({src}) WHERE {box}').fetchone()
print(f'{total} Overture buildings in the zones, {from_osm} of them come from OpenStreetMap ({time.time() - t0:.0f}s)', file=sys.stderr, flush=True)
con.execute(f"""COPY (
  SELECT id, names.primary AS name, height, num_floors AS floors, class AS cls, subtype, roof_shape AS roof, facade_color AS facade,
         sources[1].dataset AS ds, sources[1].license AS lic, ST_AsGeoJSON(geometry) AS geom
  FROM read_parquet({src})
  WHERE ({box}) AND NOT {osm} AND coalesce(is_underground, false) = false
) TO '{args.out}' (FORMAT json)""")
kept = sum(1 for _ in open(args.out))
print(f'kept {kept} non-OSM footprints -> {args.out} ({time.time() - t0:.0f}s)', file=sys.stderr, flush=True)
print(json.dumps({'total': total, 'fromOsm': from_osm, 'kept': kept}))
