#!/usr/bin/env python3
"""
AapdaSync — hazard-occurrence forecaster
================================================================================
Trains the model that answers "where is a hazard likely to impact in the next
seven days", and exports it as plain JSON weights for the browser to run.

WHAT IS REAL AND WHAT IS NOT
--------------------------------------------------------------------------
The habitation covariates (slope, susceptibility, elevation, 100-yr depth,
liquefaction, plume fraction) come from src/data.js and are SIMULATED, because
Sarai Ghat is a fictional district.

The six-year daily event history is GENERATED, by a documented stochastic
process below. That process is deliberately NOT the feature set the model
sees: it uses hidden state (a catchment store, a slope-stability reservoir,
district-wide shock days) that never reaches the model. Training a model on
its own scoring function would be circular and would report a meaningless AUC.
Here the model has to infer a process it cannot observe, from lagged rainfall
and static terrain, which is the same problem a real forecaster faces.

The evaluation is honest in the way that matters most for this kind of model:
the split is by TIME, not at random. The model is fitted on years 1-5 and
scored on year 6, which it never sees. A random split would leak the same
storm into both halves through the antecedent-rainfall features and inflate
every metric.

Run:  python3 train/train_forecast.py
Out:  src/model.js
"""

import json, math, os
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score, brier_score_loss, confusion_matrix, average_precision_score

RNG = np.random.default_rng(20260823)
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

YEARS = 6
DAYS = YEARS * 365
HORIZON = 7                      # predict an impact within the next 7 days

habs = json.load(open('/tmp/habs.json'))
N = len(habs)

# ----------------------------------------------------------------------------
# 1. Weather. One catchment, daily rainfall, monsoon-forced.
# ----------------------------------------------------------------------------
doy = np.arange(DAYS) % 365
# Indian monsoon: sharp onset early June (doy ~152), retreat late September.
season = np.exp(-0.5 * ((doy - 205) / 46.0) ** 2)          # broad JJAS peak
winter = 0.22 * np.exp(-0.5 * ((doy - 20) / 28.0) ** 2)    # western disturbances
wet_p = 0.06 + 0.62 * season + winter                       # P(rain on a day)
rains = (RNG.random(DAYS) < wet_p).astype(float)
# Wet-day depth: gamma, heavier inside the monsoon core.
depth = RNG.gamma(shape=0.9 + 1.4 * season, scale=9.0 + 26.0 * season)
rain = rains * depth                                        # mm/day, catchment mean

# Cloudbursts: rare, extreme, clustered in the monsoon core.
burst = (RNG.random(DAYS) < 0.0022 * (0.15 + season)) * RNG.gamma(3.0, 62.0)
rain = rain + burst

def ewma(x, k):
    out = np.zeros_like(x); acc = 0.0
    for i, v in enumerate(x):
        acc = k * acc + v
        out[i] = acc
    return out

api7 = ewma(rain, 0.80)     # fast store — surface runoff
api30 = ewma(rain, 0.955)   # slow store — soil moisture / groundwater

# ----------------------------------------------------------------------------
# 2. Hidden state the model never sees.
# ----------------------------------------------------------------------------
# A slope-stability reservoir per habitation: charges with rain, drains slowly,
# and once it passes a terrain-dependent yield point the slope can fail.
stability = np.zeros((DAYS, N))
store = np.zeros(N)
for t in range(DAYS):
    store = 0.965 * store + rain[t] * (0.4 + 0.6 * np.array([h['slide'] for h in habs]))
    stability[t] = store

# District-wide seismic shock days (Poisson), plus an aftershock tail.
shock = np.zeros(DAYS)
for t in range(DAYS):
    if RNG.random() < 0.0016:
        mag = RNG.uniform(4.4, 6.3)
        for d in range(0, 26):
            if t + d < DAYS:
                shock[t + d] = max(shock[t + d], mag * math.exp(-d / 7.0))

# Industrial: independent, very rare.
mah = (RNG.random(DAYS) < 0.00035).astype(float)

# ----------------------------------------------------------------------------
# 3. The truth process — per habitation, per day, did a hazard impact it?
# ----------------------------------------------------------------------------
elev = np.array([h['elev'] for h in habs], dtype=float)
elev_n = (elev - elev.min()) / (elev.max() - elev.min() + 1e-9)
slope = np.array([h['slope'] for h in habs], dtype=float)
slide = np.array([h['slide'] for h in habs], dtype=float)
d100 = np.array([h['depth'] for h in habs], dtype=float)
liq = np.array([h['liq'] for h in habs], dtype=float)
plume = np.array([h['plume'] for h in habs], dtype=float)
pga = np.array([h['pga'] for h in habs], dtype=float)
kutcha = np.array([h['kutcha'] for h in habs], dtype=float)
# Distance from the river line, from the map geometry (unit = 100 m).
xy = np.array([h['xy'] for h in habs], dtype=float)
river_t = np.linspace(0, 1, 240)
rx = 122 + (884 - 122) * river_t + 60 * np.sin(river_t * 2.6)
ry = 72 + (646 - 72) * river_t - 40 * np.sin(river_t * 2.1)
riv = np.array([np.min(np.hypot(xy[i, 0] - rx, xy[i, 1] - ry)) for i in range(N)])
riv_n = riv / riv.max()

