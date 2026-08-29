# AapdaSync

**Hazard red zones, carrying capacity and relocation priority — resolved into one decision.**

A student prototype for the problem of *intelligent identification of hazard-based red zones,
carrying-capacity assessment, and immediate relocation needs for vulnerable habitations.*

> **This is a prototype. Every figure is simulated.** The district, its place names, its population
> and its shelters are invented. There is no government branding, no endorsement, no claim of
> compliance, and nothing is transmitted anywhere.

*Smart India Hackathon — Problem Statement 26191*

---

## Repository

| | |
|---|---|
| **Clone** | `git clone https://github.com/Nexora-11-1/Aapda_sync.git` |
| **Live site** | not published yet — this repository is private, and GitHub Pages needs a public repo on the free plan. `.github/workflows/pages.yml` is written and waiting; turn it on and the site lands at `https://nexora-11-1.github.io/Aapda_sync/` |
| **Working on it** | [`CONTRIBUTING.md`](CONTRIBUTING.md) |
| **Third-party material** | [`NOTICE.md`](NOTICE.md) — **read this before making the repo public**, the bundled photographs have no recorded licence |
| **Licence** | MIT for the code. Not for the photographs or the map geometry — see `NOTICE.md` |

---

## Run it

Double-click `index.html`. That is the whole install.

Plain HTML, CSS and ES2020 JavaScript loaded as classic scripts sharing one global scope. No
framework, no bundler, no build step, no runtime dependencies, deliberately no ES modules — so it
runs from `file://`. Every map and chart is hand-written inline SVG; there is no chart library and
no map library. The only external request is the Google Fonts stylesheet, and the app falls back to
system fonts cleanly without it.

---

## The unique claim

Most systems in this space treat the three problems as three steps: a risk map here, a shelter list
there, an evacuation plan in a spreadsheet. **AapdaSync computes the red zone and the shelter ledger
as one thing.** Five specific consequences follow, and each is enforced in code rather than asserted
in copy.

### 1. A safe site's capacity is the minimum of five independent ceilings

| Ceiling | Derived from |
|---|---|
| Covered floor area | m² ÷ 3.5 m²/person (Sphere) |
| Assured water | litres/day ÷ 15 L/person/day (Sphere) |
| Sanitation | toilets × 20 persons/toilet (Sphere) |
| Structural safety | the shelter's **own** hazard exposure, de-rated or disqualified |
| Corridor throughput | road capacity × hours the road stays open before impact |

The register's claimed figure is almost always the floor-area number with nothing else checked. The
UI names which constraint is binding: *"Kotwa Higher Secondary claims 1,400. Its real capacity is
160, capped by eight toilets."* In the shipped dataset the register overstates district capacity by
**66%**, and two sites on it stand inside a red zone and carry zero capacity.

Building resistance is applied to the **seismic term only**. Retrofitted RCC survives shaking; it
does not survive standing in four metres of water or downwind of an ammonia release.

### 2. Urgency is coupled to capacity

```
core = 0.60 × HEI + 0.40 × VCI
amp  = 1 + 0.22 × time_pressure + 0.30 × capacity_stress
RUI  = min(100, core × amp)
```

**Capacity stress is the term no other index has.** It is not "is there a shelter nearby" — on its
own almost every habitation can see one with room. It is the habitation's *proportional share* of
every site it can reach inside its own warning window, weighted by all the other demand competing
for those same sites. When a shelter is disqualified, filled or cut off, the demand pointed at it
redistributes, every competitor's share falls, and urgency upstream rises — without anyone touching
the hazard model.

It is an amplifier rather than a fourth weighted term on purpose. In a flat weighted sum a quiet
term drags the score down, so a village that will be under four metres of water scores "medium"
because its road happens to be short. Life-safety is the core; time and room can only raise urgency,
never dilute it.

### 3. Capacity is a double-entry account, not a label

Every commitment posts a debit against a site and a credit to a habitation, carrying the operator
who made it. Nothing is ever deleted — a release is a compensating posting, so the history of a
decision survives the decision being reversed. This is what makes two officers physically unable to
promise the same 500 places twice.

