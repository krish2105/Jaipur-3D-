# Landmark facts (verified against sources that were actually opened)

Verification pass of 2026-09-29. Method: the raw wikitext of each English Wikipedia article was downloaded
(`https://en.wikipedia.org/w/index.php?title=<Article>&action=raw`) and the sentences below were read in it; a second, independent
source was opened where Wikipedia is thin or contradicts itself. Where sources conflict the conflict is stated together with the
choice made and why. Anything that is a modelling choice rather than a published figure is labelled **approx**.
Positions in the running app come from OpenStreetMap (baked manifest); the coordinates here are only fallbacks / cross-checks.

Status labels: **verified** = read in an opened page; **conflict** = sources disagree; **brief** = value given in the project brief and
not confirmed by any page opened; **approx** = modelling choice.

## Coordinates (fallbacks and cross-checks)

| Place | lat, lon | Source (opened) |
|---|---|---|
| Hawa Mahal | 26.9239 N, 75.8267 E | Wikipedia *Hawa Mahal* infobox `{{coord|26.9239|75.8267}}` |
| Jantar Mantar | 26.92472 N, 75.82444 E | Wikipedia *Jantar Mantar, Jaipur* infobox |
| City Palace | 26.9257 N, 75.8236 E (infobox); 26.9255 N, 75.8236 E (body text) | Wikipedia *City Palace, Jaipur* (the two figures differ by ~20 m) |
| Jal Mahal | 26.9537 N, 75.8463 E (26°57′13″N 75°50′47″E) | Wikipedia *Jal Mahal* (via page fetch) |
| Man Sagar Lake | 26.956 N, 75.85 E | Wikipedia *Man Sagar Lake* infobox |
| Nahargarh Fort | 26.937255 N, 75.815490 E | Wikipedia *Nahargarh Fort* infobox |
| Amber (Amer) Fort | 26.9859 N, 75.8507 E | Wikipedia *Amber Fort* infobox |
| Jaigarh Fort | **26.98469 N, 75.84540 E** (OSM node `Jaighar Fort`, historic=castle). Wikipedia's 26.9859 N, 75.8507 E is the same point as Amer Fort and is not usable. The earlier DEM-crest estimate 26.9866 N, 75.8319 E is **1.36 km west-north-west of the fort, on a different and higher peak (DEM 649 m vs 592 m at the fort)** and is NOT Jaigarh. | OSM (fetched 2026-09-29); Wikipedia *Jaigarh Fort*; baked DEM |
| Badi Chaupar (metro stn) | 26.922960 N, 75.826814 E | Wikipedia (earlier pass) |
| Chhoti Chaupar (metro stn) | 26.924720 N, 75.818456 E | Wikipedia (earlier pass) |
| Chandpole (metro stn) | 26.926370 N, 75.807456 E | Wikipedia (earlier pass) |

## Hawa Mahal
- Built 1799 by Maharaja Sawai Pratap Singh; architect Lal Chand Ustad; red and pink sandstone. **verified** (Wikipedia *Hawa Mahal*).
- Five-storey pyramidal monument. "The top three floors of the structure have the width of a single room, while the first and second
  floors have patios in front of them." **verified** (same).
- **953** windows, "jharokhas", in a honeycomb pattern. **verified** (Wikipedia; its cited Incredible India page). One other page opened
  (Sahapedia) says "300-plus jharokhas": **conflict**; 953 chosen because two sources agree and it is the figure the project requires.
- Height: **conflict.** Wikipedia: "rises to about 50 ft (15 m)". Sahapedia (opened): "this 87-ft tall monument" and "rising to a height of
  over 80 ft". Choice: the model is ~26.5 m overall (87 ft) with five façade storeys above a plinth. Why: 15 m cannot hold five storeys plus the
  raised plinth and the crown pavilions seen in photographs; the 50 ft figure is plausibly the façade above its base. **approx**. If the OSM way
  carries a `height` tag it is logged by the baker and shown in PROGRESS.md.
- The famous honeycomb façade is the **eastern** façade and it is the palace's **back**: Wikipedia: "Many people see the Hawa Mahal from the street
  view and think it is the front of the palace, but it is the back" and the façade "is a stark contrast to the plain-looking rear side".
  Entry is "from the City Palace side through an imperial door" into a large courtyard "which has double-storeyed buildings on three sides, with
  the Hawa Mahal enclosing it on the east side". **verified** (Wikipedia). It extends the City Palace zenana.
- Walls of the pavilion are ~9 inches thick (Sahapedia). The top two floors are reached by ramps only (Wikipedia).

