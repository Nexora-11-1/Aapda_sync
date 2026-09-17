"""The assistant's retrieval, and the three rules it must not break."""

import pytest

from app.assistant.retrieval import (
    Index,
    Passage,
    caveat_for,
    classify,
    fold,
    tokenise,
    MODEL_CAVEAT,
    MIXED_CAVEAT,
)


@pytest.fixture
def corpus():
    return [
        Passage("safety.flood", "safety", "Flood — what to do",
                "Move to higher ground before water reaches the road, not after. Do not try to "
                "cross a flooded causeway on foot or by vehicle. Switch off electricity at the "
                "mains before you leave.", "Public safety guidance · NDMA"),
        Passage("safety.quake", "safety", "Earthquake — what to do",
                "Drop, cover and hold on. Stay away from windows until the shaking stops.",
                "Public safety guidance · NDMA"),
        Passage("doc.capacity", "method", "How shelter capacity is calculated",
                "Effective capacity is the minimum of space, water, food, sanitation and medical "
                "capacity, and the platform names which constraint binds.",
                "Capacity engine"),
        Passage("mdl.flood", "model", "Model flood-lgbm-v0.4.0",
                "Model flood-lgbm-v0.4.0 for flood, algorithm LightGBM, horizon 6 hours, "
                "ROC AUC 0.941.", "Model registry"),
        Passage("cell.C2", "cell", "Zone C2 · Nandprayag",
                "Zone C2 Nandprayag. Flood risk 94 out of 100, critical band, confidence 84 "
                "percent. Population 4820.", "Live risk cell · C2 Nandprayag"),
        Passage("alert.CWC", "alert", "Official warning · River in Severe Flood Situation",
                "Official warning issued by the Central Water Commission. Alaknanda at "
                "Nandprayag above danger level, rising.", "Official CAP alert · CWC"),
        Passage("sh.201", "shelter", "SH-201 · GIC Karnaprayag",
                "GIC Karnaprayag, shelter SH-201. Open with 198 effective places available. "
                "Limited by water.", "Shelter register · SH-201"),
    ]


@pytest.fixture
def index(corpus):
    return Index().build(corpus)


# ── tokenisation ─────────────────────────────────────────────────────
def test_stopwords_are_dropped_but_content_survives():
    assert tokenise("What should I do in a flood") == ["flood"]


def test_folding_matches_plurals_without_mangling_place_names():
    assert fold("shelters") == "shelter"
    assert fold("Nandprayag".lower()) == "nandprayag"
    assert fold("simli") == "simli"


# ── intent ───────────────────────────────────────────────────────────
@pytest.mark.parametrize("query,expected", [
    ("am I safe in my house", "personal"),
    ("should I evacuate", "personal"),
    ("what is happening right now", "latest"),
    ("what should I do in a flood", "guidance"),
    ("how many shelters have space", "quantity"),
    ("why is confidence low", "explain"),
    ("which shelters have space", "quantity"),
    ("where is the nearest shelter", "locate"),
])
def test_intent_classification(query, expected):
    assert classify(query) == expected


# ── retrieval ────────────────────────────────────────────────────────
def test_short_guidance_question_is_answerable(index):
    """The bug this catches: an absolute score floor refuses every short
    question, because BM25 scales with how many words the query has."""
    r = index.retrieve("what should I do in a flood")
    assert index.answerable(r), r["score_per_term"]
    assert r["passages"][0].passage.id == "safety.flood"


def test_guidance_excludes_the_model_registry(index):
    r = index.retrieve("what should I do in a flood")
    kinds = {s.passage.kind for s in r["passages"]}
    assert "model" not in kinds


def test_out_of_corpus_question_is_refused(index):
    r = index.retrieve("who won the 2019 cricket world cup")
    assert not index.answerable(r)


def test_nonsense_is_refused(index):
    r = index.retrieve("qwertyuiop zxcvbnm")
    assert r["matchable"] == 0
    assert not index.answerable(r)


def test_title_terms_outrank_body_terms(index):
    """'capacity' appears in both the method passage's title and the
    shelter record's body. The passage that is *about* capacity wins."""
    r = index.retrieve("how is capacity calculated")
    assert r["passages"][0].passage.id == "doc.capacity"


def test_mmr_does_not_return_near_duplicates():
    dupes = [Passage(f"d{i}", "cell", f"Zone {i}",
                     "Flood risk high, river above danger level, population exposed.",
                     f"cell {i}") for i in range(8)]
    unique = Passage("u", "safety", "Flood — what to do",
                     "Move to higher ground before water reaches the road.", "guidance")
    idx = Index().build(dupes + [unique])
    got = idx.retrieve("flood", k=4)
    ids = [s.passage.id for s in got["passages"]]
    assert "u" in ids, "diversification should surface the passage that says something else"


def test_locate_prefers_records_over_methodology(index):
    r = index.retrieve("where is the nearest shelter")
    kinds = [s.passage.kind for s in r["passages"]]
    assert kinds[0] in {"shelter", "cell", "state"}


# ── the three rules ──────────────────────────────────────────────────
def test_personal_safety_is_never_adjudicated(index):
    assert classify("am I safe here right now") == "personal"


def test_model_only_answers_carry_the_not_a_warning_caveat(index):
    r = index.retrieve("what is the risk in zone C2")
    assert caveat_for(r["passages"]) in {MODEL_CAVEAT, MIXED_CAVEAT}


def test_a_mixed_answer_says_the_warning_takes_precedence():
    from app.assistant.retrieval import Scored
    passages = [
        Scored(Passage("a", "alert", "t", "x", "r"), 1.0),
        Scored(Passage("c", "cell", "t", "x", "r"), 0.9),
    ]
    assert caveat_for(passages) == MIXED_CAVEAT


def test_pure_guidance_carries_no_model_caveat():
    from app.assistant.retrieval import Scored
    passages = [Scored(Passage("s", "safety", "t", "x", "r"), 1.0)]
    assert caveat_for(passages) is None


def test_every_passage_carries_a_citable_reference(index):
    r = index.retrieve("flood risk nandprayag")
    assert all(s.passage.ref for s in r["passages"])
