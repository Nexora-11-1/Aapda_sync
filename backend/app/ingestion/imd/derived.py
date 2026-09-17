"""
Heatwave, drought and lightning signals derived from Open-Meteo.

These three hazards have no separate public Indian feed, but all three are
functions of variables Open-Meteo publishes openly. Deriving them here keeps
them live with no credentials, while IMD remains the authority whenever it is
configured.

Each is stored as a `satellite_observations` product row rather than being
written straight into a risk score, so the derivation is auditable: the product
name says what was computed, and the raw payload carries the inputs.

**Honesty about lightning.** CAPE and the lifted index say the atmosphere *could*
produce convection. They do not say lightning struck. Only IMD's detection
network can say that. This connector emits `lightning_potential`, never
`lightning_strikes`, and the hazard catalogue labels the whole hazard a proxy.
Conflating the two would put a strike count on a map that no instrument
measured.
"""
from __future__ import annotations

import json
import math
from collections.abc import Sequence
from datetime import UTC, datetime

from app.db.repositories import insert_satellite
from app.db.session import session_scope
from app.ingestion.base import (
    DataConnector,
    SourceState,
    SourceUnavailable,
    ValidationIssue,
    register,
)

HOURLY = ("temperature_2m,apparent_temperature,relative_humidity_2m,"
          "cape,lifted_index,convective_inhibition,"
          "wind_speed_10m,soil_moisture_0_to_1cm")
DAILY = ("temperature_2m_max,temperature_2m_min,apparent_temperature_max,"
         "precipitation_sum,et0_fao_evapotranspiration")

# IMD's own heatwave criteria are departures from the station normal, not
# absolute values: a heatwave is +4.5 °C over normal in the plains, and the
# hills have a lower absolute bar. Using a flat 45 °C would never fire in
# Uttarakhand and would fire constantly in Rajasthan.
HEATWAVE_DEPARTURE_C = 4.5
SEVERE_HEATWAVE_DEPARTURE_C = 6.5
HILL_ABSOLUTE_C = 30.0
PLAINS_ABSOLUTE_C = 40.0


