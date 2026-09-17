"""Building the assistant's corpus from the live database.

Two halves, and the split is the point.

The **document half** is static: how a number is produced, what the
platform will and will not claim, and the public safety guidance for each
hazard. It changes when the code changes.

The **live half** is the current state of the emergency, read straight out
of the tables the API serves. It is rebuilt on demand rather than kept
warm, because a cached corpus is a corpus that can answer a question about
a road that reopened twenty minutes ago — and answering confidently from a
stale index is the failure mode this whole platform is built to avoid.
"""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from .retrieval import Index, Passage

# ── The document half ────────────────────────────────────────────────
METHOD_DOCS: list[Passage] = [
    Passage("doc.risk", "method", "How risk is calculated",
        "Risk is the calibrated probability of the hazard occurring in the cell within the "
        "forecast horizon, multiplied by expected intensity and by corroboration from "
        "independent sources. Confidence is computed separately from probability: a high risk "
        "with low confidence means the model is uncertain, not that the danger is smaller. "
        "Scores run 0 to 100 and band as low 0-29, medium 30-59, high 60-84, critical 85-100. "
        "A cell with no model output is shown as no data, never as a safe green cell.",
        "Risk engine · app/risk/engine.py"),
    Passage("doc.exposure", "method", "How population exposure is estimated",
        "Population exposure is a spatial overlay, not probability multiplied by the total "
        "population of a cell. The hazard footprint is derived from height above nearest "
        "drainage for flood and from slope for landslide, the resident population inside that "
        "footprint is counted, and an occupancy factor is applied.",
        "Exposure engine · app/impact/"),
    Passage("doc.priority", "method", "How relocation priority is ranked",
        "Six weighted factors: hazard risk 0.30, population exposure 0.22, vulnerability 0.18, "
        "time to hazard 0.13, evacuation difficulty 0.12 and accessibility 0.05. Each "
        "contribution is shown and the displayed contributions sum exactly to the score. The "
        "sort is a stable merge sort at O(n log n) with a documented tie-break.",
        "Priority engine · app/priority/engine.py"),
    Passage("doc.capacity", "method", "How shelter capacity is calculated",
        "Effective capacity is the minimum of space, water, food, sanitation and medical "
        "capacity, multiplied by an operational factor, and the platform names which constraint "
        "binds. Sphere and NDMA standards are used: 3.5 square metres per person, 15 litres of "
        "water per person per day, one latrine per twenty people, one trained responder per 250 "
        "people, and 90 percent safe utilisation.",
        "Capacity engine · app/capacity/"),
    Passage("doc.routing", "method", "How evacuation routes are found",
        "One Dijkstra per zone gives the shortest path to every candidate shelter at once, and "
        "A star with a great circle over maximum speed heuristic is used point to point. The "
        "heuristic is admissible and consistent so the result is provably optimal. Segments "
        "reported blocked are removed from the graph.",
        "Routing engine · app/routing/graph.py"),
    Passage("doc.attribution", "policy", "Model output is not an official warning",
        "Everything this platform computes is AI-based risk prediction and decision support. It "
        "is not an official warning. Official warnings are issued by the India Meteorological "
        "Department, the NDMA through SACHET, the Central Water Commission, INCOIS, the National "
        "Center for Seismology and the State Disaster Management Authorities, and are carried "
        "verbatim with the issuing authority attached. Where a warning and a model estimate "
        "disagree, the warning takes precedence.",
        "Platform policy · §5"),
    Passage("doc.freshness", "policy", "Stale data is never shown as live",
        "Every record carries when it was observed and when it was ingested. A source past its "
        "staleness window is marked stale, the confidence of any prediction that depended on it "
        "is reduced, and the affected output is stamped with the degraded input.",
        "Platform policy · §28"),
    Passage("doc.security", "policy", "How access is controlled",
        "The public portal and District Command are two trust levels and crossing between them "
        "is an authentication event. Five failed attempts lock an account with backoff to a "
        "fifteen minute ceiling, and a separate per-address limit catches enumeration across "
        "many accounts. Privileged writes require re-entering the password. Every "
        "authentication event is written to an append-only audit log.",
        "Security · app/core/lockout.py, app/core/security.py"),
]