def sig(z): return 1.0 / (1.0 + np.exp(-z))

event = np.zeros((DAYS, N), dtype=int)
kind = np.zeros((DAYS, N), dtype=int)     # 1 flood 2 slide 3 seis 4 mah
for t in range(DAYS):
    # Flood: fast store against how low and how close to the channel you are.
    p_fl = sig(0.0135 * api7[t] * (0.35 + d100 / 4.8) * (1.25 - riv_n) - 4.6 - 1.5 * elev_n)
    # Landslide: hidden stability reservoir past a terrain yield point.
    yield_pt = 210 + 340 * (1 - slide) + 5.5 * (45 - slope)
    p_sl = sig(0.020 * (stability[t] - yield_pt) - 2.1)
    # Seismic damage: shock magnitude against ground motion and building stock.
    p_se = sig(1.9 * shock[t] * (0.4 + pga) * (0.5 + kutcha) - 6.4) if shock[t] > 0 else np.zeros(N)
    # Industrial: only inside the plume envelope.
    p_ma = mah[t] * plume * 0.85
    draws = RNG.random((4, N))
    hit_fl, hit_sl, hit_se, hit_ma = draws[0] < p_fl, draws[1] < p_sl, draws[2] < p_se, draws[3] < p_ma
    any_hit = hit_fl | hit_sl | hit_se | hit_ma
    event[t] = any_hit.astype(int)
    kind[t] = np.where(hit_ma, 4, np.where(hit_se, 3, np.where(hit_sl, 2, np.where(hit_fl, 1, 0))))

# Label: does an impact occur in the NEXT `HORIZON` days?
label = np.zeros((DAYS, N), dtype=int)
for t in range(DAYS - HORIZON):
    label[t] = event[t + 1: t + 1 + HORIZON].max(axis=0)

# ----------------------------------------------------------------------------
# 4. Features — only what is knowable on day t.
# ----------------------------------------------------------------------------
FEATURES = [
    'api_7', 'api_30', 'rain_1', 'rain_3max', 'season',
    'slope', 'slide_susc', 'elev', 'depth_100yr', 'liquefaction',
    'plume', 'river_proximity', 'days_since_event', 'api7_x_depth', 'api7_x_slide',
]

rain1 = np.concatenate([[0.0], rain[:-1]])
rain3 = np.array([rain[max(0, t - 2):t + 1].max() for t in range(DAYS)])
seas = season

since = np.zeros((DAYS, N))
last = np.full(N, 999.0)
for t in range(DAYS):
    last = np.where(event[t] == 1, 0.0, last + 1.0)
    since[t] = np.minimum(last, 400.0)

rows, ys, tt = [], [], []
for t in range(30, DAYS - HORIZON):
    a7, a30 = api7[t], api30[t]
    for i in range(N):
        rows.append([
            a7, a30, rain1[t], rain3[t], seas[t],
            slope[i], slide[i], elev_n[i], d100[i], liq[i],
            plume[i], 1.0 - riv_n[i], since[t, i] / 400.0,
            (a7 / 100.0) * (d100[i] / 5.0), (a7 / 100.0) * slide[i],
        ])
        ys.append(label[t, i]); tt.append(t)

X = np.array(rows, dtype=float); y = np.array(ys); T = np.array(tt)

# ----------------------------------------------------------------------------
# 5. Time-based split. Years 1-5 fit, year 6 held out.
# ----------------------------------------------------------------------------
cut = 5 * 365
tr, te = T < cut, T >= cut
mu, sd = X[tr].mean(axis=0), X[tr].std(axis=0) + 1e-9
Z = (X - mu) / sd

# No class_weight here on purpose. Balanced weights would lift the ranking
# metric a little and destroy calibration: they shift every predicted
# probability away from the true base rate, so a "40%" would no longer mean
# 40%. This model's output is read as a probability on screen and is checked
# against a reliability curve, so calibration matters more than a decimal of AUC.
clf = LogisticRegression(C=0.6, max_iter=4000)
clf.fit(Z[tr], y[tr])
p_te = clf.predict_proba(Z[te])[:, 1]
p_tr = clf.predict_proba(Z[tr])[:, 1]

auc = roc_auc_score(y[te], p_te)
ap = average_precision_score(y[te], p_te)
brier = brier_score_loss(y[te], p_te)
base = y[te].mean()

THR = 0.50
tn, fp, fn, tp = confusion_matrix(y[te], (p_te >= THR).astype(int)).ravel()
prec = tp / (tp + fp) if tp + fp else 0.0
rec = tp / (tp + fn) if tp + fn else 0.0
f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0

# Reliability: predicted vs observed, held-out year only.
bins = np.linspace(0, 1, 11)
rel = []
idx = np.digitize(p_te, bins) - 1
for b in range(10):
    m = idx == b
    if m.sum() >= 25:
        rel.append({'bin': round(float((bins[b] + bins[b + 1]) / 2), 3),
                    'predicted': round(float(p_te[m].mean()), 4),
                    'observed': round(float(y[te][m].mean()), 4),
                    'n': int(m.sum())})

