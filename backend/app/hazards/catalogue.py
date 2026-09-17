"""
The hazard catalogue: which sources feed which disaster (§3, §8).

This is the map between the nine hazards and the connectors that supply them.
It exists so that "is cyclone live?" has one answer, computed from what is
actually configured, rather than being asserted in a UI string somewhere.

Two tiers per hazard, deliberately separate:

  · **authoritative** — the Indian statutory source. IMD for weather, CWC for
    rivers, NCS for seismicity, INCOIS/ITEWC for tsunami. These are what a
    district magistrate acts on. Most need credentials.
  · **supplementary** — open sources that keep the hazard live when the
    authoritative one is not configured. They are stored under their own source
    keys, and any risk computed from them is stamped `degraded_inputs` naming
    the authoritative source that is missing.

A supplementary source is never relabelled as the authority it stands in for.
GloFAS discharge is not a CWC gauge reading; GDACS is an international
coordination feed, not an Indian warning. The UI says which one it has.

All nine hazards run with **no credentials at all**. What credentials buy is
*fidelity*, not existence:

  · wildfire keyless is GDACS large-fire alerts — coarse, event-level. A free
    NASA FIRMS key upgrades it to per-pixel VIIRS thermal anomalies.
  · flood keyless is GloFAS modelled discharge at ~5 km. A CWC agreement
    upgrades it to surveyed gauge stage against a real danger level.
  · earthquake keyless is USGS FDSN. NCS is the Indian statutory catalogue.

`fidelity()` returns which of these a hazard is currently running at, so the UI
can distinguish "we can see fires" from "we can see fires well".
"""
from __future__ import annotations

from dataclasses import dataclass, field

from app.config import settings


@dataclass(frozen=True, slots=True)
class HazardSpec:
    key: str
    name: str
    #: statutory Indian sources, in preference order
    authoritative: tuple[str, ...]
    #: open sources that keep the hazard live without credentials
    supplementary: tuple[str, ...]
    #: how the risk engine derives intensity — named so the UI can explain it
    signal: str
    #: seconds between polls for this hazard's fastest source
    cadence_s: int
    #: prediction horizon the model is asked for
    horizon_h: int
    #: hazards that are not physically possible everywhere
    coastal_only: bool = False
    inland_only: bool = False
    #: source key → what running on that source actually gets you. Live/not-live
    #: is not enough: "we have wildfire" must distinguish per-pixel thermal
    #: detection from a continent-scale alert, and only this says which.
    fidelity_notes: dict[str, str] = field(default_factory=dict)
    notes: str = ""

    def configured_sources(self) -> list[str]:
        return [k for k in (*self.authoritative, *self.supplementary)
                if _ok(k)]

    def live(self) -> bool:
        return bool(self.configured_sources())

    def degraded_inputs(self) -> list[str]:
        """Authoritative sources that are missing, for stamping onto output."""
        return [k for k in self.authoritative if not _ok(k)]

    def fidelity(self) -> str:
        """What resolution this hazard is currently running at.

        A hazard can be live and still be coarse. Reporting only live/not-live
        would let 'we have wildfire' mean either per-pixel thermal detection or
        a continent-scale alert, and an operator cannot tell which.
        """
        parts = [self.fidelity_notes[k] for k in (*self.authoritative, *self.supplementary)
                 if _ok(k) and k in self.fidelity_notes]
        if parts:
            # Every configured source contributes, not just the first. Flood on
            # Open-Meteo plus GloFAS is rainfall AND modelled discharge, and
            # reporting only the rainfall would hide the gauge caveat entirely.
            return " + ".join(dict.fromkeys(parts))
        return "running" if self.configured_sources() else "no source"

    def fidelity_by_source(self) -> dict[str, str]:
        """Per-source fidelity, including sources not yet configured, so the UI
        can show what a credential would buy."""
        return {k: self.fidelity_notes.get(k, "no description")
                for k in (*self.authoritative, *self.supplementary)}

    def tier(self) -> str:
        if any(_ok(k) for k in self.authoritative):
            return "authoritative"
        if any(_ok(k) for k in self.supplementary):
            return "supplementary"
        return "unavailable"

    def describe(self) -> dict:
        return {
            "hazard": self.key,
            "name": self.name,
            "live": self.live(),
            "tier": self.tier(),
            "signal": self.signal,
            "cadence_seconds": self.cadence_s,
            "horizon_hours": self.horizon_h,
            "sources_live": self.configured_sources(),
            "authoritative": list(self.authoritative),
            "supplementary": list(self.supplementary),
            "degraded_inputs": self.degraded_inputs(),
            "fidelity": self.fidelity(),
            "fidelity_by_source": self.fidelity_by_source(),
            "notes": self.notes,
        }