SAFETY_DOCS: list[Passage] = [
    Passage("safety.flood", "safety", "Flood — what to do",
        "Move to higher ground before water reaches the road, not after. Do not try to cross a "
        "flooded causeway on foot or by vehicle: sixty centimetres of moving water will carry a "
        "car. Switch off electricity at the mains before you leave. Take identity papers, "
        "medicines, a phone and a charger in a sealed bag. Boil or chlorinate all drinking water "
        "afterwards.", "Public safety guidance · NDMA"),
    Passage("safety.landslide", "safety", "Landslide — what to do",
        "New cracks in walls or ground, doors that suddenly stick, tilting poles or trees, and a "
        "change in the sound of a stream all come before a slope moves. Leave immediately and "
        "move sideways out of the path, not downhill along it. Do not stop below a cut slope on "
        "a hill road. Risk stays high for days after heavy rain because the ground is still "
        "saturated.", "Public safety guidance · NDMA"),
    Passage("safety.earthquake", "safety", "Earthquake — what to do",
        "Drop, cover and hold on. Get under a sturdy table and stay away from windows until the "
        "shaking stops. If you are outside, move to open ground away from buildings and power "
        "lines. Do not use lifts. Expect aftershocks and check for gas leaks and structural "
        "cracks before re-entering.", "Public safety guidance · NDMA"),
    Passage("safety.cyclone", "safety", "Cyclone — what to do",
        "Move to a designated cyclone shelter before the wind rises, not during the storm. "
        "Secure loose roofing sheets. Keep away from the coast: storm surge, not wind, causes "
        "most cyclone deaths. The calm of the eye is not the end of the storm and the wind "
        "returns from the opposite direction.", "Public safety guidance · NDMA"),
    Passage("safety.heatwave", "safety", "Heatwave — what to do",
        "Avoid being outdoors between noon and four. Drink water often even when not thirsty, "
        "and add ORS if working outside. Check on elderly neighbours and anyone working in the "
        "open. Confusion with hot dry skin is heat stroke and is a medical emergency.",
        "Public safety guidance · NDMA"),
    Passage("safety.lightning", "safety", "Lightning — what to do",
        "Go indoors as soon as you hear thunder — if you can hear it you are already in range. "
        "Avoid open fields, water bodies and isolated trees, where most lightning deaths in "
        "India happen. If caught outside, crouch low with feet together and do not lie flat. "
        "Stay indoors thirty minutes after the last thunder.", "Public safety guidance · NDMA"),
    Passage("safety.tsunami", "safety", "Tsunami — what to do",
        "Strong shaking near the coast is itself the warning; do not wait for a bulletin. Move "
        "inland and to higher ground on foot, since roads jam. The sea withdrawing far beyond "
        "the normal low line means a wave is coming. The first wave is often not the largest.",
        "Public safety guidance · INCOIS / NDMA"),
    Passage("safety.wildfire", "safety", "Forest fire — what to do",
        "Do not enter closed forest blocks. Report smoke to the range office with the location. "
        "Move away at right angles to the wind rather than ahead of it, and downhill rather than "
        "up, because fire climbs faster than a person can.", "Public safety guidance · FSI"),
    Passage("safety.drought", "safety", "Drought — what to do",
        "Follow the district water rationing schedule and report failed handpumps to the block "
        "office so the tanker schedule can be updated. Prioritise drinking water over all other "
        "uses. Register for fodder and employment support rather than selling livestock at "
        "distress prices.", "Public safety guidance · NDMA"),
]

STATIC_CORPUS: list[Passage] = METHOD_DOCS + SAFETY_DOCS


