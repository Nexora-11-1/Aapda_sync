# 00 · Documentation index

The design package. `README.md` at the repository root is the overview and the
argument; these files are the detail behind it.

---

## Read in this order

| | Document | What it settles |
|---|---|---|
| **01** | [Architecture](01-architecture.md) | The shape of the system, process topology, why Redis and not Kafka, failure posture, and the scaling path. |
| **10** | [Data source register](10-data-sources.md) | Every source, its real access route, what it needs, and the hazard → source map. **The only place in this repository where a source URL may be asserted.** Also: coverage vs registers, and the rules the code enforces about fidelity. |
| **11** | [The assistant, and the bridge into Command](11-assistant-and-access.md) | The credential bridge into the operator view, and the assistant's contract — retrieval, the computed-fact path, and the refusal. |
| **12** | [Audit, and what is honestly not built](12-audit-and-limitations.md) | What the audit found and what was fixed; what is actually live; what is real geometry; the brief answered section by section; and the one architectural decision worth stating plainly. **Read this before quoting any figure.** |
| **09** | [Development roadmap](09-roadmap.md) | What is not built, and the sequence to a first real deployment. |

---

## Where a question actually lives

| Question | Answer |
|---|---|
| What runs, and in what process? | [01 · Architecture](01-architecture.md) |
| What happens when a source goes down? | [01 · Failure posture](01-architecture.md) |
| Which feed is behind this hazard, and at what fidelity? | [10 · Hazard → source map](10-data-sources.md) |
| Why does this state have no shelter capacity? | [10 · Coverage vs registers](10-data-sources.md) |
| What does the assistant do when it does not know? | [11 · The assistant](11-assistant-and-access.md) |
| How does anyone get into the operator view? | [11 · The credential bridge](11-assistant-and-access.md) |
| Is this number real? | [12 · Audit and limitations](12-audit-and-limitations.md) |
| What has to be true before this is deployed anywhere? | [09 · Roadmap](09-roadmap.md) |
| What may I redistribute? | [`../NOTICE.md`](../NOTICE.md) |
| How do I report a vulnerability? | [`../SECURITY.md`](../SECURITY.md) |
| How do I run the tests? | [`../CONTRIBUTING.md`](../CONTRIBUTING.md) |

---

## In the code rather than in a document

Some things are deliberately documented where they are enforced, because a
document drifts and a test does not:

| | Where |
|---|---|
| Algorithmic complexity bounds — quadtree, merge sort, k-d tree, Dijkstra/A\* | `backend/tests/test_daa.py` asserts each bound rather than stating it |
| The security controls | `backend/tests/test_security.py`, one case per control in `SECURITY.md` |
| Every credential and what it unlocks | `.env.example` |
| What the running host can actually reach | `cd backend && python scripts/check_sources.py` |
| Photograph attribution, and what was skipped and why | `frontend/standalone/assets/photos/credits.json` |
| The behaviour of the offline dashboard | `frontend/standalone/test/` — real Chromium, behaviour not markup |

---

## The standing caveat

> Model output on this platform is **AI-based risk prediction and decision
> support. It is not an official warning.** Official warnings come from IMD,
> NDMA/SACHET, CWC and the State Disaster Management Authorities, and are carried
> verbatim with their issuing authority attached.

Modelled risk is national. Registers — shelter capacity, road state — are local,
and only Chamoli District, Uttarakhand is integrated. Every other state shows a
provisional register and the interface says so on the screen, every time.