### 4. The Deficit Clock separates three different shortages

- **Capacity deficit** — people with a relocation need and no reachable qualified place at all.
- **Movement deficit** — people who *have* a place the fleet cannot physically reach in time.
  Opening more shelters does not fix this; more lift does.
- **Readiness gap** — sites counted in capacity that are not yet staffed or supplied.

Each is paired with a costed, lead-timed action that relieves the specific binding constraint
causing it, and with the residual that has to be escalated because it cannot be closed locally.

### 5. Two map levels, and the difference between them is the point

The map opens on **India** — all 36 states and union territories, real geometry, tinted by what each
state has **declared**. Exactly one of them has a district feed connected, and that state is drawn
differently: solid where the rest are hatched, outlined in primary, with a drill-down that animates
the viewBox onto the district before the frame is replaced.

Declared and derived are never mixed. A state that has reported "412,000 at risk" gets that figure
shown as reported, with the shelter capacity behind it marked *not available — no feed*. Only the
connected district gets a computed capacity, a computed deficit and a movement plan. The national
layer is therefore an honest picture of what a system like this actually knows on day one, and a
concrete statement of what connecting one more district buys.

### 6. Contribute to one constraint, not to a fund

The public view carries a relief panel, and it is built on the capacity model rather than beside it.
Because capacity is derived, the cost of lifting each binding constraint is known, and so is the
number of shelter places lifting it releases. That makes a rate possible: **₹700 per shelter place
at Kotwa, ₹400 at Devgarh**. The list is ordered by that rate, cheapest place first.

Funding a constraint fully posts the augmentation to the ledger, re-solves the district, and the
deficit falls by exactly the number of places the constraint was holding back. The receipt says
which constraint, at which site, and what the deficit was before and after.

**No payment is taken anywhere.** No card number, UPI ID or bank detail is requested or stored, the
method buttons are labels only, and the receipt states in its own words that it is not a financial
record and evidences no transaction. It exists to show the shape of a transparent contribution, not
to move money.

### 7. No orphan orders

The system refuses to issue a relocation order without a debited capacity allocation behind it. An
order with nothing backing it is an instruction to walk somewhere that may already be full. The
wizard's final step disables itself and says so.

---

## The forecast model

`train/train_forecast.py` trains it; `src/model.js` is the exported weights; `src/forecast.js` runs it in
the browser. Re-run the training with `python3 train/train_forecast.py`.

**Task** — probability that a hazard impacts a given habitation within seven days.
**Model** — logistic regression on 15 features: antecedent rainfall over 7 and 30 days, yesterday's rain,
3-day maximum, season, and per-habitation terrain (slope, landslide susceptibility, elevation, 100-year
flood depth, liquefaction, plume fraction, river proximity), days since last event, and two rainfall ×
terrain interactions.

| | |
|---|---|
| Held-out AUC | **0.826** (training AUC 0.862 — a small gap, so it is not memorising) |
| PR-AUC | 0.751 against a base rate of 0.220 |
| Brier | 0.098 |
| Precision / recall @0.5 | 0.826 / 0.559 |
| Split | **by time** — years 1–5 fit, year 6 held out |

Four decisions in that model are worth defending:

- **The split is by time, not at random.** A random split leaks the same storm into both halves through
  the antecedent-rainfall features and inflates every metric.
- **The training history is generated by a process the model cannot see** — a catchment store, a
  slope-stability reservoir, district-wide shock days — none of which are features. Training a model on
  its own scoring function would report a meaningless AUC.
- **No `class_weight='balanced'`.** Balanced weights lift AUC slightly and destroy calibration: every
  predicted probability shifts away from the base rate, so "40%" stops meaning 40%. This number is read
  as a probability on screen and checked against a reliability curve, so calibration wins.
- **Logistic regression, not gradient boosting.** The contribution of each feature is exactly
  coefficient × standardised value, so "Why this score?" is arithmetic rather than an approximation.