# ── The live half ────────────────────────────────────────────────────
async def live_passages(session: AsyncSession, *, district: str | None = None) -> list[Passage]:
    """Read the current state of the emergency into retrievable records.

    Only what the API already publishes. The assistant is not a second,
    quieter path to data the endpoints would not return — every passage
    here corresponds to something the caller could have fetched directly.
    """
    out: list[Passage] = []

    cells = (await session.execute(text("""
        SELECT c.cell_id, c.district_code, d.name AS district_name, c.population,
               c.elevation_m, c.slope_deg, c.height_above_river_m,
               r.hazard, r.score, r.confidence, r.computed_at
          FROM spatial_cells c
          JOIN v_cell_current_risk r ON r.cell_id = c.cell_id
          LEFT JOIN admin_districts d ON d.code = c.district_code
         WHERE (:district IS NULL OR c.district_code = :district)
         LIMIT 2000
    """), {"district": district})).mappings().all()
    for c in cells:
        # A cell has no name of its own — the grid is an H3 index, not a
        # gazetteer — so the district is the nearest human-readable handle
        # the schema actually holds. The degraded-input list is not carried
        # here either: it lives on the prediction, which the current-risk
        # view does not reach, and a passage does not claim what it cannot
        # read.
        place = c["district_name"] or c["district_code"] or "an unassigned district"
        out.append(Passage(
            id=f"cell.{c['cell_id']}.{c['hazard']}", kind="cell",
            title=f"Cell {c['cell_id']} — {c['hazard']} risk",
            text=(f"Cell {c['cell_id']} in {place}. {c['hazard']} risk "
                  f"{c['score']} out of 100, confidence "
                  f"{round((c['confidence'] or 0) * 100)} percent. "
                  f"Population {c['population']}. Elevation {c['elevation_m']} metres, "
                  f"slope {c['slope_deg']} degrees, height above nearest drainage "
                  f"{c['height_above_river_m']} metres."),
            ref=f"Live risk cell · {c['cell_id']} ({place})",
            observed_at=str(c["computed_at"])))

    alerts = (await session.execute(text("""
        SELECT source_id, issuing_authority, cap_event, headline, severity, urgency, certainty,
               area_desc, instruction, effective_at, expires_at
          FROM government_alerts
         WHERE expires_at IS NULL OR expires_at > now()
         ORDER BY effective_at DESC LIMIT 200
    """))).mappings().all()
    for a in alerts:
        out.append(Passage(
            id=f"alert.{a['source_id']}", kind="alert",
            title=f"Official warning · {a['cap_event']}",
            text=(f"Official warning issued by {a['issuing_authority']}. {a['headline']}. "
                  f"Severity {a['severity']}, urgency {a['urgency']}, certainty "
                  f"{a['certainty']}. Area: {a['area_desc']}. "
                  f"Instruction: {a['instruction']}"),
            ref=f"Official CAP alert {a['source_id']} · {a['issuing_authority']}",
            observed_at=str(a["effective_at"])))

    # Effective capacity and the binding constraint are not columns — the
    # capacity engine derives them per request from these stored numbers
    # (app/capacity/engine.py). The passage therefore reports the rated
    # headroom the register does hold and says plainly where the effective
    # figure comes from, rather than quoting one it has not computed.
    shelters = (await session.execute(text("""
        SELECT st.shelter_id, st.name, st.district_code, st.current_occupancy,
               st.max_capacity, st.raw_available, st.water_days_remaining,
               st.food_days_remaining, st.medical_staff_present, st.state, st.reported_at
          FROM v_shelter_live st
         WHERE (:district IS NULL OR st.district_code = :district)
         LIMIT 500
    """), {"district": district})).mappings().all()
    for s in shelters:
        out.append(Passage(
            id=f"shelter.{s['shelter_id']}", kind="shelter",
            title=f"{s['shelter_id']} · {s['name']}",
            text=(f"{s['name']}, shelter {s['shelter_id']}. "
                  f"{s['raw_available']} places free against "
                  f"{s['max_capacity']} rated capacity, {s['current_occupancy']} people inside. "
                  f"Water {s['water_days_remaining']} days, food "
                  f"{s['food_days_remaining']} days, {s['medical_staff_present']} medical staff "
                  f"present. State {s['state']}. Effective capacity and the binding constraint "
                  f"are computed live by the capacity engine and are not held in the register."),
            ref=f"Shelter register · {s['shelter_id']}",
            observed_at=str(s["reported_at"])))

    # v_road_live carries the live state and how much to believe it, but
    # not who filed it — the reporter stays behind on road_status — so the
    # passage cites the confidence and leaves the reporter unnamed.
    roads = (await session.execute(text("""
        SELECT st.road_id, st.name, st.current_state, st.reason,
               st.state_confidence, st.reported_at
          FROM v_road_live st
         LIMIT 500
    """))).mappings().all()
    for r in roads:
        out.append(Passage(
            id=f"road.{r['road_id']}", kind="road", title=f"Road · {r['name']}",
            text=(f"{r['name']} is {r['current_state']}. {r['reason']}. "
                  f"Reported with confidence {r['state_confidence']}. "
                  + ("This segment is available to the routing engine."
                     if r["current_state"] == "open"
                     else "The routing engine excludes or penalises this segment.")),
            ref=f"Road status · {r['name']}",
            observed_at=str(r["reported_at"])))

    sources = (await session.execute(text("""
        SELECT key, authority, status, last_success_at, quality_score, is_primary
          FROM data_sources
    """))).mappings().all()
    for s in sources:
        out.append(Passage(
            id=f"source.{s['key']}", kind="source", title=f"Data source · {s['authority']}",
            text=(f"{s['authority']}, key {s['key']}, is {s['status']}. Quality score "
                  f"{s['quality_score']}. "
                  + ("This is a primary Indian authority source."
                     if s["is_primary"] else "This is a supplementary open source.")),
            ref=f"Source register · {s['key']}",
            observed_at=str(s["last_success_at"])))

    return out


async def build_index(session: AsyncSession, *, district: str | None = None) -> Index:
    """The corpus the assistant is allowed to see, and nothing else."""
    return Index().build(STATIC_CORPUS + await live_passages(session, district=district))
