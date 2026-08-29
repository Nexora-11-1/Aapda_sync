# Working on AapdaSync

## Running it

There is no build step and no dependencies. Clone and open `index.html`.

```bash
git clone https://github.com/Nexora-11-1/Aapda_sync.git
cd Aapda_sync
open index.html          # macOS
start index.html         # Windows
xdg-open index.html      # Linux
```

It runs from `file://` on purpose — that constraint is why there is no bundler,
no module system and no framework. Everything is classic `<script>` tags and
plain ES2020.

If you want a local server anyway (you do not need one):

```bash
python3 -m http.server 8000     # then http://localhost:8000
```

## Where things are

Read `README.md` first — it explains what the system argues, which is the part
worth understanding before you change anything. The short version of the layout:

| | |
|---|---|
| `src/data.js` | the simulated district. **RAW INPUTS ONLY** — never a score |
| `src/engine.js` | the decision model: HEI, VCI, capacity, RUI, the ledger, the solver |
| `src/views.js` | every screen |
| `src/actions.js` | drawers, modals, exports, the report form |
| `src/app.js` | routing and boot. **Must load last** |
| `train/` | offline scripts that generate `src/model.js`, `src/scenes.js`, `src/photos-bundled.js` |

## The one rule that matters

**`data.js` holds inputs. Everything else is derived at render time.**

Ground motion, flood depth, slope susceptibility, plume fraction, housing
typology, floor area, litres per day, toilet counts and road throughput go in.
Every number on every screen comes out of them. If you find yourself typing a
score into `data.js`, the change belongs in `engine.js` instead.

This is what lets the Method screen and the Scenario Sandbox work at all: change
an input, and the whole chain moves.

## Adding a script

Add the `<script src="src/yours.js">` tag to `index.html` **before** `app.js`,
and after anything it reads at load time. CI checks that `app.js` is last and
that every referenced file exists, because a missing or misordered script is a
blank page rather than an error anyone will notice.

## Regenerating the generated files

These are committed, so you only run these when the inputs change:

```bash
python3 train/train_forecast.py    # -> src/model.js   (needs numpy, scikit-learn)
python3 train/bundle_photos.py     # -> src/photos-bundled.js
python3 train/render_scenes.py     # -> /tmp/contact.png; add --write for src/scenes.js
```

`render_scenes.py` deliberately refuses to overwrite `src/scenes.js` without
`--write` — read its header before you use that flag.

## Before you push

CI runs on every push and takes seconds. Run the same checks locally first:

```bash
for f in src/*.js; do node --check "$f"; done
```

Then open the page and click through: enter Government (sign-in appears every
time — that is the point), the District Deck, the GIS map, the public view, and
the record carousel.

## Things that are deliberate, not bugs

- **Sign-in is asked for on *every* crossing into Government.** Leaving for the
  public view clears the operator. On a shared district terminal, the person who
  walks up next is not the person who signed in.
- **A citizen report changes no computed number** until an operator verifies it,
  and both the verification and the dismissal are posted to the ledger.
- **The live news adapter is inert** and says so. It is not broken; a retriever
  that silently returned nothing while looking live is the thing this project
  argues against.
- **The record photographs carry permanent captions** saying what they actually
  show, and several are not the event on their card. See `NOTICE.md` — this needs
  resolving before the repo goes public.