Confidence on each row is not invented: it is read off the held-out reliability table for the band that
prediction falls into. Extrapolation is flagged against the *observed training range*, not a fixed
z-threshold — a monsoon day legitimately sits at z ≈ 3.7 on antecedent rainfall and the model saw
hundreds of them.

> **Trained on a simulated history for a fictional district.** It ranks where to look first. It is not a
> forecast of any real place.

## Ask & Sources — retrieval, with a refusal

`src/rag.js`. Two paths and one refusal:

- **Computed** — questions about this district are answered from live engine state, so an answer can
  never drift from the dashboard beside it.
- **Retrieved** — questions about the record or the method go through BM25 over cited passages, and the
  answer shows which passage it came from.
- **Refused** — if neither path clears its threshold it says it does not know. It does not compose a
  plausible sentence from the nearest passage. In a system whose whole argument is that unbacked numbers
  get people hurt, a confidently wrong answer is the worst failure available.

**Live news is not connected**, and the UI says so. A browser cannot fetch cross-origin from `file://`,
and the hosted build's CSP blocks external hosts. The adapter is at the bottom of `src/rag.js`: point it
at a same-origin endpoint, implement `fetchLive()`, and retrieved items index like any other passage.
Shipping a retriever that silently returned nothing while looking live would be exactly the dishonesty
this prototype argues against.

## The barrier between public and government

The public view and Government View are not a toggle. **Every** crossing into Government requires a
fresh sign-in — leaving for the public view ends the session, so coming back asks again. On a shared
district terminal the person who walks up next is not the person who signed in. The switch carries a
lock.

Route navigation is the other door, and it used to be unlocked: a deep link, the command palette or the
alert bell would set a government route and promote the role on the way past. The check now sits in the
router rather than on each caller, and the requested route is held and honoured once sign-in completes —
a barrier that costs the operator their place is a barrier people learn to route around.

The public view withholds, on purpose:

- the numeric vulnerability breakdown behind a habitation's ranking — published household vulnerability
  data tells anyone which families cannot leave on their own;
- exact shelter occupancy — "space available / filling / nearly full / full" instead of a live headcount;
- operational routing and movement orders.

No credential is checked. The gate demonstrates where authorisation belongs; a deployment needs SSO,
role-based authorisation and an audit trail on every crossing.

## Data freshness

Five stamps, kept separate, each moving only when that event actually happens: `lastSyncAt` (a source was
polled), `lastDataUpdateAt` (inbound data changed), `lastComputeAt` (the chain re-derived),
`lastVerifiedAt` (a human confirmed something), and per-report `capturedAt` / `receivedAt` — offline
replay orders by capture, never by receipt. Collapsing these into one "last updated" is how a dashboard
comes to claim freshness it does not have. Every screen shows the mode: **Simulated** or **Predicted**;
no official feed is connected.

## Working the map

The map is the product, not a panel beside a list. **District Deck** gives it the full width and
`100vh − 272px`; **GIS Map** gives it `100vh − 148px` with nothing else on screen. The live
timeline that used to sit next to it is now an overlay on top of it that folds away, and the map's own
panels move out of its way when it is open.

Both levels — India and the district — are pan/zoom surfaces, not pictures:

- **Scroll to zoom**, anchored on the cursor rather than the centre, because an operator zooms
  towards something they are already looking at.
- **Drag to pan.** A drag that travels more than a few pixels cancels the click it would otherwise
  fire, so panning never opens a drawer by accident.
- **Hover for figures.** Every state, habitation and safe site carries a tooltip with the numbers
  that matter for it — a state's declared severity against its derived capacity (or the absence of
  one), a habitation's urgency, need and unplaced count, a site's claimed capacity against its
  derived capacity and what caps it.
- **Hover a habitation to isolate its flows.** Eighteen allocation arcs on one map are unreadable
  together; one hover answers "where do these particular people go" without a click.
- **Double-click to zoom out**, plus explicit `+` / `−` / reset controls with a zoom readout.
- Layer toggles, keyboard focus on every marker, and `Esc` to close whatever opened.

## The record