## Jantar Mantar (Jaipur)
- 19 instruments; built for Sawai Jai Singh II; construction begun by 1728, monument completed 1734 (work continued to 1738). **verified** (Wikipedia).
- UNESCO World Heritage 2010, ref. 1338. **verified** (Wikipedia).
- Site area **1.8652 ha** (infobox); text: instruments "spread over about 18,700 square metres". **verified** (Wikipedia). Compound layout inside that area is **approx**.
- Vrihat Samrat Yantra: "88 feet (27 m) high"; "its face is angled at 27 degrees, the latitude of Jaipur"; accuracy ~2 s; shadow ~1 mm/s
  (~6 cm/min). **verified** (Wikipedia). The gnomon is "a triangular wall with its hypotenuse parallel to earth's axis, and a pair of quadrants on either
  side, lying parallel to the plane of the equator" **verified** (jantarmantar.org/learn/observatories/instruments/samrat).
- Gnomon base length **44 m**: **brief**. It appears only in a search-result summary of a Border Sundials page; neither Wikipedia nor jantarmantar.org states
  it. Geometry note: 44 m x tan 27° = 22.4 m of gnomon wall, plus summit chhatri, is consistent with 27 m overall. Kept because it is self-consistent, but
  not counted as verified.
- Yantra Raj Yantra: a 2.43 m bronze astrolabe. Other instruments named in Wikipedia's list of 19: Rashi Valaya (12 gnomon dials), Kapali, Jai Prakash,
  Ram Yantra, Kanmala etc. Sizes of these are not given; the model's are **approx**.

## Jal Mahal
- Five-storey building of local pink and red sandstone in the middle of Man Sagar Lake; four octagonal chhatris at the corners; top-floor terrace
  "features a central garden with arched passages". **verified** (Wikipedia *Jal Mahal*).
- How much is submerged: **conflict inside Wikipedia itself.** One sentence says that at full lake level (depth ~4.5 m) "the lower story remains submerged";
  another says "the lower four-story interior of the palace remains closed". The Incredible India page (fetched) says "most of the building rests
  submerged beneath the lake's surface, with only the top floor visible". Choice: only the top floor plus the roof garden and chhatris show above water,
  the four lower floors are below the waterline. **approx** (the depth of the lake at the palace varies with the season).
- Built around 1699 by Sawai Jai Singh as a duck-hunting lodge; renovated and enlarged in the mid-18th century by Madho Singh I. **verified** (Wikipedia).
- Man Sagar: built c.1610 by Raja Man Singh by damming the Dravyavati river; max depth 4.5 m; area quoted as 139 ha (infobox) and "300 acres" (about 121 ha) in
  the text: **conflict** of ~15 %; the app uses the OSM water polygon instead. Catchment 23.5 km². **verified** (Wikipedia *Man Sagar Lake*).
- Footprint dimensions are not published in any source opened: 52 x 32 m is **approx**.

## City Palace
- Construction began after Jai Singh II moved his court from Amber in 1727; palace founded 1729-1732 (the *City Palace, Jaipur* article gives 1727 for the move; the
  1729/1732 years came from the page-fetch summary and are not used in the model). Architect Vidyadhar Bhattacharya designed the city (Wikipedia *Jaipur*: planned
  "according to the Indian Vastu shastra by Vidyadhar Bhattacharya in 1727"). **verified** (Wikipedia).
- **Chandra Mahal: seven floors** ("a number considered auspicious by Rajput rulers"); named parts: Sukh Niwas, Shobha Niwas, Chhavi Niwas, Shri Niwas, Mukut
  Mandir (the crowning pavilion). **verified**.
- **Mubarak Mahal**: "fully developed as late as 1900, when the court architect of the time, Lala Chiman Lal, constructed the Mubarak Mahal in its centre";
  façade "identical on all four sides" with a hanging balcony, white andhi marble and beige stone; built for receiving foreign guests. **verified**.
  (An earlier version of this file credited Madho Singh II; the article credits the court architect Lala Chiman Lal.)
- Entrance gates: Udai Pol near Jaleb Chowk (leads to the Diwan-e-Aam, Sabha Niwas), Virendra Pol near Jantar Mantar, Tripolia (three gates; reserved for the royal
  family). **verified**.
- Pritam Niwas Chowk's four gates (Ridhi Sidhi Pol): **NE Peacock Gate** (autumn, Vishnu), **SE Lotus Gate** (summer, Shiva-Parvati), **NW Green / Leheriya Gate**
  (spring, Ganesha), **SW Rose Gate** (winter, Devi). **verified**. (The previous version of this file paired Green with summer and omitted Lotus: wrong.)
- Diwan-i-Khas (Sarvato Bhadra): "a single-storeyed, square, open hall, with enclosed rooms at the four corners". **verified**.

