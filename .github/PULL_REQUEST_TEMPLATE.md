<!--
One concern per pull request. See CONTRIBUTING.md.
-->

## What changed

<!-- The change, in the imperative. "Fix the quadtree pruning a hotspot narrower
     than its sampling stride" — not "fixes". -->

## What would have to be true for this to be wrong

<!-- The most useful line in the description. Name the assumption you are
     relying on, or the input that would break it. -->

## Displayed numbers

<!-- Does this alter a number anybody sees on a screen? If so: which screen, and
     was the old number wrong, or did the definition move? Delete if not. -->

---

## Checks

- [ ] `cd backend && python -m pytest tests/ -q`
- [ ] `cd backend && ruff check app tests`
- [ ] `cd frontend/standalone && node build.js` and the relevant `test/*.spec.mjs` suites
- [ ] No credential, secret or `.env` file is included in this diff

## The rules that are not style

Tick the ones this change touches, and say below how it stays inside them.

- [ ] A model prediction is never presented as a warning
- [ ] Stale is never presented as live
- [ ] No data is not zero risk — a cell with no output renders hatched, never green
- [ ] `data.js` contains no scores; raw inputs only
- [ ] No invented endpoints; a source with no credential reports `NOT_CONFIGURED`
- [ ] A source URL is asserted only in `docs/10-data-sources.md`
- [ ] Priority stays reconstructible — contributions sum to the score exactly
- [ ] No photograph is displayed without a credit and a licence
- [ ] A repaint never takes the reader's scroll position or focus
- [ ] Accessibility: focus ring, keyboard reachable, colour is never the only channel
- [ ] None of the above — this change does not touch them