def _ok(key: str) -> bool:
    try:
        return settings.source(key).configured
    except KeyError:
        return False


# ══════════════════════════════════════════════════════════════════════
# The nine
# ══════════════════════════════════════════════════════════════════════
CATALOGUE: dict[str, HazardSpec] = {
    "flood": HazardSpec(
        key="flood", name="Flood",
        authoritative=("imd", "cwc"),
        supplementary=("openmeteo", "glofas", "gdacs", "nrsc"),
        signal="rainfall accumulation over 1–72 h, river discharge against its "
               "own climatology, and height above nearest drainage",
        cadence_s=900, horizon_h=6,
        fidelity_notes={
            "cwc": "surveyed gauge stage against a real danger level",
            "imd": "station rainfall from the statutory network",
            "glofas": "modelled discharge at ~5 km — not a gauge stage",
            "openmeteo": "reanalysis rainfall at ~11 km",
            "gdacs": "event-level flood alerts only",
            "nrsc": "satellite inundation extent after the event, not a forecast"},
        notes="GloFAS gives modelled discharge at ~5 km, which is a different "
              "quantity from a CWC gauge stage reading and is labelled as such.",
    ),
    "landslide": HazardSpec(
        key="landslide", name="Landslide",
        authoritative=("imd", "nrsc"),
        supplementary=("openmeteo", "opentopo", "gdacs"),
        signal="antecedent precipitation index over 15 days against slope angle, "
               "curvature and soil depth",
        cadence_s=900, horizon_h=24,
        fidelity_notes={
            "imd": "station rainfall from the statutory network",
            "nrsc": "ISRO landslide inventory as the susceptibility prior",
            "openmeteo": "rainfall trigger at ~11 km over a static slope layer",
            "opentopo": "30 m DEM slope and curvature",
            "gdacs": "event-level landslide alerts only"},
        notes="Needs a DEM once, then rainfall continuously. The slope term is "
              "static; the trigger term is live.",
    ),
    "earthquake": HazardSpec(
        key="earthquake", name="Earthquake",
        authoritative=("ncs",),
        supplementary=("usgs", "gdacs"),
        signal="magnitude and depth attenuated over epicentral distance to an "
               "estimated PGA, weighted by IS 1893 seismic zone",
        cadence_s=120, horizon_h=1,
        fidelity_notes={
            "ncs": "Indian statutory catalogue, densest station coverage",
            "usgs": "reviewed global solutions — adequate above about M4",
            "gdacs": "impact alerts only, no catalogue"},
        notes="USGS FDSN is public and reviewed, and covers India adequately for "
              "situational awareness. NCS remains the statutory catalogue and "
              "resolves smaller local events USGS does not.",
    ),
    "cyclone": HazardSpec(
        key="cyclone", name="Cyclone",
        authoritative=("imd",),
        supplementary=("gdacs", "openmeteo", "incois"),
        signal="sustained wind and pressure from the track, distance from the "
               "centre, and coastal exposure",
        cadence_s=600, horizon_h=48, coastal_only=True,
        fidelity_notes={
            "imd": "official track, radius of maximum wind and pressure field",
            "gdacs": "track and alert level, no wind field",
            "openmeteo": "forecast wind at the coast only",
            "incois": "sea state and storm surge at the coast"},
        notes="GDACS TC carries track and alert level for North Indian Ocean "
              "systems. IMD's own track remains the operational source.",
    ),
    "wildfire": HazardSpec(
        key="wildfire", name="Wildfire",
        authoritative=("nrsc",),
        supplementary=("firms", "gdacs"),   # openmeteo gives fire WEATHER, not detection
        signal="VIIRS thermal anomalies weighted by satellite confidence, against "
               "fuel moisture, NDVI and wind",
        cadence_s=3600, horizon_h=24,
        fidelity_notes={
            "nrsc": "ISRO burn-scar and fire products",
            "openmeteo": "fire weather — fuel moisture and wind, not detection",
            "firms": "per-pixel VIIRS thermal anomalies at 375 m",
            "gdacs": "coarse large-fire alerts only — no per-pixel detection"},
        notes="Runs keyless on GDACS large-fire alerts. A free NASA FIRMS "
              "MAP_KEY upgrades it to per-pixel VIIRS detection, which is the "
              "difference between knowing a district is burning and knowing "
              "which ridge.",
    ),
    "heatwave": HazardSpec(
        key="heatwave", name="Heatwave",
        authoritative=("imd",),
        supplementary=("openmeteo",),
        signal="apparent temperature over consecutive days against the station "
               "normal, weighted by night-time minimum",
        cadence_s=1800, horizon_h=72,
        fidelity_notes={
            "imd": "station normals — the basis IMD declares heatwaves against",
            "openmeteo": "30-day local mean standing in for a 30-year normal"},
        notes="IMD's heatwave declaration is a departure from a local normal, not "
              "an absolute threshold. Open-Meteo supplies both.",
    ),
    "drought": HazardSpec(
        key="drought", name="Drought",
        authoritative=("imd",),
        supplementary=("openmeteo", "gdacs"),
        signal="standardised precipitation index over 3, 6 and 12 months against "
               "the district's own long-period average",
        cadence_s=86400, horizon_h=720,
        fidelity_notes={
            "imd": "long-period average for a true SPI",
            "openmeteo": "short-window precipitation z-score — an SPI proxy",
            "gdacs": "continental drought alerts"},
        notes="A slow hazard. Daily is ample; hourly would be noise.",
    ),
    "lightning": HazardSpec(
        key="lightning", name="Lightning",
        authoritative=("imd",),
        supplementary=("openmeteo",),
        signal="convective available potential energy and lifted index as a "
               "storm-potential proxy",
        cadence_s=900, horizon_h=6,
        fidelity_notes={
            "imd": "actual strike detections from the lightning network",
            "openmeteo": "CAPE-based storm potential — a proxy, not detection"},
        notes="This is a PROXY, not a strike network. CAPE says the atmosphere "
              "could produce lightning; only IMD's detection network says it did. "
              "Output from this hazard is labelled accordingly.",
    ),
    "tsunami": HazardSpec(
        key="tsunami", name="Tsunami",
        authoritative=("incois",),
        supplementary=("usgs", "gdacs"),
        signal="submarine earthquake magnitude and depth, then sea-level anomaly "
               "from the tide-gauge network",
        cadence_s=120, horizon_h=6, coastal_only=True,
        fidelity_notes={
            "incois": "tide-gauge sea level and ITEWC bulletins",
            "usgs": "submarine earthquake parameters only",
            "gdacs": "impact alerts only"},
        notes="Tsunami WARNINGS come from the Indian Tsunami Early Warning Centre "
              "and are never modelled here. This hazard supplies situational "
              "awareness only, and defers to ITEWC on every surface.",
    ),
}


