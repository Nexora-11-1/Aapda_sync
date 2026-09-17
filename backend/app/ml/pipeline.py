"""
Model training, calibration and inference (§9, §10, §25).

Model choice, and why not a neural network
──────────────────────────────────────────
§9 says: choose on dataset size, temporal characteristics, explainability and
performance — do not reach for deep learning by reflex. For flood and landslide
nowcasting on an Indian district grid the honest assessment is:

  · Data size. A district-year at 15-minute cadence over ~13 000 cells with a
    positive rate around 0.3 % gives a few thousand positive examples. That is
    gradient-boosting territory, not transformer territory.
  · Explainability. An operator must be told *why* a cell went critical, and a
    district magistrate may have to defend the decision afterwards. Tree
    ensembles give exact per-prediction attributions; a sequence model gives
    saliency, which is not the same thing.
  · Class imbalance. Boosted trees with `scale_pos_weight` handle 300:1
    imbalance well. This matters more than model capacity here.

So the production models are LightGBM (falling back to scikit-learn's
HistGradientBoosting where LightGBM is unavailable), with a logistic-regression
baseline that every candidate must beat before it can be promoted. Sequence
models get revisited when there are several years of dense history — the
interface below does not change when they do.

Calibration is not optional. A raw boosted-tree score is not a probability, and
§25 asks for calibration explicitly. Every model is wrapped in isotonic
regression fitted on a held-out *later* window, so "0.87" means what an operator
thinks it means.

False negatives
───────────────
§25 is right to single these out. The threshold is not 0.5: it is chosen on the
validation set as the lowest threshold meeting a recall floor (default 0.90),
and the resulting precision is reported rather than buried. A model that misses
one flood in ten is not acceptable regardless of what it does to the F1 score.
"""
from __future__ import annotations

import json
import logging
import pickle
from collections.abc import Sequence
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import numpy as np

log = logging.getLogger(__name__)

MODEL_DIR = Path("/var/lib/aapdasync/models")
RECALL_FLOOR = 0.90


# ══════════════════════════════════════════════════════════════════════
# Time-aware splitting — the only split this project allows
# ══════════════════════════════════════════════════════════════════════
@dataclass(slots=True)
class TemporalSplit:
    train: tuple[datetime, datetime]
    valid: tuple[datetime, datetime]
    test: tuple[datetime, datetime]
    embargo: timedelta = timedelta(hours=72)

    def describe(self) -> dict:
        return {
            "train": [self.train[0].isoformat(), self.train[1].isoformat()],
            "valid": [self.valid[0].isoformat(), self.valid[1].isoformat()],
            "test": [self.test[0].isoformat(), self.test[1].isoformat()],
            "embargo_hours": self.embargo.total_seconds() / 3600,
            "note": ("Strictly forward-chained with an embargo gap. Random k-fold is "
                     "never used: adjacent 15-minute samples of the same storm are not "
                     "independent, and shuffling them inflates every metric."),
        }


def forward_chain_split(start: datetime, end: datetime, *,
                        train_frac: float = 0.6, valid_frac: float = 0.2,
                        embargo: timedelta = timedelta(hours=72)) -> TemporalSplit:
    span = end - start
    t_end = start + span * train_frac
    v_start = t_end + embargo
    v_end = v_start + span * valid_frac
    te_start = v_end + embargo
    return TemporalSplit((start, t_end), (v_start, v_end), (te_start, end), embargo)


# ══════════════════════════════════════════════════════════════════════
# Metrics
# ══════════════════════════════════════════════════════════════════════
@dataclass(slots=True)
class Metrics:
    n: int
    positives: int
    roc_auc: float | None
    pr_auc: float | None
    brier: float
    ece: float
    threshold: float
    precision: float
    recall: float
    f1: float
    false_negatives: int
    false_positives: int
    true_positives: int
    true_negatives: int

    def as_dict(self) -> dict:
        d = asdict(self)
        d["false_negative_rate"] = (
            self.false_negatives / max(self.false_negatives + self.true_positives, 1))
        d["note"] = ("Threshold chosen as the lowest meeting the recall floor, not 0.5. "
                     "For disaster prediction a false negative costs far more than a "
                     "false positive, and the operating point says so.")
        return d