## City wall & gates
- "Approximately six meters high and three meters thick", red sandstone (lime and brick techniques), "seven main gates"; UNESCO listing of Jaipur City 2019.
  **verified** (Wikipedia *City wall of Jaipur*). Gates listed there: Chandpole, Surajpole, Ajmeri, New Gate (Nayapole), Sanganeri, Ghat, Samrat (Zorawar Singh).
  That article's compass sides are inconsistent (it puts Samrat Gate on the west); gate positions in the app come from OSM `historic=city_gate` / `barrier=gate`
  nodes, not from prose.
- Note: the brief's "2 km x 2 km" is approximate; the stated lat/lon bounds span ~2.9 km x 3.0 km. Bake zones follow the bounds.

## Amer / Jaigarh / Nahargarh
- Amer (Amber) Fort: begun 1592 by Raja Man Singh, expanded by Jai Singh I and later rulers; six main sections each with its own gate and courtyard; Suraj Pol
  (Sun Gate) leads to the first courtyard (Jaleb Chowk); Ganesh Pol is "a three-level structure with many frescoes" into the private palaces; second courtyard
  Diwan-i-Aam (27 colonnades); third courtyard has Jai Mandir (Sheesh Mahal) and Sukh Niwas with a sunken hexagonal Mughal-style garden between them; sits on a
  promontory jutting into Maota Lake. **verified** (Wikipedia *Amber Fort*).
- Jaigarh Fort: on Cheel ka Teela; "built about 400 m above the Amer Fort"; 3 km x 1 km layout; red sandstone walls; a 50 m square garden inside; built 1726;
  Jaivana cannon 1720. **verified** (Wikipedia *Jaigarh Fort*). "10 km from Jaipur city".
- Nahargarh Fort: built mainly 1734 by Sawai Jai Singh II on the ridge above the city; walls "extended over the surrounding hills, forming fortifications that
  connected this fort to Jaigarh"; extended 1868 and palaces added 1883-92. Wikipedia's infobox elevation "213 m (700 feet)" is stated without a reference frame
  and is not used. **verified** (Wikipedia *Nahargarh Fort*).

## Festival / astronomy dates (from the earlier pass; astronomy verified by tests/astro.test.mjs)
- Diwali 2026: Sunday 8 Nov 2026 (Kartik Amavasya; Amavasya tithi 11:27 IST 8 Nov → 12:31 IST 9 Nov). New moon 2026-11-09 07:02 UTC → moonless.
- Hariyali Teej 2026: Saturday 15 Aug 2026 (sources vary by regional panchang); Jaipur procession City Palace/Tripolia Gate → Tripolia Bazaar →
  Chhoti Chaupar → Gangauri Bazaar → Talkatora. New moon 12 Aug 2026 (3-day crescent).
- Makar Sankranti 2027: 14/15 January 2027.

## OSM cross-checks (OpenStreetMap data timestamp 2026-09-29T10:32:01Z, fetched via Overpass on 2026-09-29)

These are measurements of the baked OSM data, used for placement; they are not claims about the monuments.

- **Hawa Mahal**: OSM has only a node (`historic=monument`, `wikidata=Q836531`) at 36.2 E / -48.1 N of Badi Chaupar (26.9239 N, 75.8267 E area), about 16 m from Wikipedia's coordinate. There is no outline of the palace: node and coordinate both lie inside one
  building multipolygon (`r1460207`, tagged "Saraogi Mansion", 1 level), 110 x 55 m oriented box. The node sits 4 m from that block's east edge, so the facade (east face) is placed on the block's east edge at the node's position along the street.
- **Jantar Mantar**: compound wall polygon `w102879535` has an area of **18,760 m²**, which agrees with Wikipedia's "about 18,700 square metres" (and 1.8652 ha in the infobox). Mapped instruments inside it: Vrihat Samrat Yantra (`w102878289`, 44.4 x 41.0 m footprint, long axis N-S),
  Rashi Valaya Yantra zone (`w705888124`, 40.6 x 34.6 m), two Ram Yantras (8.4 and 8.6 m), Observer's room (4.5 x 3.7 m). The Samrat footprint's 44.4 m N-S length agrees with the brief's 44 m gnomon base (this is the only corroboration found for it).
  The other instruments (Jai Prakash, Laghu Samrat, Narivalaya, Dakshinottara Bhitti, Kapali, Kranti Vritta, Dhruva Darshak Pattika ...) are **not mapped in OSM and are not placed** (nothing is invented). Dial positions inside the Rashi Valaya zone are *approx* (the zone is real).