The public section opens with **The record** — a CSS-3D coverflow over six real Indian disasters.
It is the one place in this prototype where the data is not simulated. Each card carries figures as
reported by a cited source, the lesson the event taught, and the specific mechanism in AapdaSync
that exists because of it:

| Event | Figure on the card | The rule it put into the system |
|---|---|---|
| **Bhopal**, 3 Dec 1984 | ≈30 t of MIC in 45–60 min | A site inside a plume envelope is disqualified outright, not de-rated. Warning reach is a scored term. |
| **Odisha super cyclone**, 29 Oct 1999 | 23 permanent shelters across six districts | Derived capacity against derived demand, computed before the event. |
| **Bhuj**, 26 Jan 2001 | ≈400,000 buildings destroyed | Structural fragility is the heaviest term in the vulnerability index; shelter resistance applies to the seismic term only. |
| **Kedarnath**, 16–17 Jun 2013 | 6,054 dead, 89% in Uttarakhand | Warning reach per habitation; an impacting hazard keeps a planning horizon and pins time pressure to maximum. |
| **Kerala floods**, Jul–Aug 2018 | 3,274 relief camps, ≈1.25 m sheltered | Capacity is the minimum of five ceilings, not the register's claim. |
| **Chamoli**, 7 Feb 2021 | 27 million m³ of rock and ice | Not everything is forecastable — so the plan, the ledger and the orders are standing artefacts. |

Where sources disagree — they usually do on mortality — the disagreement is shown rather than
resolved. The card art is illustrative and labelled as such: the mechanism at the scale it operated on,
never a depiction of the people it happened to.

Sources are linked on each card and listed at the end of this file.

**Images.** Every card carries a full-bleed **photograph**, supplied with this
build, cropped to the card ratio and inlined as a data URI in
`src/photos-bundled.js` by `train/bundle_photos.py`. Data URIs rather than files
because the app has to run identically from `file://`, from the single-file
build, and from the hosted page whose CSP blocks every external host.

**Their provenance is not verified, and several are not the event on their
card.** The Bhopal frame is the derelict Union Carbide plant photographed years
after 1984; the Bhuj frame shows a collapsed reinforced-concrete mid-rise with
modern rescue teams, where Bhuj destroyed mostly low-rise masonry. No credit or
licence is recorded for any of the six. Rather than label them as the event and
hope, **each carries a caption saying what it actually shows, on screen at all
times** — the record cards are the one place in this prototype where the data is
real and cited, and a mislabelled photograph there costs more than a missing one.

Cropping happens at bundle time rather than in the browser. The cards render at
about 420×192 CSS px under `object-fit:cover`, so a 1000×673 frame carries 40%
more rows than can ever be shown and pays for them on every load. Cropping to
2.19:1 first and sizing to 880×402 at q76 took the set from 960 KB to 523 KB
with nothing visible lost. The full page is about 1.67 MB, most of it these six
frames plus the illustration fallback.

A card shows the first of five sources that loads:

| | Source | Caption |
|---|---|---|
| 1 | A file you dropped on the card in the running app | your credit, on hover |
| 2 | **The bundled photograph** — always loads, it is a data URI | permanent |
| 3 | `assets/photos/<event-id>.jpg` in the unpacked build | your credit, on hover |
| 4 | A verified NASA public-domain frame, where the record names one | permanent |
| 5 | The bundled illustration in `src/scenes.js` | permanent — "Illustration — …" |

Steps 3–5 are unreachable in practice now that step 2 always succeeds; they stay
because removing a photograph should degrade rather than blank the card. Step 3
is skipped in the bundled builds, which have no folder beside them, and step 4 in
the hosted build, whose CSP blocks external hosts.

Nothing depicts casualties.

### Using AI-generated images

No image model runs inside this page, and none was reachable from the build
environment — the bundled artwork is *rendered* by `train/render_scenes.py`, not
generated by one. If you want AI-generated frames instead, make them in whatever
tool you prefer and bring them back: **Add photographs → Choose several at once**
takes the whole set in one go and fills the empty cards in the order you picked
them. Each card in that panel carries a ready-made prompt (`prompt` on each
`RECORD` entry) written to match the hazard, the light and the framing the card
needs. Anything you add wins over the bundled artwork and drops the illustration
caption with it, so fill in the credit.