print(f'train rows {tr.sum():,}   test rows {te.sum():,}   base rate {base:.4f}')
print(f'AUC {auc:.4f}   PR-AUC {ap:.4f}   Brier {brier:.4f}   (train AUC {roc_auc_score(y[tr], p_tr):.4f})')
print(f'@{THR}: precision {prec:.3f}  recall {rec:.3f}  F1 {f1:.3f}   TP {tp} FP {fp} FN {fn} TN {tn}')

# ----------------------------------------------------------------------------
# 6. Recent weather window, so the browser can build features for "today".
# ----------------------------------------------------------------------------
# The window is anchored inside the monsoon, because that is the situation the
# district screens describe: a cloudburst, a rising river and an active slope.
# Ending it in December would have every habitation reading 5%, which would be
# truthful and useless at the same time.
#
# But it must not sit on the single wettest day either. On a rainfall peak the
# model saturates and twenty of twenty-four habitations read 99%, which is also
# useless — a board where everything is critical ranks nothing. So the window
# ends on a monsoon day at the 65th percentile of antecedent rainfall: clearly
# elevated, still discriminating.
tail = 60
monsoon = [i for i in range(tail + 1, DAYS - HORIZON) if 150 <= (i % 365) <= 260]
target = float(np.percentile(api7[monsoon], 65))
w_end = min(monsoon, key=lambda i: abs(api7[i] - target))
window = [round(float(v), 2) for v in rain[w_end - tail + 1: w_end + 1]]

payload = {
    '_warning': 'Trained on a SIMULATED six-year history for a fictional district. '
                'Not a forecast of any real place. See train/train_forecast.py.',
    'task': 'P(hazard impact on this habitation within the next 7 days)',
    'trained': '2026-08-23',
    'features': FEATURES,
    'mean': [round(float(v), 6) for v in mu],
    'scale': [round(float(v), 6) for v in sd],
    'coef': [round(float(v), 6) for v in clf.coef_[0]],
    # Observed standardised range in training. The browser flags extrapolation
    # against THIS, not against a fixed z-threshold: a monsoon day legitimately
    # sits at z=3.7 on antecedent rainfall, and the model saw plenty of those.
    # Flagging every monsoon day as "outside the fitted range" would be wrong
    # and would train the operator to ignore the flag.
    'zmin': [round(float(v), 4) for v in ((X[tr] - mu) / sd).min(axis=0)],
    'zmax': [round(float(v), 4) for v in ((X[tr] - mu) / sd).max(axis=0)],
    'intercept': round(float(clf.intercept_[0]), 6),
    'metrics': {
        'auc': round(float(auc), 4), 'pr_auc': round(float(ap), 4),
        'brier': round(float(brier), 4), 'base_rate': round(float(base), 4),
        'precision': round(float(prec), 3), 'recall': round(float(rec), 3), 'f1': round(float(f1), 3),
        'tp': int(tp), 'fp': int(fp), 'fn': int(fn), 'tn': int(tn), 'threshold': THR,
        'train_rows': int(tr.sum()), 'test_rows': int(te.sum()),
        'train_auc': round(float(roc_auc_score(y[tr], p_tr)), 4),
        'split': 'years 1-5 fit, year 6 held out (time-based, not random)',
    },
    'reliability': rel,
    # Per-habitation static covariates, exported so the browser cannot compute
    # them slightly differently from training. Order matches FEATURES[5:12].
    'static': {habs[i]['id']: [round(float(slope[i]), 4), round(float(slide[i]), 4),
                               round(float(elev_n[i]), 4), round(float(d100[i]), 4),
                               round(float(liq[i]), 4), round(float(plume[i]), 4),
                               round(float(1.0 - riv_n[i]), 4)] for i in range(N)},
    # Observed base rate per habitation over the held-out year, for reference.
    'observed': {habs[i]['id']: round(float(label[cut:DAYS - HORIZON, i].mean()), 4) for i in range(N)},
    'weather': {'window_days': tail, 'rain_mm': window,
                'doy': int(w_end % 365),
                'season': 'monsoon (day-of-year %d, antecedent rainfall at the 65th percentile of the season)' % (w_end % 365),
                'api7': round(float(api7[w_end]), 1),
                'note': 'Simulated catchment rainfall. Real deployment replaces this with a gauge feed.'},
}

js = ('/* AapdaSync — model.js  (GENERATED by train/train_forecast.py — do not hand-edit)\n'
      '   Logistic regression, 15 features, fitted on a simulated six-year history.\n'
      '   Split is by TIME: years 1-5 fit, year 6 held out. A random split would leak\n'
      '   the same storm into both halves through the antecedent-rainfall terms. */\n'
      "'use strict';\nvar MODEL = " + json.dumps(payload, indent=1) + ';\n')
open(os.path.join(ROOT, 'src', 'model.js'), 'w').write(js)
print('wrote src/model.js  (%d bytes)' % len(js))
