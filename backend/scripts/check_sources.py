#!/usr/bin/env python
"""
Connectivity check for every source in the catalogue.

    python scripts/check_sources.py            # all sources
    python scripts/check_sources.py --hazard flood
    python scripts/check_sources.py --keyless  # only the ones needing no credential

Run this first on any new deployment. It answers the only question that matters
on day one: which of the nine hazards can this server actually feed, from here,
right now — through this network, past this firewall, with these credentials.

It makes real calls. A source that answers here will answer for the connector.
"""
from __future__ import annotations

import argparse
import asyncio
import datetime
import sys

import httpx

from app.config import AccessMode, settings
from app.hazards import catalogue as cat

TIMEOUT = 25.0
UA = {"User-Agent": "AapdaSync/0.1 source-check"}

GREEN, YELLOW, RED, GREY, RESET = "\033[32m", "\033[33m", "\033[31m", "\033[90m", "\033[0m"


async def probe(client: httpx.AsyncClient, key: str) -> tuple[str, str]:
    """Return (state, detail). state ∈ live | unconfigured | blocked | failed."""
    cfg = settings.source(key)
    if not cfg.configured:
        why = ("needs a credential" if cfg.access is AccessMode.CREDENTIALED
               else "no base_url configured" if not cfg.base_url
               else "operator-entered, nothing to call")
        return "unconfigured", why
    if cfg.access is AccessMode.MANUAL:
        return "unconfigured", "operator-entered, nothing to call"

    today = datetime.date.today()
    base = cfg.base_url.rstrip("/")

    # Each probe is the cheapest real call that proves the contract, not a
    # bare ping — a 200 from a landing page proves nothing about the API.
    plan: dict[str, tuple[str, dict]] = {
        "usgs": (f"{base}/query", {
            "format": "geojson", "minmagnitude": 4.5, "limit": 1,
            "minlatitude": 5, "maxlatitude": 40,
            "minlongitude": 65, "maxlongitude": 100}),
        "openmeteo": (f"{base}/forecast", {
            "latitude": 30.33, "longitude": 79.32,
            "hourly": "temperature_2m,cape", "forecast_days": 1, "timezone": "UTC"}),
        "glofas": (f"{base}/flood", {
            "latitude": 30.33, "longitude": 79.32,
            "daily": "river_discharge", "forecast_days": 1}),
        "gdacs": (f"{base}/Events/geteventlist/SEARCH", {
            "eventlist": "TC;FL;EQ", "alertlevel": "Red;Orange",
            "fromdate": str(today - datetime.timedelta(days=7)),
            "todate": str(today + datetime.timedelta(days=1)), "pagesize": 5}),
        "incois": (f"{base}/info/index.json", {"itemsPerPage": 5}),
        "overpass": (f"{base}/interpreter", {"data": "[out:json];node(30.3,79.3,30.31,79.31);out 1;"}),
        "firms": (f"{base}/area/csv/{cfg.api_key}/VIIRS_SNPP_NRT/78.6,29.8,80,31.1/1", {}),
        "opentopo": (f"{base}/globaldem", {
            "demtype": "COP30", "south": 30.3, "north": 30.32,
            "west": 79.3, "east": 79.32, "outputFormat": "AAIGrid",
            "API_Key": cfg.api_key}),
        "sachet": (f"{base}/CapFeed", {}),
        "imd": (base, {}),
        "cwc": (base, {}),
        "nrsc": (base, {}),
        "ncs": (base, {}),
    }
    if key not in plan:
        return "unconfigured", "no probe defined"

    url, params = plan[key]
    headers = dict(UA)
    if cfg.api_key and key in ("imd", "cwc", "ncs"):
        headers["Authorization"] = f"Bearer {cfg.api_key}"

    try:
        r = await client.get(url, params=params, headers=headers, timeout=TIMEOUT)
    except httpx.ConnectError as exc:
        return "blocked", f"cannot connect — {exc.__class__.__name__} (firewall or DNS?)"
    except httpx.TimeoutException:
        return "blocked", f"timed out after {TIMEOUT:.0f}s"
    except Exception as exc:                           # noqa: BLE001
        return "failed", f"{exc.__class__.__name__}: {exc}"

    if r.status_code == 401 or r.status_code == 403:
        return "failed", f"HTTP {r.status_code} — credential rejected or IP not whitelisted"
    if r.status_code == 429:
        return "failed", "HTTP 429 — rate limited; back off and retry"
    if r.status_code >= 400:
        return "failed", f"HTTP {r.status_code}"

    body = r.text[:200].replace("\n", " ")
    size = len(r.content)
    return "live", f"HTTP {r.status_code}, {size:,} bytes · {body[:80]}…"