def expected_calibration_error(y: np.ndarray, p: np.ndarray, bins: int = 10) -> float:
    edges = np.linspace(0.0, 1.0, bins + 1)
    ece = 0.0
    for i in range(bins):
        m = (p >= edges[i]) & (p < edges[i + 1] if i < bins - 1 else p <= 1.0)
        if not m.any():
            continue
        ece += m.mean() * abs(y[m].mean() - p[m].mean())
    return float(ece)


def choose_threshold(y: np.ndarray, p: np.ndarray,
                     recall_floor: float = RECALL_FLOOR) -> float:
    """Lowest threshold that still meets the recall floor.

    Scanned from high to low so we take the *most precise* threshold that is
    still sensitive enough, rather than the first one that clears the bar.
    """
    best = 0.05
    for t in np.linspace(0.95, 0.01, 95):
        pred = p >= t
        tp = int(((pred == 1) & (y == 1)).sum())
        fn = int(((pred == 0) & (y == 1)).sum())
        recall = tp / max(tp + fn, 1)
        if recall >= recall_floor:
            best = float(t)
            break
    return best


def evaluate(y: np.ndarray, p: np.ndarray, threshold: float | None = None) -> Metrics:
    from sklearn.metrics import average_precision_score, roc_auc_score

    y = np.asarray(y).astype(int)
    p = np.asarray(p, dtype=float)
    t = threshold if threshold is not None else choose_threshold(y, p)
    pred = (p >= t).astype(int)

    tp = int(((pred == 1) & (y == 1)).sum())
    tn = int(((pred == 0) & (y == 0)).sum())
    fp = int(((pred == 1) & (y == 0)).sum())
    fn = int(((pred == 0) & (y == 1)).sum())
    precision = tp / max(tp + fp, 1)
    recall = tp / max(tp + fn, 1)

    both_classes = len(np.unique(y)) > 1
    return Metrics(
        n=len(y), positives=int(y.sum()),
        roc_auc=float(roc_auc_score(y, p)) if both_classes else None,
        pr_auc=float(average_precision_score(y, p)) if both_classes else None,
        brier=float(np.mean((p - y) ** 2)),
        ece=expected_calibration_error(y, p),
        threshold=t, precision=precision, recall=recall,
        f1=(2 * precision * recall / max(precision + recall, 1e-9)),
        false_negatives=fn, false_positives=fp, true_positives=tp, true_negatives=tn,
    )