- **Jal Mahal**: OSM way `w134990320` (`historic=castle`): a near-square body about **59 x 55 m** (3,452 m² outline) with four round corner bases of radius ~3.6 m and an 11.4 x 4.6 m projecting porch on the WEST face, which agrees with Wikipedia's "the local roadside promenade faces west". The earlier 52 x 32 m assumption was wrong and is replaced.
  The lake outline comes from the baked terrain water mask plus the OSM water polygon (Man Sagar `r2252564`, Maota Lake `r15961875`, Hanuman Sagar `r9190000`). Height of the water surface: 411 m ASL (flat SRTM texels).
- **City Palace**: OSM outline `w455720627` (`historic=castle`), 208 x 202 m oriented box. Chandra Mahal `w521002319`: 47.2 x 23.1 m. Mubarak Mahal `w170191935`: 27.5 x 27.1 m (22-point outline). The Tripolia gate exists as a node (`barrier=gate`, `access=private`) inside an unnamed `historic=city_gate` building outline `w631482568` (87.6 x 55.8 m, kept as an OSM extrusion).
  Storey heights and setbacks of the models are *approx*.
- **City gates in OSM** are `historic=city_gate` **building outlines** (Ajmeri Gate has three, Man Gate / "New gate" one) plus a few nodes; 18 gates baked. The Walled City itself has **no boundary object in OSM** (baked boundary = the brief's rough bounds, labelled `approx-brief`).
- **City wall in OSM**: only fragments are mapped inside the core (`barrier=city_wall`, some as `area=yes` polygons); 52 wall solids (6 m x 3 m) exist in the whole baked area, most of them around the forts. The wall is drawn only where OSM maps it.
- **Amer / Jaigarh / Nahargarh**: OSM has Amer's Suraj Pol and Chand Pol (city_gate nodes), Jaleb Chowk, Diwan-i-Aam, Diwan-i-Khas, Sheesh Mahal, Sukh Niwas, 31 `barrier=city_wall` ways and ~1,800 buildings in the Amer zone, `Jaighar Fort` (node) and `Nahargarh Fort` (node).
  DEM heights (SRTM via Terrarium, 15.6 m texels): Amer Fort 477 m, **Jaigarh 592 m, i.e. ~115 m above Amer** (Wikipedia says "about 400 m above the Amer Fort": **conflict**; the DEM is what the terrain uses), Nahargarh 589 m, Hawa Mahal 443 m.

## Festival lighting and kites (Phase 8): what is sourced and what is modelling choice

Sources were opened through web search on 2026-09-29 (secondary / tourism pages: qualitative claims only, no numbers are taken from them).
- **Diwali lighting of the Walled City**: the Walled City is decorated with lights and the bazaars compete in illumination; Johari Bazaar, Bapu Bazaar, Tripolia Bazaar and MI Road / Chandpol are named; Johari is described as glowing yellow-gold while Bapu and Tripolia are multicolour; Hawa Mahal, City Palace and Albert Hall are specially lit; fairy lights, lanterns and diyas.
  Sources: dwsjewellery.com/blog/jaipur-illuminated-diwali-light-decorations-in-pink-city/ ; jaipurlove.com/diwali-jaipur-celebration-ritual/ ; thenestluxuryresorts.com/diwali-in-jaipur-2025-lights-festivities-and-royal-celebrations/ (weak, qualitative).
  **Used for**: which named bazaars carry strings (`src/festival/layout.js` FESTIVAL_STREETS), the gold vs multicolour themes, and floodlit Hawa Mahal / City Palace / gates. **Not used**: any count, spacing, colour value or date range: those are *approx* art direction.
- **Makar Sankranti / kites in Jaipur**: follows the solar calendar (14 Jan, sometimes 15 Jan); rooftops fill with kite fliers who try to cut each other's strings; the state runs an International Kite Festival in Jaipur on about 14-16 January.
  Sources: en.wikipedia.org/wiki/Makar_Sankranti ; rajasthanplaces.com/festivals/kite-festival-jaipur/ ; jaipurunveiled.com/makar-sankranti-international-kite-festival-in-jaipur/.
  **Used for**: rooftop launch points (real OSM footprints), kite fighting (random cut strings), the winter preset. **Approx / not sourced**: kite size (~0.5-0.75 m), aerodynamic coefficients, string length (45-120 m), the 7 m/s wind (chosen so kites fly; not a climate record) and the exaggerated minimum on-screen size.
- **Street lamps**: OSM has **no** street-lamp nodes in the baked area (0 instances). Lamps are *generated* along OSM roads (spacing 28-50 m by road class, alternating sides): this is *approx*, not a survey. The README says so.
- **Diwali is moonless** in the simulation: new moon 2026-11-09 07:02 UTC, i.e. the evening of Sunday 8 Nov 2026 has a ~1 % crescent below the horizon (`tests/festival-env.test.mjs`, `tests/astro.test.mjs`).
