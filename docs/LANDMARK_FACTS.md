# Landmark facts (verified against sources, not memory)

Web fetch of Wikipedia is blocked from the build sandbox, so facts were checked through web-search result snippets
(quotes paraphrased). Where sources conflict, the choice made is stated. Numbers marked *approx* are modelling
choices, not published figures.

## Coordinates used as fallbacks (real OSM positions override these when the data is baked)

| Place | lat, lon | Source |
|---|---|---|
| Hawa Mahal | 26.9239 N, 75.8267 E | Wikipedia (via search snippet) |
| Jantar Mantar | 26°55′29″N 75°49′28″E | Wikipedia (via search snippet) |
| Jal Mahal | 26.9537 N, 75.8463 E | latitude.to / Wikipedia (26°57′13″N 75°50′47″E) |
| Nahargarh Fort | 26.937255 N, 75.815490 E | Wikipedia (via search snippet) |
| Amer (Amber) Fort | 26°59′06″N 75°51′05″E | Wikipedia (26.9856, 75.8514) |
| Badi Chaupar (metro stn) | 26.922960 N, 75.826814 E | Wikipedia Badi Chaupar metro station |
| Chhoti Chaupar (metro stn) | 26.924720 N, 75.818456 E | Wikipedia |
| Chandpole (metro stn) | 26.926370 N, 75.807456 E | Wikipedia |
| Jaigarh Fort | crest at 26.9866 N, 75.8319 E, 657 m *(derived from the baked DEM; the snippet coordinate 26.9859, 75.8507 lies on Amer itself)* | DEM |

## Hawa Mahal
- Five storeys: Sharad Mandir, Ratan Mandir, Vichitra Mandir, Prakash Mandir, Hawa Mandir (top).
- Pyramidal profile, 953 small windows (jharokhas) in a honeycomb; red and pink sandstone with white lime motifs; built 1799,
  architect Lal Chand Ustad. It is an extension of the City Palace zenana (women's chambers): the celebrated street façade is the
  *back* of the palace; it was a screen for viewing the bazaar unseen.
- Height: **conflicting** — "50 ft (15 m)" is quoted for the façade above its raised base, "87 ft (26.5 m)" as the overall height.
  Model: ~26.5 m overall with the five façade storeys above a plinth.
- Upper three floors are one room deep; the lower two have courtyards/terraces in front (model: two full-depth storeys, three thin ones).

## Jantar Mantar (Jaipur)
- 19 instruments, built 1728-1734 for Sawai Jai Singh II; UNESCO World Heritage; largest stone sundial (Samrat Yantra).
- Samrat Yantra: 27 m tall, gnomon base 44 m, inclined 27° (Jaipur's latitude) toward the celestial pole, a pair of quadrants either
  side parallel to the equatorial plane; shadow moves ~1 mm/s (~6 cm/min); accuracy 2 s. Geometry check: 44 m × tan 27° = 22.4 m of
  gnomon wall + summit chhatri ≈ 27 m. (A separate source's "39 m hypotenuse" is inconsistent with 27 m at 27° and was not used.)
- Jai Prakash Yantra: two hemispherical bowls with marked marble slabs. Ram Yantra: two large open-topped cylindrical structures.
- Rashivalaya: twelve zodiac instruments unique to Jaipur, based on the Samrat design. Laghu Samrat: smaller, inclined 27°.
- Others (all present in the model as simplified forms): Narivalaya, Dakshinottara Bhitti, Kranti Vritta, Dhruva Darshak Pattika,
  Kapali, Disha Yantra. Compound layout is *approx*.

## Jal Mahal
- Five storeys in red/pink sandstone; four are submerged when Man Sagar is full (max depth ~4.5 m), only the top floor shows.
- Four octagonal chhatris at the corners; a roof garden (Chameli Bagh) with arched passages. Built ~1699 (Sawai Jai Singh), renovated mid-18th c.
- Footprint dimensions are not published in the sources found: *approx* 50 × 32 m.

## City Palace
- Chandra Mahal: seven levels (residence of the royal family). Mubarak Mahal: late-19th-century Indo-Saracenic reception hall
  (Madho Singh II). Pritam Niwas Chowk: four gates for the seasons (Peacock/autumn, Green/summer, Leheriya/spring, Rose/winter).
  Gates: Virendra Pol, Udai Pol, Tripolia. Diwan-i-Khas. Teej procession starts at Tripolia Gate.

## City wall & gates
- Wall: 6 m high, 3 m thick; walled city area ~6.5 km²; seven original gates (Chandpole west, Surajpole east, Ajmeri, Sanganeri,
  Ghat, Samrat/Zorawar Singh in the north), later a New Gate.
- Note: the brief's "2 km × 2 km" is approximate; the stated lat/lon bounds span ~2.9 km × 3.0 km. Bake zones follow the bounds.

## Amer Fort / Jaigarh / Nahargarh
- Amer: pale yellow and pink sandstone with white marble; four courtyards; Suraj Pol, Jaleb Chowk, Ganesh Pol (frescoed, latticed
  windows, chhatris), Diwan-i-Aam, Jai Mandir with Sheesh Mahal; overlooks Maota Lake. Jaigarh sits ~400 m above Amer on Cheel ka Teela.
- Nahargarh on the Aravalli edge above the city.

## Festival / astronomy dates
- Diwali 2026: Sunday 8 Nov 2026 (Kartik Amavasya; Amavasya tithi 11:27 IST 8 Nov → 12:31 IST 9 Nov). New moon 2026-11-09 07:02 UTC → moonless.
- Hariyali Teej 2026: Saturday 15 Aug 2026 (sources vary by regional panchang); Jaipur procession City Palace/Tripolia Gate → Tripolia Bazaar →
  Chhoti Chaupar → Gangauri Bazaar → Talkatora. New moon 12 Aug 2026 (3-day crescent).
- Makar Sankranti 2027: 14/15 January 2027.
