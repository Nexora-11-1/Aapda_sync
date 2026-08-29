# NOTICE — third-party material

`LICENSE` (MIT) covers **the code in this repository and nothing else**. Three
things ship alongside the code on different terms, and two of them are unresolved.

---

## 1. The six record photographs — UNRESOLVED, ACTION NEEDED

`src/photos-bundled.js` contains six photographs, inlined as data URIs, on the
public "The record" carousel.

**No credit, source or licence is recorded for any of them.** They were supplied
for the build and their provenance was never established. They have the look of
press photography, which is almost always all-rights-reserved.

They are **not** covered by the MIT licence above. Before this repository is made
public, published, or submitted anywhere, one of the following has to happen:

- establish the source and licence of each frame and record it in
  `train/bundle_photos.py` under `credit`, then re-run it; or
- replace them with material you can licence — Wikimedia Commons categories for
  all six events are listed in `assets/photos/README.txt`; or
- remove them, which is a one-line change: delete the `<script src="src/photos-bundled.js">`
  tag from `index.html` and the cards fall back to the rendered illustrations in
  `src/scenes.js`, which are original to this project and MIT-licensed with it.

Separately, several of the frames **are not the event on their card**. That is
disclosed in the UI rather than hidden — each caption says what the frame
actually shows, permanently, and `train/bundle_photos.py` records the reasoning
per file. See the "Images" section of `README.md`.

| Card | Caption states |
|---|---|
| 1984 Bhopal | the derelict plant, photographed years after the release |
| 1999 Odisha | likely a later cyclone, not 1999 |
| 2001 Bhuj | likely not Bhuj — collapsed reinforced concrete, not the low-rise masonry Bhuj destroyed |
| 2013 Kedarnath | the Ganga in spate, not Kedarnath town |
| 2018 Kerala | consistent with the event |
| 2021 Chamoli | consistent with the event |

---

## 2. State geometry — CC BY 4.0

Boundaries for 36 states and union territories in `src/india.js` derive from
[**@svg-maps/india**](https://www.npmjs.com/package/@svg-maps/india), licensed
**CC BY 4.0**, converted to absolute polylines and thinned to 0.2 viewBox units.

Attribution is required and is given here and in `README.md`. The geometry
predates the 2019 reorganisation of Jammu & Kashmir and Ladakh and is labelled
illustrative in the interface for that reason.

---

## 3. Fonts — SIL Open Font License 1.1

**Inter** and **JetBrains Mono**, loaded from Google Fonts. Not redistributed in
this repository; the pages link to them and fall back to a system stack when the
network is unavailable, which is why every font declaration carries a real
fallback list.

---

## 4. What is original and MIT-licensed

Everything else, including: the decision model (`src/engine.js`), the trained
forecaster and its training script, the retrieval layer, all 32 safety
pictograms in `src/pictograms.js`, the six rendered illustrations in
`src/scenes.js` and the renderer that produced them, every chart, and the
simulated district in `src/data.js`.

The district of "Sarai Ghat" is fictional. Every figure in it is invented. The
six events on the record cards are real and each carries its source.
