# Browser tests

These run the built single-file dashboard in a real browser and assert
behaviour, not markup. They found the defects listed in the root README.

```bash
npm i -D playwright && npx playwright install chromium
node build.js
node test/ui.spec.mjs            # 49 checks: auth, all 36 states, a11y, guide, zoom, RAG, citizen
node test/live-feed.spec.mjs     # the national feed stays current and new warnings reach it
node test/map-zoom.spec.mjs      # the public map fills its box and frames on the reader's state
node test/interaction.spec.mjs   # scrolling, map gestures, the slideshow, the report form, 7 viewports
node test/photos.spec.mjs        # what ships, the credit rule that gates it, and no layout shift
node test/navigation.spec.mjs    # every screen reachable by clicking, at 4 widths (slow)
node test/security.spec.mjs        # injection probe across every screen and drawer
node test/security-inputs.spec.mjs # the same, through the real input surfaces
node test/seasonal.spec.mjs      # the picture, the words and the warnings follow the season
node test/livedata.spec.mjs      # observations replace the model only while they are fresh
node test/geo.spec.mjs           # the world layer, and what it admits it does not have
```

Each prints `ok` / `FAIL` per check and the console error count, which must
be zero. They point at `../dist/aapdasync.html`, so build first.

`navigation.spec.mjs` earns its own file. Every screen in this application
worked and, on the public portal, none of them could be reached: `.hnav` is
hidden below 1720px by a rule inherited from the design system, which is right
for District Command — it has a sidebar — and left the citizen portal with no
navigation at all on any ordinary screen. A suite that renders a view by setting
state will never catch that. This one clicks.

`interaction.spec.mjs` earns its own for the same reason from the other
direction: every screen rendered correctly and the application still felt as
though it were fighting the reader. Nothing it asserts is about what is on the
screen — it is about what happens under a hand. It holds four things fixed:

- **The live loop keeps the reader's place.** Scroll position survives it, the
  landing page is not rebuilt by it, and the figures still move.
- **The map does not take the page's scroll.** A plain wheel over the map
  scrolls the page and says how to zoom; Ctrl and the wheel zooms, by under 16%
  a notch; a two-pixel twitch does not pan and a deliberate drag does; a pan does
  not open whatever it ended on; one finger scrolls on touch.
- **The slideshow is operable and otherwise still.** It advances slowly, holds
  under a cursor, stops for good when someone presses a control, and only ever
  decodes the slide you can see and its neighbours.
- **A half-written incident report is not thrown away**, is refused at the field
  rather than in a corner, and reaches the operator queue and the assistant with
  the reader's own words and their own choice of zone.

It finishes by checking all six public screens at the seven viewports in the
brief for horizontal overflow — 1920×1080 down to 390×844.
