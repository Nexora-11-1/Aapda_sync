# Third-party material

The MIT licence in `LICENSE` covers the source code in this repository. It does
not cover the material listed here, each item of which carries its own terms.
Read this file before redistributing a build.

---

## Map geometry

| Layer | File | Source | Licence |
|---|---|---|---|
| India — 36 states and union territories | `frontend/standalone/assets/india-states.js` | [`@svg-maps/india`](https://github.com/VictorCazanave/svg-maps) | MIT |
| World — Admin-0 country outlines | `frontend/standalone/assets/world.js` | [Natural Earth](https://www.naturalearthdata.com/) 4.1.0, 1:110,000,000, via `world-atlas` 2.0.2 (TopoJSON) | Natural Earth is public domain; the TopoJSON redistribution is ISC |

Both layers are small-scale reference outlines for navigation and context.
World coordinates are rounded to 0.01° — roughly 1.1 km at the equator.

> **Neither layer is a survey boundary.** They must not be used to determine
> where a border lies, and the India geometry predates later administrative
> reorganisation. `docs/12-audit-and-limitations.md` states this in full.

---

## Photographs

Event photographs live in `frontend/standalone/assets/photos/` and their
attribution lives beside them in `credits.json`. The build reads that file and
**will not display a photograph that has no `credit` and no `licence`** — it
falls back to the drawn illustration, which is labelled as an illustration.
This rule is enforced in `frontend/standalone/build.js`, not asserted in prose.

`credits.json` also carries a `verified` flag. `false` means the attribution was
recorded from a plausible source but has **not** been checked against the source
file page itself. Those photographs still render, carrying a visible
*attribution unverified* caption, and the build prints a reminder naming each one.

**At the time of writing, five of the six shipped photographs are marked
`"verified": false`** — `chennai15`, `kedar13`, `kerala18`, `mumbai05`,
`wayanad24`. Open each file page, write the author and licence version down
exactly, and set `verified` to `true`.

Two photographs are handled as deliberate exceptions, recorded in `credits.json`
rather than left to be rediscovered:

- **Latur 1993** — the supplied photograph shows a casualty in the rubble. The
  project's rule for the memorial is that it shows the ground and the weather and
  never the dying. That slide keeps its illustration.
- Any photograph offered without an attribution is skipped by the build rather
  than published unattributed.

Usual sources for imagery that may be republished: public-domain Government of
India releases (PIB, ISRO/NRSC, NDRF), NASA, NOAA, and Creative Commons
photographs on Wikimedia Commons. Most CC licences legally require attribution,
which is why the import panel asks for the credit in the same moment as the file.

---

## Data sources

The platform reads live public feeds at runtime. It redistributes none of them.
Each connector reads its endpoint from configuration, and
**`docs/10-data-sources.md` is the only place in this repository where a source
URL may be asserted.** Terms of use belong to the issuing authority:

IMD · NDMA SACHET · CWC · Bhuvan/NRSC · INCOIS ERDDAP · NCS · USGS FDSN ·
Open-Meteo · OSM Overpass (ODbL) · NASA FIRMS · OpenTopography · WorldPop ·
GDACS · GloFAS/JRC.

Check each authority's own terms before operating a public deployment against it.

---

## Fonts

The dashboard requests two web fonts and **falls back to system fonts cleanly
when they are unavailable**, which is the whole of its network dependency. An
air-gapped deployment loses the typeface and nothing else.

---

## A note on what is simulated

Coverage and registers are separated deliberately. Modelled risk is national and
computed from real feeds. Registers — shelter capacity, road state — are local,
and only Chamoli District, Uttarakhand is integrated. Every other state shows a
**provisional register**, and the interface says so on the screen, every time.
Nothing in this repository should be read as an official figure for any real
place. See `docs/12-audit-and-limitations.md`.