# ══════════════════════════════════════════════════════════════════════
# The model
# ══════════════════════════════════════════════════════════════════════
@dataclass
class HazardModel:
    hazard: str
    version: str
    feature_list: list[str]
    horizon_hours: int
    algorithm: str = "lightgbm"
    estimator: Any = None
    calibrator: Any = None
    threshold: float = 0.5
    imputer_medians: dict[str, float] = field(default_factory=dict)
    metrics: dict[str, Any] = field(default_factory=dict)
    trained_at: datetime | None = None

    # ── matrix assembly ───────────────────────────────────────────────
    def to_matrix(self, rows: Sequence) -> np.ndarray:
        """Feature rows → dense matrix, imputing with training medians.

        Missing values are imputed to the *training* median and never to zero.
        Zero slope means flat ground, which is a claim about the world; a
        missing slope is an absence of information, and conflating the two is
        how a hillside gets scored as a plain.
        """
        X = np.empty((len(rows), len(self.feature_list)), dtype=float)
        for i, row in enumerate(rows):
            values = row.values if hasattr(row, "values") else row
            for j, name in enumerate(self.feature_list):
                v = values.get(name)
                X[i, j] = self.imputer_medians.get(name, 0.0) if v is None else float(v)
        return X

    # ── training ──────────────────────────────────────────────────────
    def fit(self, train_rows: Sequence, train_y: Sequence[int],
            valid_rows: Sequence, valid_y: Sequence[int]) -> dict:
        y_tr = np.asarray(train_y).astype(int)
        y_va = np.asarray(valid_y).astype(int)

        # medians from training only — computing them over the full set would
        # leak validation-period statistics into training
        for j, name in enumerate(self.feature_list):
            col = [r.values.get(name) for r in train_rows if r.values.get(name) is not None]
            self.imputer_medians[name] = float(np.median(col)) if col else 0.0

        X_tr, X_va = self.to_matrix(train_rows), self.to_matrix(valid_rows)
        pos = max(int(y_tr.sum()), 1)
        neg = max(len(y_tr) - pos, 1)
        scale = neg / pos

        self.estimator, self.algorithm = self._build_estimator(scale)
        self.estimator.fit(X_tr, y_tr)

        raw_va = self._raw_scores(X_va)

        # isotonic calibration on the validation window, which sits *after*
        # training in time — calibrating on training data reproduces its
        # optimism
        from sklearn.isotonic import IsotonicRegression
        self.calibrator = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0)
        self.calibrator.fit(raw_va, y_va)

        p_va = self.calibrator.predict(raw_va)
        self.threshold = choose_threshold(y_va, p_va)

        baseline = self._baseline(X_tr, y_tr, X_va, y_va)
        m = evaluate(y_va, p_va, self.threshold)
        self.metrics = {
            "validation": m.as_dict(),
            "baseline_logistic": baseline,
            "beats_baseline": (m.pr_auc or 0) > (baseline.get("pr_auc") or 0),
            "scale_pos_weight": round(scale, 2),
            "algorithm": self.algorithm,
        }
        self.trained_at = datetime.now(UTC)

        if not self.metrics["beats_baseline"]:
            log.warning(
                "%s %s does not beat the logistic baseline on PR-AUC (%.3f vs %.3f). "
                "It must not be promoted to active.",
                self.hazard, self.version, m.pr_auc or 0, baseline.get("pr_auc") or 0)
        return self.metrics

    def _build_estimator(self, scale_pos_weight: float):
        try:
            from lightgbm import LGBMClassifier
            return LGBMClassifier(
                n_estimators=400, learning_rate=0.05, num_leaves=31,
                min_child_samples=40, subsample=0.85, subsample_freq=1,
                colsample_bytree=0.8, reg_lambda=1.0,
                scale_pos_weight=scale_pos_weight, n_jobs=-1, verbose=-1,
            ), "lightgbm"
        except ImportError:
            from sklearn.ensemble import HistGradientBoostingClassifier
            log.info("LightGBM unavailable; using HistGradientBoosting")
            return HistGradientBoostingClassifier(
                max_iter=400, learning_rate=0.05, max_leaf_nodes=31,
                min_samples_leaf=40, l2_regularization=1.0,
                class_weight={0: 1.0, 1: scale_pos_weight},
            ), "hist_gradient_boosting"

    def _raw_scores(self, X: np.ndarray) -> np.ndarray:
        return self.estimator.predict_proba(X)[:, 1]

    @staticmethod
    def _baseline(X_tr, y_tr, X_va, y_va) -> dict:
        """Every model must beat plain logistic regression to be promoted."""
        from sklearn.linear_model import LogisticRegression
        from sklearn.pipeline import make_pipeline
        from sklearn.preprocessing import StandardScaler
        try:
            clf = make_pipeline(StandardScaler(),
                                LogisticRegression(max_iter=1000, class_weight="balanced"))
            clf.fit(X_tr, y_tr)
            p = clf.predict_proba(X_va)[:, 1]
            return evaluate(y_va, p).as_dict()
        except Exception as exc:                       # noqa: BLE001
            return {"error": str(exc)}

    # ── inference ─────────────────────────────────────────────────────
    def predict(self, rows: Sequence) -> list[dict]:
        if self.estimator is None:
            raise RuntimeError(f"{self.version} is not fitted")
        X = self.to_matrix(rows)
        raw = self._raw_scores(X)
        p = self.calibrator.predict(raw) if self.calibrator is not None else raw
        contributions = self._contributions(X)
        return [
            {
                "cell_id": r.cell_id,
                "hazard": self.hazard,
                "probability": float(np.clip(p[i], 0.0, 1.0)),
                "raw_score": float(raw[i]),
                "above_threshold": bool(p[i] >= self.threshold),
                "model_version": self.version,
                "horizon_hours": self.horizon_hours,
                "feature_completeness": round(r.completeness, 3),
                "top_contributors": contributions[i] if contributions else None,
                "feature_snapshot": {k: v for k, v in r.values.items() if v is not None},
            }
            for i, r in enumerate(rows)
        ]

    def _contributions(self, X: np.ndarray) -> list[list[dict]] | None:
        """Per-prediction attributions, so the drawer can say why."""
        try:
            import shap
            explainer = shap.TreeExplainer(self.estimator)
            vals = explainer.shap_values(X)
            if isinstance(vals, list):
                vals = vals[1]
            out = []
            for row in vals:
                order = np.argsort(np.abs(row))[::-1][:5]
                out.append([{"feature": self.feature_list[j],
                             "contribution": round(float(row[j]), 4)} for j in order])
            return out
        except Exception:                              # noqa: BLE001
            # fall back to global importances — less precise, still honest
            imp = getattr(self.estimator, "feature_importances_", None)
            if imp is None:
                return None
            order = np.argsort(imp)[::-1][:5]
            top = [{"feature": self.feature_list[j],
                    "importance": round(float(imp[j]), 4), "scope": "global"} for j in order]
            return [top] * len(X)

    # ── persistence ───────────────────────────────────────────────────
    def save(self, directory: Path | None = None) -> Path:
        directory = directory or MODEL_DIR
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"{self.version}.pkl"
        with path.open("wb") as fh:
            pickle.dump(self, fh, protocol=pickle.HIGHEST_PROTOCOL)
        (directory / f"{self.version}.json").write_text(json.dumps({
            "version": self.version, "hazard": self.hazard, "algorithm": self.algorithm,
            "horizon_hours": self.horizon_hours, "threshold": self.threshold,
            "features": self.feature_list, "metrics": self.metrics,
            "trained_at": self.trained_at.isoformat() if self.trained_at else None,
        }, indent=2))
        return path

    @staticmethod
    def load(version: str, directory: Path | None = None) -> HazardModel:
        directory = directory or MODEL_DIR
        with (directory / f"{version}.pkl").open("rb") as fh:
            return pickle.load(fh)