Your own photograph wins over all of it. Two ways to add one:

- **Drag a file onto any card** in the record carousel, or use **Add photographs** under it. The image is
  downscaled in the browser (max 1400 px, JPEG 0.82 — a 2400×1400 frame lands around 66 KB), stored in
  `localStorage`, and rendered immediately. It survives a reload. Nothing is uploaded anywhere; this is a
  static page.
- **Drop a file at `assets/photos/<event-id>.jpg`** in the unpacked build.

The import panel asks for the **credit** in the same moment as the image, and marks a photograph
*credit missing* until you fill it in — most freely-licensed photographs legally require attribution, and
a credit box offered later is a credit box left empty. `assets/photos/README.txt` lists the Wikimedia
Commons category for each of the six events.

If browser storage is full or blocked, the panel says so and the photographs work for the session only.

Nothing depicts casualties. The illustrations render the mechanism at the scale it operated on — a
plume crossing a settlement line, a surge reaching inland, a slope losing its crown — because the
freely licensed photography of these events is overwhelmingly of grieving families, and that is not
what belongs on a card arguing about shelter arithmetic.

---

## Reporting a disaster

The public view carries **Report what you can see** — habitation, what kind of thing, a description,
roughly when it was seen, and optionally how many people, a landmark and a callback number. The
reporter gets a reference (`CR-0001`) and a receipt that says, in order: it arrived, here is the
number to quote, and here is exactly what will and will not happen next.

Three deliberate choices.

**A report is an observation, not an input.** It never touches HEI, VCI, capacity, RUI or the
assignment. It enters the unverified queue, and a named operator either confirms it — posting a
`VERIFY` entry to the same ledger as a capacity commitment — or dismisses it with a reason. A
dismissal that leaves no trace is indistinguishable from nobody having looked, so both are recorded.

That restraint is the point. A system where anyone with a phone can move the numbers that decide who
is evacuated first has an obvious attack, and in a real emergency it does not even need an attacker:
panic, rumour and double-reporting do the same thing. Ten calls about one collapsed wall are one
wall.

**The emergency number sits above the button, not below it.** Someone reaching for a report form
during a flood is looking for help, and a form that lets them believe help is coming when it is not
is the most dangerous thing on the page. The panel, the form and the receipt all say plainly that
this dispatches nobody, and give 112 and the control-room number.

**Two clocks.** `capturedAt` is when they say they saw it; `receivedAt` is when it reached the
system. The queue sorts by capture, because a citizen in a flood is exactly the person whose phone
has no signal — the report describing the first wall to go can easily arrive after three describing
what happened next, and sorting by receipt rebuilds the event backwards.

Status is read back off the shared queue rather than copied, so a report the operator verifies
updates in the citizen's own list with no syncing. A report you cannot follow is a report you send
twice.

---

## The do / do-not card carries symbols

Every instruction on the public **If you are told to move** card is a pictogram
*and* a sentence. Both, always.

**Why symbols.** The district is multilingual and not uniformly literate, and
the people who most need an evacuation instruction are the ones least likely to
read a paragraph of it under pressure. A symbol is read before the sentence
beside it, and by people who will never read the sentence at all.

**Why the words stay.** Pictograms are not self-evident. A person and a wave
means *do not wade* to someone who already knows that is the rule, and means
*swimming* to someone who does not. Stripping the sentence to make the card look
cleaner trades comprehension for tidiness on the one screen where that trade is
least defensible. Every symbol is `aria-hidden`; the sentence is the accessible
text.

**The grammar** is the one people have already met on road signs and in
factories, which is the whole point of borrowing it — green ring for *do*, red
ring with a diagonal bar for *do not*. Inside a prohibition ring the symbol is
near-black, not red: that is how ISO 7010 draws it, and the reason is legibility
rather than tradition — a red glyph under a red bar merges into it. Ring, bar,
heading and sentence encode the same thing four times over, because red/green is
the commonest colour-vision deficiency there is and colour alone would carry none
of it.