async def main() -> int:
    ap = argparse.ArgumentParser(description="Check every configured source")
    ap.add_argument("--hazard", help="check only the sources this hazard needs")
    ap.add_argument("--keyless", action="store_true",
                    help="only sources that need no credential")
    args = ap.parse_args()

    if args.hazard:
        spec = cat.CATALOGUE.get(args.hazard)
        if spec is None:
            print(f"Unknown hazard {args.hazard!r}. "
                  f"One of: {', '.join(cat.CATALOGUE)}")
            return 2
        keys = list(dict.fromkeys((*spec.authoritative, *spec.supplementary)))
    else:
        keys = list(settings.sources)

    if args.keyless:
        keys = [k for k in keys
                if settings.source(k).access in (AccessMode.PUBLIC, AccessMode.FEED)
                and not settings.source(k).api_key]

    print(f"\nProbing {len(keys)} source(s)\n")
    results: dict[str, tuple[str, str]] = {}
    async with httpx.AsyncClient(follow_redirects=True) as client:
        for key, outcome in zip(
                keys, await asyncio.gather(*(probe(client, k) for k in keys)),
                strict=True):
            results[key] = outcome
            state, detail = outcome
            colour = {"live": GREEN, "unconfigured": GREY,
                      "blocked": RED, "failed": YELLOW}[state]
            cfg = settings.source(key)
            print(f"  {colour}{state.upper():<13}{RESET} {key:<11} "
                  f"{cfg.authority[:42]:<44} {detail[:70]}")

    # ── what this means per hazard ────────────────────────────────────
    print(f"\n{'Hazard':<12} {'Status':<16} Feeding sources")
    print("  " + "─" * 76)
    ready = 0
    for key, spec in cat.CATALOGUE.items():
        reachable = [k for k in (*spec.authoritative, *spec.supplementary)
                     if results.get(k, ("", ""))[0] == "live"]
        auth_ok = any(k in reachable for k in spec.authoritative)
        if reachable:
            ready += 1
            state = f"{GREEN}authoritative{RESET}" if auth_ok else f"{YELLOW}supplementary{RESET}"
        else:
            state = f"{RED}no source{RESET}"
        print(f"  {spec.name:<12} {state:<26} "
              f"{', '.join(reachable) if reachable else '—'}")

    print(f"\n{ready} of {len(cat.CATALOGUE)} hazards can be fed from this host.")
    if ready < len(cat.CATALOGUE):
        missing = [s.name for s in cat.CATALOGUE.values()
                   if not any(results.get(k, ("", ""))[0] == "live"
                              for k in (*s.authoritative, *s.supplementary))]
        print(f"Not yet feedable: {', '.join(missing)}")
        print("See docs/10-data-sources.md for what each one needs.")
    blocked = [k for k, (st, _) in results.items() if st == "blocked"]
    if blocked:
        print(f"\n{RED}Network-blocked:{RESET} {', '.join(blocked)}")
        print("These are public endpoints. If they are blocked here but work from "
              "your laptop, the server's egress rules need them allow-listed.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
