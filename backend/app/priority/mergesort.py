"""
Merge sort over relocation priorities (§15).

Why merge sort here and not `list.sort()`
─────────────────────────────────────────
Three properties this ordering must have, which the library sort does not give
us together:

1. **Stability under a documented tie-break.** Two zones with identical priority
   scores must come out in a defined order — by exposed population, then by
   cell id — every run, on every machine. An evacuation queue that reshuffles
   between ticks because two scores tied at 0.8140 destroys an operator's trust
   in the screen. Merge sort's stability is a property of the merge step, and
   here the comparator is explicit and auditable.

2. **An auditable comparison trace.** `sort_with_trace` records the merge tree,
   which is what the UI shows when an operator asks *why is Reni above
   Joshimath*. Answering that from a black-box sort means re-deriving it.

3. **A predictable Θ(n log n) worst case.** Introsort's pathological cases are
   rare but they exist, and this runs inside a 15-minute tick that must not
   miss its deadline during the one event that matters.

Formal analysis
───────────────
  mergesort(A):
      if |A| <= 1: return A                       # base case, Θ(1)
      mid = |A| / 2                               # divide, Θ(1)
      L = mergesort(A[:mid])                      # T(n/2)
      R = mergesort(A[mid:])                      # T(n/2)
      return merge(L, R)                          # combine, Θ(n)

  Recurrence:   T(n) = 2·T(n/2) + Θ(n),  T(1) = Θ(1)

  Master theorem case 2: a = 2, b = 2, f(n) = Θ(n) = Θ(n^(log_2 2)).
      ⇒ T(n) = Θ(n log n)

  Best, average and worst case are all Θ(n log n) — no input ordering changes
  the shape of the recursion tree. Comparisons are between ⌈n log₂ n − n + 1⌉
  and n log₂ n.

  Space: Θ(n) auxiliary for the merge buffers, Θ(log n) stack depth.
  Stability: preserved, because `merge` takes from the left run on ties
  (`if right_key < left_key` — strict — never `<=`).
"""
from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Any, TypeVar

T = TypeVar("T")


# ══════════════════════════════════════════════════════════════════════
# Core
# ══════════════════════════════════════════════════════════════════════
def merge_sort(items: Sequence[T], key: Callable[[T], Any]) -> list[T]:
    """Stable Θ(n log n) sort, ascending by `key`.

    The priority engine calls this with a negated score so the highest priority
    lands at index 0 while the comparator stays a plain ascending one.
    """
    working = list(items)
    if len(working) <= 1:                      # ── base case
        return working

    mid = len(working) // 2                    # ── divide
    left = merge_sort(working[:mid], key)      # ── conquer
    right = merge_sort(working[mid:], key)
    return _merge(left, right, key)            # ── combine


def _merge(left: list[T], right: list[T], key: Callable[[T], Any]) -> list[T]:
    """Θ(n) merge. Strict `<` on the right operand is what keeps it stable."""
    out: list[T] = []
    i = j = 0
    while i < len(left) and j < len(right):
        if key(right[j]) < key(left[i]):
            out.append(right[j]); j += 1
        else:
            out.append(left[i]); i += 1        # ties take from the left run
    out.extend(left[i:])
    out.extend(right[j:])
    return out


# ══════════════════════════════════════════════════════════════════════
# Traced variant — for the "why is this zone above that one" panel
# ══════════════════════════════════════════════════════════════════════
@dataclass(slots=True)
class MergeTrace:
    depth: int
    left_size: int
    right_size: int
    comparisons: int
    result_head: list[str] = field(default_factory=list)


@dataclass(slots=True)
class SortReport:
    n: int
    comparisons: int
    depth: int
    merges: list[MergeTrace] = field(default_factory=list)

    @property
    def theoretical_max_comparisons(self) -> int:
        import math
        return 0 if self.n <= 1 else int(self.n * math.log2(self.n))

    def summary(self) -> dict:
        return {
            "n": self.n,
            "comparisons": self.comparisons,
            "theoretical_max": self.theoretical_max_comparisons,
            "recursion_depth": self.depth,
            "complexity": "T(n) = 2T(n/2) + O(n) = O(n log n)",
            "space": "O(n) auxiliary, O(log n) stack",
            "stable": True,
        }


def sort_with_trace(items: Sequence[T], key: Callable[[T], Any],
                    label: Callable[[T], str] | None = None) -> tuple[list[T], SortReport]:
    report = SortReport(n=len(items), comparisons=0, depth=0)
    label = label or (lambda x: str(x))

    def rec(seq: list[T], depth: int) -> list[T]:
        report.depth = max(report.depth, depth)
        if len(seq) <= 1:
            return seq
        mid = len(seq) // 2
        left, right = rec(seq[:mid], depth + 1), rec(seq[mid:], depth + 1)

        out: list[T] = []
        i = j = comps = 0
        while i < len(left) and j < len(right):
            comps += 1
            if key(right[j]) < key(left[i]):
                out.append(right[j]); j += 1
            else:
                out.append(left[i]); i += 1
        out.extend(left[i:]); out.extend(right[j:])

        report.comparisons += comps
        report.merges.append(MergeTrace(
            depth=depth, left_size=len(left), right_size=len(right),
            comparisons=comps, result_head=[label(x) for x in out[:3]],
        ))
        return out

    return rec(list(items), 0), report


# ══════════════════════════════════════════════════════════════════════
# The comparator the platform actually uses
# ══════════════════════════════════════════════════════════════════════
def priority_key(zone) -> tuple:
    """Ascending key that yields descending urgency.

    Documented tie-break chain, in order:
      1. priority score, highest first
      2. exposed population, largest first
      3. time to impact, soonest first
      4. cell id, lexicographic — the deterministic backstop

    Every level is negated where "more is more urgent", so a plain ascending
    sort produces a descending urgency list and the comparator stays readable.
    """
    return (
        -round(float(zone.priority_score), 6),
        -int(zone.expected_exposed or 0),
        float(zone.time_to_impact_h) if zone.time_to_impact_h is not None else 1e9,
        str(zone.cell_id),
    )
