#!/usr/bin/env python
"""Emit the hazard catalogue as JS for the dashboard.

Run after changing app/hazards/catalogue.py or the source register:

    cd backend && python scripts/export_catalogue.py

The dashboard reads the generated file rather than a hand-maintained copy, so
the two cannot disagree about which disaster is fed by which source. A UI that
claims a hazard is live when its connector is not configured is worse than one
that says nothing at all.
"""
from __future__ import annotations

import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from app.config import settings
from app.hazards import catalogue as cat

OUT = (pathlib.Path(__file__).resolve().parents[2]
       / "frontend" / "standalone" / "src" / "catalogue.js")

ICONS = {
    "flood": "M2 15c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2M2 20c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2",
    "landslide": "M3 20 10 8l4 6 3-4 4 10Z",
    "earthquake": "M2 12h3l2-6 4 13 3-9 2 4h6",
    "cyclone": "M12 12a4 4 0 1 0 4 4M21 8a9 9 0 0 0-9-4 9 9 0 0 0-8 5M3 16a9 9 0 0 0 9 4",
    "wildfire": "M12 22c4 0 6-3 6-6 0-4-4-5-3-9-3 1-4 4-4 6-1-1-1-3-1-4-2 2-4 4-4 7 0 3 2 6 6 6Z",
    "heatwave": "M12 3v2M12 19v2M5 12H3M21 12h-2M6 6 4.5 4.5M19.5 19.5 18 18M18 6l1.5-1.5M4.5 19.5 6 18M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
    "drought": "M4 18h16M6 14h12M8 10h8M12 3v3",
    "lightning": "M13 2 4 14h7l-1 8 10-13h-8Z",
    "tsunami": "M2 18c3 0 3-3 6-3s3 3 6 3 3-3 6-3M3 12c4-6 10-8 18-6",
}
COLOURS = {
    "flood": "#0B6BA8", "landslide": "#8A5A2B", "earthquake": "#B3261E",
    "cyclone": "#6B4FA8", "wildfire": "#D2551A", "heatwave": "#A96700",
    "drought": "#8A7B3B", "lightning": "#7A5AA8", "tsunami": "#0E6B7A",
}


def main() -> int:
    missing = set(cat.CATALOGUE) - set(ICONS)
    if missing:
        print(f"No icon defined for: {', '.join(sorted(missing))}", file=sys.stderr)
        return 1

    hazards = {}
    for key, spec in cat.CATALOGUE.items():
        d = spec.describe()
        d["ic"], d["c"] = ICONS[key], COLOURS[key]
        d["coastal_only"] = spec.coastal_only
        hazards[key] = d

    sources = {k: {"authority": c.authority, "access": c.access.value,
                   "is_primary": c.is_primary, "requires_key": c.requires_key,
                   "configured": c.configured, "docs_url": c.docs_url,
                   "poll_seconds": c.poll_seconds}
               for k, c in settings.sources.items()}

    OUT.write_text(
        "/* Generated from backend/app/hazards/catalogue.py — do not edit by hand.\n"
        "   Regenerate: cd backend && python scripts/export_catalogue.py */\n\n"
        f"const HAZ = {json.dumps(hazards, indent=2, ensure_ascii=False)};\n\n"
        f"const SOURCE_REGISTRY = {json.dumps(sources, indent=2, ensure_ascii=False)};\n\n"
        f"const POLLING_PLAN = {json.dumps(cat.polling_plan(), indent=2)};\n")
    print(f"wrote {OUT} — {len(hazards)} hazards, {len(sources)} sources")
    return 0


if __name__ == "__main__":
    sys.exit(main())