All 32 symbols are drawn to one specification — 24×24 box, ~2px stroke, round
caps, no fills — so they read as one set rather than as thirty-two decisions,
and the pictogram key sits beside its sentence in `DOS` rather than being chosen
at render time: which symbol belongs on *do not shelter at the toe of the slope*
is a question about the instruction, and it belongs where it can be argued with.

The card moved from the 340px side rail into the main column to make room for
them; it is the most actionable thing on the public page and it was the most
cramped.

---

## What the code refuses to do

Checked on every render and shown on the **Audit Ledger** screen:

| | Invariant |
|---|---|
| I1 | No safe site is committed beyond its derived usable capacity. |
| I2 | No population is allocated to a site whose own HEI exceeds the cutoff, however large that site is. |
| I3 | No relocation order exists without a debited capacity allocation. |
| I4 | The ledger is append-only; releases are compensating postings, never deletes. |
| I5 | Every displayed residual reconciles to the posting history. |

Alongside these: emergency mode cannot be exited while any population is unplaced; simulated data is
labelled as simulated everywhere it appears and lives in a different object (`SIM`) from live values
(`LIVE`); and all times come from the real system clock in `Asia/Kolkata`, never a simulated counter.

---

## File layout

```
index.html          shell, entry gate, overlay layers
README.md           this file
assets/photos/      drop event photographs here — see the README inside
train/
  train_forecast.py generates the history, fits the model, writes src/model.js
  render_scenes.py  renders the six card illustrations, writes src/scenes.js
  bundle_photos.py  crops and inlines the supplied photographs -> src/photos-bundled.js
src/
  styles.css        all styling; :root custom properties, no preprocessor
  data.js           the simulated district — RAW INPUTS ONLY, never scores
  engine.js         the decision model: HEI, VCI, capacity, RUI, ledger, solver
  charts.js         seven hand-written inline-SVG charts on a 340×170 viewBox
  india.js          real geometry for 36 states and UTs, 0 0 612 696
  record.js         six real past disasters, cited — plus their SVG base art
  reports.js        citizen reporting: capture vs receipt, refs, the unverified queue
  photos-bundled.js GENERATED — the six supplied photographs as data URIs
  pictograms.js     32 safety symbols for the public do / do-not card
  scenes.js         GENERATED — six rendered illustrations as data URIs
  photos.js         drag-and-drop photograph import, downscale, localStorage
  map.js            inline-SVG district map, 0 0 1000 700 (1 unit = 100 m)
  national.js       the India layer: declared vs derived, and the drill-down
  views.js          every screen, through one page(title, subtitle, body) helper
  panzoom.js        pan, zoom and hover inspection for any viewBox'd SVG
  model.js          GENERATED — exported weights, metrics and reliability table
  forecast.js       browser inference, contributions, trend, trajectory
  rag.js            BM25 retrieval, computed-fact path, refusal, live adapter
  actions.js        drawers, modals, coverflow, relief panel, palette, toasts, exports
  app.js            bootstrap, routing, map levels, keyboard — loads last
```

`data.js` contains no scores. Ground motion, flood depth, slope susceptibility, plume fraction,
housing typology, floor area, litres per day, toilet counts and road throughput go in; every number
on every screen is derived from them at render time. Change an input and the whole chain moves —
which is the point of the **Method** screen and the **Scenario Sandbox**.

---

## Screens

| Screen | What it answers |
|---|---|
| **District Deck** | The Deficit Clock, the India → district map, the live timeline, the top of the queue. |
| **Red Zones** | Which habitations are red, and why — every score opens to its derivation. |
| **Field Reports** | Everything the district has been told but not confirmed — and who confirmed what. |
| **Carrying Capacity** | What each site can actually take, and the one constraint deciding it. |
| **Relocation Queue** | Who moves, how urgently, to exactly which site — and who has nowhere. |
| **Matching Engine** | The assignment, the cost function, and "why this site and not another". |
| **Movement & Convoys** | Whether the fleet can finish before the hazard lands. |
| **Scenario Sandbox** | Six counterfactuals, each re-deriving the whole chain. |
| **Audit Ledger** | Every posting, every operator, every invariant. |
| **Analytics** | Seven charts, including the coupling scatter that shows the central claim. |
| **Method** | The model written out, so an officer can disagree with an assumption. |
| **Public View** | The record, the national map, what was decided for a habitation, and where to go. |