# ══════════════════════════════════════════════════════════════════════
# Registry
# ══════════════════════════════════════════════════════════════════════
class ModelRegistry:
    """Active model per hazard, with promotion gated on beating the baseline."""

    def __init__(self, directory: Path | None = None):
        self.directory = directory or MODEL_DIR
        self._active: dict[str, HazardModel] = {}

    def active(self, hazard: str) -> HazardModel | None:
        return self._active.get(hazard)

    def promote(self, model: HazardModel, *, force: bool = False) -> bool:
        if not force and not model.metrics.get("beats_baseline", False):
            log.error("refusing to promote %s: it does not beat the logistic baseline",
                      model.version)
            return False
        recall = model.metrics.get("validation", {}).get("recall", 0.0)
        if not force and recall < RECALL_FLOOR - 0.05:
            log.error("refusing to promote %s: validation recall %.2f is below the floor",
                      model.version, recall)
            return False
        self._active[model.hazard] = model
        log.info("promoted %s for %s", model.version, model.hazard)
        return True

    def load_active(self, versions: dict[str, str]) -> None:
        for hazard, version in versions.items():
            try:
                self._active[hazard] = HazardModel.load(version, self.directory)
            except FileNotFoundError:
                log.warning("model %s for %s is not on disk", version, hazard)


def next_version(hazard: str, algorithm: str, seq: int) -> str:
    return f"{hazard}-{algorithm}-v0.{seq}.0"