@register
class DerivedHazardConnector(DataConnector[dict, list[dict]]):
    """Heatwave, drought and lightning-potential from one Open-Meteo call."""

    source_key = "openmeteo"          # shares the Open-Meteo source registration
    produces = "satellite_observations"

    def __init__(self, *a, points: Sequence[tuple[str, float, float]] = (),
                 elevations: dict[str, float] | None = None, **kw):
        super().__init__(*a, **kw)
        self.points = list(points)
        self.elevations = elevations or {}

    async def fetch(self) -> Sequence[dict]:
        if not self.points:
            raise SourceUnavailable(
                self.source_key, "no sample points supplied; build the H3 grid first",
                SourceState.NOT_CONFIGURED)

        out: list[dict] = []
        BATCH = 60
        for i in range(0, len(self.points), BATCH):
            chunk = self.points[i:i + BATCH]

            async def _call(chunk=chunk):
                r = await self.client.get(self.url("/forecast"), params={
                    "latitude": ",".join(f"{p[1]:.4f}" for p in chunk),
                    "longitude": ",".join(f"{p[2]:.4f}" for p in chunk),
                    "hourly": HOURLY, "daily": DAILY,
                    "past_days": 30,          # enough for a short-window SPI
                    "forecast_days": 5,
                    "timezone": "UTC",
                })
                r.raise_for_status()
                return r.json()

            payload = await self.with_retry(_call, what="derived hazard variables")
            series = payload if isinstance(payload, list) else [payload]
            for meta, block in zip(chunk, series, strict=False):
                out.append({"cell_id": meta[0], "lat": meta[1], "lon": meta[2],
                            "block": block})
        return out

    def validate(self, raw: dict) -> list[ValidationIssue]:
        block = raw.get("block") or {}
        if not (block.get("hourly") or {}).get("time"):
            return [ValidationIssue("hourly.time", "empty_series")]
        if not (block.get("daily") or {}).get("time"):
            return [ValidationIssue("daily.time", "empty_daily_series")]
        return []

    def normalize(self, raw: dict) -> list[dict]:
        cell, lat, lon = raw["cell_id"], raw["lat"], raw["lon"]
        h, d = raw["block"]["hourly"], raw["block"]["daily"]
        now = datetime.now(UTC)
        elevation = self.elevations.get(cell, 0.0)
        geojson = json.dumps({"type": "Point", "coordinates": [lon, lat]})
        rows: list[dict] = []

        def emit(product: str, value, unit: str | None, observed: datetime,
                 confidence: float, extra: dict):
            if value is None:
                return
            p = self.provenance(source_id=f"{cell}:{product}@{observed.isoformat()}",
                                observed_at=observed, confidence=confidence)
            rows.append({**p.as_dict(), "cell_id": cell, "geojson": geojson,
                         "product": product, "value": round(float(value), 4),
                         "unit": unit, "instrument": "Open-Meteo derived",
                         "raw": json.dumps(extra)})

        # ── heatwave ──────────────────────────────────────────────────
        tmax = [v for v in (d.get("temperature_2m_max") or []) if v is not None]
        if tmax:
            # 30-day local mean stands in for the station normal. It is a weak
            # normal — a real one is a 30-YEAR mean — and the payload says so.
            normal = sum(tmax[:30]) / len(tmax[:30])
            today = tmax[-6] if len(tmax) >= 6 else tmax[-1]
            departure = today - normal
            absolute_bar = HILL_ABSOLUTE_C if elevation >= 1000 else PLAINS_ABSOLUTE_C
            is_heatwave = departure >= HEATWAVE_DEPARTURE_C and today >= absolute_bar
            severity = (2 if departure >= SEVERE_HEATWAVE_DEPARTURE_C and is_heatwave
                        else 1 if is_heatwave else 0)
            # consecutive days over the bar — IMD requires persistence
            run = 0
            for v in reversed(tmax):
                if v - normal >= HEATWAVE_DEPARTURE_C and v >= absolute_bar:
                    run += 1
                else:
                    break
            apparent = d.get("apparent_temperature_max") or []
            emit("heatwave_index", severity * 50 + min(run, 5) * 10, "index", now, 0.75,
                 {"departure_c": round(departure, 2),
                  "normal_basis": "30-day local mean, NOT a 30-year climatological normal",
                  "absolute_bar_c": absolute_bar,
                  "elevation_m": elevation,
                  "consecutive_days": run,
                  "apparent_max_c": apparent[-6] if len(apparent) >= 6 else None,
                  "criterion": "IMD-style departure from normal with an absolute floor"})

        # ── drought ───────────────────────────────────────────────────
        precip = [v or 0.0 for v in (d.get("precipitation_sum") or [])]
        et0 = [v or 0.0 for v in (d.get("et0_fao_evapotranspiration") or [])]
        if len(precip) >= 20:
            window = precip[:30]
            total = sum(window)
            mean = total / len(window)
            var = sum((x - mean) ** 2 for x in window) / len(window)
            sd = math.sqrt(var)
            # A z-score of the window against itself, which is a *very* short
            # SPI proxy. A real SPI needs 30 years of monthly totals; this is
            # labelled a proxy and the drought module says so on screen.
            recent = sum(precip[-10:]) if len(precip) >= 10 else total
            expected = mean * min(len(precip), 10)
            z = ((recent - expected) / sd) if sd > 0 else 0.0
            deficit = max(0.0, 1.0 - (recent / expected)) if expected > 0 else 0.0
            water_balance = sum(precip[-30:]) - sum(et0[-30:])
            emit("drought_spi_proxy", round(z, 3), "z", now, 0.55,
                 {"window_days": len(window),
                  "recent_10d_mm": round(recent, 1),
                  "expected_10d_mm": round(expected, 1),
                  "deficit_fraction": round(deficit, 3),
                  "water_balance_30d_mm": round(water_balance, 1),
                  "caveat": "short-window proxy; a true SPI requires a multi-decade "
                            "rainfall normal from IMD"})

        # ── lightning potential ───────────────────────────────────────
        times = h.get("time") or []
        cape = h.get("cape") or []
        li = h.get("lifted_index") or []
        cin = h.get("convective_inhibition") or []
        idx = next((i for i, t in enumerate(times)
                    if datetime.fromisoformat(t).replace(tzinfo=UTC) >= now), None)
        if idx is not None and idx < len(cape) and cape[idx] is not None:
            c = float(cape[idx])
            lift = float(li[idx]) if idx < len(li) and li[idx] is not None else 0.0
            inhib = float(cin[idx]) if idx < len(cin) and cin[idx] is not None else 0.0
            # CAPE bands are the standard convective-forecasting ones.
            band = (0 if c < 300 else 1 if c < 1000 else 2 if c < 2500 else 3)
            # Strong inhibition caps a high-CAPE atmosphere: the energy is there
            # but nothing can reach it. Ignoring CIN over-forecasts badly.
            capped = band and inhib < -150
            potential = 0 if capped else band * 25 + (10 if lift < -2 else 0)
            emit("lightning_potential", potential, "index",
                 datetime.fromisoformat(times[idx]).replace(tzinfo=UTC), 0.50,
                 {"cape_j_kg": round(c, 1), "lifted_index": round(lift, 2),
                  "convective_inhibition_j_kg": round(inhib, 1),
                  "cape_band": band, "capped_by_inhibition": capped,
                  "caveat": "PROXY ONLY — CAPE indicates the atmosphere could support "
                            "convection. It is not a strike detection. Only IMD's "
                            "lightning network reports actual strikes."})

        return rows

    async def store(self, records: Sequence[list[dict]]) -> int:
        flat = [row for group in records for row in group]
        if not flat:
            return 0
        async with session_scope() as s:
            return await insert_satellite(s, flat)