## Keyboard

`Ctrl K` command palette · `Ctrl E` emergency mode · `Ctrl D` dispatch wizard ·
`Ctrl ⇧ A` commit plan to ledger · `←` `→` move through the record ·
`Esc` close drawer, modal or palette. On the map: scroll to zoom, drag to pan, double-click to zoom
out, hover for figures.

Every interactive element has a visible `:focus-visible` ring. Map markers are keyboard-focusable
and activate on Enter or Space with descriptive `aria-label`s. `prefers-reduced-motion` is
respected. Priority is encoded by **shape and number as well as colour** — colour is never the only
channel. Breakpoints at 1240 px, 1080 px and 720 px.

---

## Accessibility and honesty notes

- The `PROTOTYPE` badge and the "simulated data" line appear on the entry gate and on every screen.
- Field reports are **unverified until an operator marks otherwise**, and the state is shown.
- Exports carry `SIMULATED` in the filename and a `_warning` field or column in the payload.
- Separate timestamps are kept for last sync, last compute and last verification; each moves only
  when that event actually happens.
- Operational console strings stay in English by design: mixed-script status labels in a command
  console are a legibility risk under stress. The public-facing view is the surface that should be
  bilingual, and is the right place to add Hindi.

---

## Limits

This is one district, one afternoon, and invented numbers. In particular:

- The assignment is a deterministic greedy seed plus a bounded local-improvement pass, not a proven
  optimum. It is fast, explainable and stable under small input changes, which matters more here
  than the last few percent of cost — but it is not min-cost-flow.
- Travel time is a straight-line distance with a per-block terrain factor, not a routed network.
- The demand model (evacuation fraction from HEI, shelter dependency from VCI) is calibrated against
  general observed behaviour, not against this district's history — because this district does not
  exist. Real deployment needs local calibration and would be wrong without it.
- Capacity stress uses a proportional-share model of contested capacity. That is a modelling choice,
  not a fact; a different sharing rule gives different rankings, and the Method screen says so.
- No credential is checked anywhere. Production needs SSO, role-based authorisation and an immutable
  audit trail; the ledger here is append-only in memory only and is lost on reload.
- **State boundaries on the national map are illustrative and not authoritative.** The geometry
  predates the 2019 reorganisation: Ladakh is not shown separately from Jammu and Kashmir, and Dadra
  and Nagar Haveli and Daman and Diu are still two entries. Do not use this map for any purpose that
  depends on a boundary being correct.
- The national layer's per-state figures are invented. Only the treatment of them — declared, not
  derived, and never totalled together with computed figures — is meant to be taken seriously.

---

## Attribution

State geometry from **[@svg-maps/india](https://www.npmjs.com/package/@svg-maps/india)**, licensed
**CC BY 4.0**, converted to absolute polylines and thinned to 0.2 viewBox units.

Historical figures in `src/record.js` are as reported by:

- [Bhopal disaster](https://en.wikipedia.org/wiki/Bhopal_disaster)
- [1999 Odisha cyclone](https://en.wikipedia.org/wiki/1999_Odisha_cyclone)
- [2001 Gujarat earthquake](https://en.wikipedia.org/wiki/2001_Gujarat_earthquake)
- [2013 North India floods](https://en.wikipedia.org/wiki/2013_North_India_floods)
- [2018 Kerala floods](https://en.wikipedia.org/wiki/2018_Kerala_floods)
- [2021 Uttarakhand flood](https://en.wikipedia.org/wiki/2021_Uttarakhand_flood)

Everything else in this repository is simulated.
