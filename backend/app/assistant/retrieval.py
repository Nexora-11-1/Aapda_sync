"""Retrieval for the assistant.

This is the retrieval half of RAG, and it is deliberately the half that
lives here. Generation may be a hosted language model, a local one, or —
in the single-file build — a grounded composer; what must not vary is
*what it is allowed to see*. Every deployment answers from the same
retrieved set, under the same three rules:

  1. Nothing retrieved above threshold ⇒ say so. No fallback to the
     model's own knowledge. In a disaster platform a fluent invented
     answer is worse than an admission of ignorance, because it is
     indistinguishable from a real one at the moment it matters.
  2. A model estimate is never rendered as a warning. Official CAP alerts
     keep their issuing authority and are quoted as warnings; everything
     the platform computed is labelled decision support.
  3. No personal safety adjudication. "Am I safe?" is answered with the
     records and the official instruction, never with a yes or a no.

Scoring is Okapi BM25 with a title boost, then MMR for diversity, then
intent-aware routing. Rank-only, no embeddings: the corpus is a few
thousand short operational records that turn over every few minutes, an
embedding index would be stale before it finished building, and lexical
match is what actually retrieves "SH-206" and "Nandprayag".
"""

from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass, field

K1 = 1.5
B = 0.75
TITLE_BOOST = 1.8
MIN_SCORE_PER_TERM = 0.62
MMR_LAMBDA = 0.72

STOPWORDS = frozenset("""
a an the is are was were be been being of in on at to for from by with and or but if then
than that this these those there here it its as into about over under what which who whom
whose when where why how do does did can could should would will shall my your our their
i we you they me us them he she his her not no yes any some all more most much many very
just also so such own same too s t
""".split())

_TOKEN = re.compile(r"[^a-z0-9ऀ-ॿ]+")


def fold(word: str) -> str:
    """Light suffix folding. Full stemming mangles Indian place names —
    'Simli' and 'Reni' are not inflections of anything."""
    if len(word) > 4 and word.endswith("ies"):
        return word[:-3] + "y"
    if len(word) > 4 and word.endswith("ses"):
        return word[:-2]
    if len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
        return word[:-1]
    if len(word) > 5 and word.endswith("ing"):
        return word[:-3]
    if len(word) > 4 and word.endswith("ed"):
        return word[:-2]
    return word


def tokenise(text: str) -> list[str]:
    return [fold(w) for w in _TOKEN.split(text.lower())
            if len(w) > 1 and w not in STOPWORDS]


@dataclass(frozen=True)
class Passage:
    """One retrievable record. `ref` is what gets shown to the user as the
    citation, so it must name something they can go and look at."""
    id: str
    kind: str
    title: str
    text: str
    ref: str
    observed_at: str | None = None


@dataclass
class Scored:
    passage: Passage
    score: float


# Which kinds of record answer which shape of question. Routing, not
# invention: passages still come from real retrieval and are still cited.
INTENT_BOOST: dict[str, dict[str, float]] = {
    "guidance": {"safety": 2.2, "policy": 1.2, "history": 1.1},
    "explain": {"method": 2.0, "policy": 1.6, "catalogue": 1.3},
    "latest": {"state": 1.9, "alert": 1.7, "cell": 1.3},
    "locate": {"cell": 1.6, "shelter": 1.6, "state": 1.4, "road": 1.3},
    "quantity": {"shelter": 1.5, "cell": 1.4, "priority": 1.4},
}

# Kinds that are never the answer to a given shape of question. Dropped
# whenever anything else survives the filter, so the exclusion can never
# leave a question unanswerable that the corpus could have answered.
INTENT_EXCLUDE: dict[str, tuple[str, ...]] = {
    "guidance": ("model", "catalogue", "source", "priority"),
    "latest": ("model", "method"),
    "locate": ("model", "method", "policy", "history"),
    "quantity": ("policy", "history", "model", "method"),
}

_PERSONAL = re.compile(
    r"\b(am i|are we|is my (house|home|family|village)|will i|should i (leave|evacuate|go))\b")
_LATEST = re.compile(r"\b(latest|newest|right now|currently|current|most severe|worst)\b")
_GUIDANCE = re.compile(r"\b(what should|what to do|how to (stay|be) safe|prepare|precaution|safety)\b")
_QUANTITY = re.compile(r"\b(how many|how much|count|number of|total|have space|available)\b")
_EXPLAIN = re.compile(r"\b(why|how (does|is|are|do))\b")
_LOCATE = re.compile(r"\b(where|nearest|which (state|district|zone|shelter|road|cell)s?)\b")


def classify(query: str) -> str:
    q = query.lower()
    if _PERSONAL.search(q):
        return "personal"
    if _LATEST.search(q):
        return "latest"
    if _GUIDANCE.search(q):
        return "guidance"
    if _QUANTITY.search(q):
        return "quantity"
    if _EXPLAIN.search(q):
        return "explain"
    if _LOCATE.search(q):
        return "locate"
    return "general"


