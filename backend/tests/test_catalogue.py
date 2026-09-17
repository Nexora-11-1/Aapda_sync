"""
Tests for the hazard catalogue.

The catalogue is what the UI, the polling scheduler and the degraded-input
stamping all read. If it can drift from what is actually configured, every one
of those lies in a different way.
"""
from __future__ import annotations

import pytest

from app.config import AccessMode, settings
from app.hazards import catalogue as cat


class TestCatalogueShape:
    def test_all_nine_hazards_present(self):
        expected = {"flood", "landslide", "earthquake", "cyclone", "wildfire",
                    "heatwave", "drought", "lightning", "tsunami"}
        assert set(cat.CATALOGUE) == expected

    def test_every_hazard_names_at_least_one_authoritative_source(self):
        """Every disaster must have an Indian statutory source named, even if it
        is not configured. A hazard with no authority is a hazard nobody can be
        held to."""
        for key, spec in cat.CATALOGUE.items():
            assert spec.authoritative, f"{key} names no authoritative source"

    def test_every_source_referenced_is_registered(self):
        """A catalogue entry pointing at a source that does not exist in config
        would silently make a hazard permanently dead."""
        for key, spec in cat.CATALOGUE.items():
            for src in (*spec.authoritative, *spec.supplementary):
                assert src in settings.sources, f"{key} references unknown source {src}"

    def test_every_hazard_explains_its_signal(self):
        for spec in cat.CATALOGUE.values():
            assert len(spec.signal) > 20, f"{spec.key} does not explain its signal"

    def test_cadence_matches_how_fast_the_hazard_moves(self):
        """An earthquake is instantaneous; a drought takes months. Polling them
        at the same rate is either wasteful or negligent."""
        assert cat.CATALOGUE["earthquake"].cadence_s <= 300
        assert cat.CATALOGUE["tsunami"].cadence_s <= 300
        assert cat.CATALOGUE["drought"].cadence_s >= 3600
        assert cat.CATALOGUE["flood"].cadence_s < cat.CATALOGUE["drought"].cadence_s

    def test_horizons_are_sane(self):
        assert cat.CATALOGUE["flood"].horizon_h <= 12
        assert cat.CATALOGUE["landslide"].horizon_h <= 48
        assert cat.CATALOGUE["drought"].horizon_h >= 168


class TestLiveness:
    def test_all_nine_are_live_without_any_credential(self):
        """The headline claim: a fresh deployment with an empty .env scores every
        hazard. Credentials buy fidelity, not existence."""
        live = set(cat.live_hazards())
        assert live == set(cat.CATALOGUE), (
            f"not live keyless: {sorted(set(cat.CATALOGUE) - live)}")

    def test_credentials_buy_fidelity_not_existence(self):
        """Wildfire runs on GDACS large-fire alerts with no key. A FIRMS key
        changes what it can see, not whether it runs — and the catalogue must
        say which of the two it is currently doing."""
        spec = cat.CATALOGUE["wildfire"]
        assert spec.live()
        assert not settings.source("firms").configured
        assert "coarse" in spec.fidelity().lower()
        assert "375" in spec.fidelity_notes["firms"]

    def test_a_live_hazard_has_a_reachable_source_named(self):
        for key in cat.live_hazards():
            assert cat.CATALOGUE[key].configured_sources()

    def test_tier_reports_supplementary_when_authority_is_absent(self):
        """With no IMD/CWC/NCS credentials the platform runs on open sources —
        and must say 'supplementary', not pretend it has the authority."""
        assert cat.CATALOGUE["earthquake"].tier() == "supplementary"
        assert cat.CATALOGUE["flood"].tier() == "supplementary"

    def test_degraded_inputs_name_the_missing_authority(self):
        degraded = cat.CATALOGUE["flood"].degraded_inputs()
        assert "imd" in degraded and "cwc" in degraded

    def test_every_hazard_reports_its_current_fidelity(self):
        """Live/not-live is not enough. 'We have wildfire' must distinguish
        per-pixel detection from a continent-scale alert."""
        for key, spec in cat.CATALOGUE.items():
            f = spec.fidelity()
            assert f and f != "no source", f"{key} does not report its fidelity"

    def test_flood_fidelity_names_the_gauge_distinction(self):
        f = cat.CATALOGUE["flood"].fidelity().lower()
        assert "not a gauge" in f or "modelled" in f

    def test_a_public_source_needing_a_key_is_not_configured_without_one(self):
        """The bug this guards: access=PUBLIC meant 'no registration', which made
        FIRMS look configured when it could not actually call anything."""
        for key in ("firms", "opentopo"):
            cfg = settings.source(key)
            assert cfg.requires_key
            assert not cfg.configured


class TestGeography:
    def test_coastal_hazards_excluded_inland(self):
        """Chamoli is landlocked. Scoring cyclone there produces confident zeros
        that teach operators to ignore the hazard switcher."""
        assert not cat.applicable("cyclone", coastal=False)
        assert not cat.applicable("tsunami", coastal=False)
        assert cat.applicable("cyclone", coastal=True)
        assert cat.applicable("tsunami", coastal=True)

    def test_inland_hazards_apply_everywhere(self):
        for h in ("flood", "landslide", "earthquake", "heatwave", "drought", "lightning"):
            assert cat.applicable(h, coastal=False)
            assert cat.applicable(h, coastal=True)

    def test_unknown_hazard_is_not_applicable(self):
        assert not cat.applicable("meteor_strike", coastal=False)