# ══════════════════════════════════════════════════════════════════════
# Which connectors to run, and how often
# ══════════════════════════════════════════════════════════════════════
def polling_plan() -> dict[str, int]:
    """source key → poll interval, taken as the tightest cadence any hazard
    that depends on it asks for.

    Derived rather than hand-maintained: adding a hazard that needs a source
    every two minutes automatically tightens that source's polling, and nobody
    has to remember to change a second list.
    """
    # First: how fast does the most urgent hazard depending on this source want it?
    demand: dict[str, int] = {}
    for spec in CATALOGUE.values():
        for key in spec.configured_sources():
            demand[key] = min(demand.get(key, spec.cadence_s), spec.cadence_s)

    # Then: clamp to the source's own floor. A hazard wanting 2-minute updates
    # does not entitle us to hammer a donated JRC service every 2 minutes — the
    # source's declared cadence is a politeness contract and a rate limit, and
    # the fast hazard simply gets that source's data less often than it would like.
    plan: dict[str, int] = {}
    for key, wanted in demand.items():
        floor = settings.source(key).poll_seconds or wanted
        plan[key] = max(wanted, floor)
    return plan


def live_hazards() -> list[str]:
    return [k for k, spec in CATALOGUE.items() if spec.live()]


def hazards_for_source(source_key: str) -> list[str]:
    """Which hazards a newly-arrived record from this source should recompute."""
    return [k for k, spec in CATALOGUE.items()
            if source_key in spec.authoritative or source_key in spec.supplementary]


def applicable(hazard: str, *, coastal: bool) -> bool:
    """Whether a hazard can physically occur in this deployment's geography.

    Chamoli is landlocked. Scoring cyclone and tsunami there would produce
    confident zeros that clutter the map and teach operators to ignore the
    hazard switcher.
    """
    spec = CATALOGUE.get(hazard)
    if spec is None:
        return False
    if spec.coastal_only and not coastal:
        return False
    if spec.inland_only and coastal:
        return False
    return True


def status_report() -> dict:
    """What the /api/hazards endpoint and the All Hazards screen render."""
    specs = [spec.describe() for spec in CATALOGUE.values()]
    return {
        "hazards": specs,
        "live": sum(1 for s in specs if s["live"]),
        "total": len(specs),
        "authoritative": sum(1 for s in specs if s["tier"] == "authoritative"),
        "keyless": sum(1 for s in specs if s["live"]),
        "polling_plan": polling_plan(),
        "note": ("A hazard is live when at least one of its sources is configured. "
                 "Supplementary sources keep a hazard live without credentials but "
                 "are never relabelled as the authority they stand in for; risk "
                 "computed from them carries degraded_inputs naming what is missing."),
    }