@dataclass
class Index:
    """A BM25 index over the platform's records.

    Rebuilt whenever the pipeline has moved. Building is O(total tokens)
    and the corpus is small enough that rebuilding is cheaper than the
    bookkeeping of an incremental index that could drift out of step with
    the store it is meant to describe.
    """
    passages: list[Passage] = field(default_factory=list)
    _tf: list[Counter] = field(default_factory=list, repr=False)
    _title: list[frozenset] = field(default_factory=list, repr=False)
    _len: list[int] = field(default_factory=list, repr=False)
    _df: Counter = field(default_factory=Counter, repr=False)
    _avg_len: float = 0.0

    def build(self, passages: list[Passage]) -> "Index":
        self.passages = list(passages)
        self._tf, self._title, self._len, self._df = [], [], [], Counter()
        total = 0
        for p in self.passages:
            toks = tokenise(p.title + " " + p.text)
            tf = Counter(toks)
            self._tf.append(tf)
            self._title.append(frozenset(tokenise(p.title)))
            self._len.append(len(toks))
            total += len(toks)
            self._df.update(tf.keys())
        self._avg_len = total / len(self.passages) if self.passages else 0.0
        return self

    # ── scoring ──────────────────────────────────────────────────────
    def _bm25(self, terms: list[str], i: int) -> float:
        n = len(self.passages)
        tf, length = self._tf[i], self._len[i] or 1
        score = 0.0
        for t in terms:
            f = tf.get(t, 0)
            if not f:
                continue
            df = self._df.get(t, 0.5)
            idf = math.log(1 + (n - df + 0.5) / (df + 0.5))
            part = idf * (f * (K1 + 1)) / (f + K1 * (1 - B + B * length / self._avg_len))
            if t in self._title[i]:
                part *= TITLE_BOOST
            score += part
        return score

    def matchable(self, terms: list[str]) -> int:
        """How many of the question's words this corpus has ever seen.
        A question built entirely of unknown words cannot be answered from
        these records, and that is the honest signal to refuse on."""
        return sum(1 for t in terms if t in self._df)

    def retrieve(self, query: str, k: int = 5, intent: str | None = None) -> dict:
        terms = tokenise(query)
        if not terms or not self.passages:
            return {"passages": [], "matchable": 0, "score_per_term": 0.0,
                    "intent": intent or classify(query)}

        intent = intent or classify(query)
        boost = INTENT_BOOST.get(intent, {})
        matchable = self.matchable(terms)

        scored = [
            Scored(p, self._bm25(terms, i) * boost.get(p.kind, 1.0))
            for i, p in enumerate(self.passages)
        ]
        scored = sorted((s for s in scored if s.score > 0),
                        key=lambda s: s.score, reverse=True)
        if not scored:
            return {"passages": [], "matchable": matchable, "score_per_term": 0.0,
                    "intent": intent}

        drop = INTENT_EXCLUDE.get(intent)
        if drop:
            kept = [s for s in scored if s.passage.kind not in drop]
            # Never filter down to nothing — but one good passage beats
            # five that answer a different question.
            if kept:
                scored = kept

        top = scored[0].score
        return {
            "passages": _mmr(scored, min(k, len(scored))),
            "matchable": matchable,
            "score_per_term": top / max(matchable, 1),
            "intent": intent,
            "top_score": top,
        }

    def answerable(self, result: dict) -> bool:
        """The refusal test, in one place so every caller applies the same
        one. Threshold is per matchable term, not absolute: BM25 scales
        with query length, so a fixed floor silently refuses every short
        question — 'what should I do in a flood' has exactly one content
        word once the stopwords are gone."""
        return (bool(result["passages"])
                and result["matchable"] > 0
                and result["score_per_term"] >= MIN_SCORE_PER_TERM)


def _mmr(scored: list[Scored], k: int, lam: float = MMR_LAMBDA) -> list[Scored]:
    """Maximal marginal relevance — relevant passages that are not
    near-duplicates of each other. Without it, asking about a flood
    returns five flood cells that all say the same thing and the answer
    is narrower than the corpus it came from."""
    pool = scored[:40]
    chosen: list[Scored] = []
    tokens = {id(s): set(tokenise(s.passage.title + " " + s.passage.text)) for s in pool}
    best_score = pool[0].score if pool else 1.0

    def sim(a: Scored, b: Scored) -> float:
        ta, tb = tokens[id(a)], tokens[id(b)]
        if not ta or not tb:
            return 0.0
        return len(ta & tb) / min(len(ta), len(tb))

    while pool and len(chosen) < k:
        best, best_val = None, -math.inf
        for cand in pool:
            redundancy = max((sim(cand, c) for c in chosen), default=0.0)
            val = lam * cand.score - (1 - lam) * redundancy * best_score
            if val > best_val:
                best, best_val = cand, val
        chosen.append(best)
        pool.remove(best)
    return chosen


# ── The refusals, as data ────────────────────────────────────────────
REFUSAL_NO_RECORD = (
    "I do not have a record that answers that. I answer only from this platform's own "
    "data — risk cells, official alerts, shelters, roads, sources and models — and from "
    "its documented methods. Nothing there matched your question closely enough for me "
    "to answer it honestly."
)

REFUSAL_PERSONAL = (
    "I cannot tell you whether you personally are safe. That depends on exactly where you "
    "are, and it is a judgement for the authorities and the responders on the ground — not "
    "for a model. What I can show you is what the platform holds for your area and the "
    "official instruction in force. If you are in immediate danger, call 112."
)

MODEL_CAVEAT = "These are AI-based estimates for decision support, not official warnings."
MIXED_CAVEAT = ("The warning above is official and takes precedence. The scores are model "
                "estimates.")

MODEL_KINDS = frozenset({"cell", "priority", "model", "state"})


def caveat_for(passages: list[Scored]) -> str | None:
    """Rule 2, applied mechanically rather than left to a prompt."""
    kinds = {s.passage.kind for s in passages}
    used_model = bool(kinds & MODEL_KINDS)
    used_alert = "alert" in kinds
    if used_model and used_alert:
        return MIXED_CAVEAT
    if used_model:
        return MODEL_CAVEAT
    return None