class TestPollingPlan:
    def test_plan_only_includes_configured_sources(self):
        for key in cat.polling_plan():
            assert settings.source(key).configured

    def test_source_floor_beats_an_impatient_hazard(self):
        """Tsunami wants 120 s and GDACS feeds it — but GDACS declares a 900 s
        floor. Wanting data faster does not entitle us to hammer a donated
        service; the fast hazard gets that source less often than it would like."""
        plan = cat.polling_plan()
        if "gdacs" in plan:
            assert plan["gdacs"] >= settings.source("gdacs").poll_seconds
        if "usgs" in plan:
            assert plan["usgs"] >= settings.source("usgs").poll_seconds

    def test_no_source_is_polled_faster_than_it_declares(self):
        for key, seconds in cat.polling_plan().items():
            floor = settings.source(key).poll_seconds
            if floor:
                assert seconds >= floor, f"{key} polled every {seconds}s, floor is {floor}s"

    def test_plan_tracks_hazard_demand_when_the_floor_does_not_bind(self):
        """The plan must be derived, not a second hand-maintained list. With the
        source floor lowered out of the way, changing a hazard's cadence has to
        move the plan — otherwise the two drift apart the first time someone
        edits one of them."""
        src = settings.source("usgs")
        original_floor, original_cadence = src.poll_seconds, cat.CATALOGUE["tsunami"].cadence_s
        src.poll_seconds = 1                       # take the floor out of play
        try:
            object.__setattr__(cat.CATALOGUE["tsunami"], "cadence_s", 240)
            object.__setattr__(cat.CATALOGUE["earthquake"], "cadence_s", 240)
            assert cat.polling_plan()["usgs"] == 240

            object.__setattr__(cat.CATALOGUE["tsunami"], "cadence_s", 90)
            assert cat.polling_plan()["usgs"] == 90, "plan ignored the faster hazard"
        finally:
            src.poll_seconds = original_floor
            object.__setattr__(cat.CATALOGUE["tsunami"], "cadence_s", original_cadence)
            object.__setattr__(cat.CATALOGUE["earthquake"], "cadence_s", 120)

    def test_no_source_polls_faster_than_once_a_minute(self):
        """Politeness to free services, and a floor on our own load."""
        assert all(v >= 60 for v in cat.polling_plan().values())


class TestSourceRouting:
    def test_a_record_recomputes_every_hazard_it_feeds(self):
        """Open-Meteo feeds six hazards. A new observation must recompute all
        six, not just the one someone happened to be looking at."""
        fed = cat.hazards_for_source("openmeteo")
        assert {"flood", "landslide", "heatwave", "drought", "lightning"} <= set(fed)

    def test_gdacs_feeds_the_hazards_it_actually_covers(self):
        fed = set(cat.hazards_for_source("gdacs"))
        assert {"cyclone", "flood", "earthquake", "drought", "wildfire"} <= fed

    def test_unknown_source_feeds_nothing(self):
        assert cat.hazards_for_source("not-a-real-source") == []


class TestStatusReport:
    def test_report_is_json_serialisable(self):
        import json
        json.dumps(cat.status_report())

    def test_report_counts_match_the_catalogue(self):
        r = cat.status_report()
        assert r["total"] == len(cat.CATALOGUE)
        assert r["live"] == len(cat.live_hazards())

    def test_report_explains_the_supplementary_rule(self):
        note = cat.status_report()["note"].lower()
        assert "degraded_inputs" in note
        assert "never relabelled" in note or "never" in note

    def test_every_hazard_in_the_report_states_its_tier(self):
        for spec in cat.status_report()["hazards"]:
            assert spec["tier"] in ("authoritative", "supplementary", "unavailable")


class TestHonesty:
    def test_lightning_is_labelled_a_proxy(self):
        """CAPE says the atmosphere could produce lightning. Only a detection
        network says it did. The catalogue must not blur that."""
        notes = cat.CATALOGUE["lightning"].notes.lower()
        assert "proxy" in notes
        assert "not a strike network" in notes

    def test_tsunami_defers_to_itewc(self):
        notes = cat.CATALOGUE["tsunami"].notes.lower()
        assert "itewc" in notes or "early warning centre" in notes
        assert "never modelled here" in notes

    def test_glofas_is_not_described_as_a_gauge(self):
        notes = cat.CATALOGUE["flood"].notes.lower()
        assert "different quantity" in notes or "gauge" in notes

    def test_a_source_is_not_both_authoritative_and_supplementary(self):
        """The two tiers must be disjoint per hazard, or `degraded_inputs` would
        name a source that is in fact feeding the hazard."""
        for spec in cat.CATALOGUE.values():
            overlap = set(spec.authoritative) & set(spec.supplementary)
            assert not overlap, f"{spec.key}: {overlap} is in both tiers"

    def test_non_indian_sources_are_never_registered_as_primary(self):
        """`is_primary` means 'an Indian statutory authority'. USGS, GDACS,
        Open-Meteo and GloFAS are none of those, and marking one primary would
        put it in the UI's authority row."""
        for key in ("usgs", "gdacs", "openmeteo", "glofas", "overpass",
                    "firms", "opentopo", "worldpop"):
            assert not settings.source(key).is_primary, f"{key} is not an Indian authority"

    def test_indian_authorities_are_registered_as_primary(self):
        for key in ("imd", "sachet", "cwc", "nrsc", "incois", "ncs"):
            assert settings.source(key).is_primary

    def test_public_sources_need_no_key(self):
        for key, cfg in settings.sources.items():
            if cfg.access is AccessMode.PUBLIC and cfg.base_url and key not in (
                    "firms", "opentopo"):
                assert cfg.configured, f"{key} is public but reports unconfigured"
