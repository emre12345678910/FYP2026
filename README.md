# Eastside FC — Rehab & Return-to-Play Monitor

A practical physiological monitoring and Return-to-Play (RTP) dashboard for Eastside Fight Club.
**Zero dependencies, zero build step** — just open `index.html` in a browser. Data persists in the
browser's `localStorage` and every check-in is auto-timestamped in **Singapore Time (`Asia/Singapore`, UTC+8)**.

## Run it

Because the app uses ES modules, open it via a local web server (opening the file directly with
`file://` can block module loading in some browsers):

```bash
# from this folder
python3 -m http.server 8000
# then visit http://localhost:8000
```

Any static server works. No internet connection or packages are required.

## What it tracks

| Metric | Fields |
|---|---|
| **Body Mass** | Pre- / post-session weight (kg) |
| **Hydration** | Acute body-mass shift (%), subjective thirst (1–10) |
| **Training Load** | sRPE (1–10), intensity index (Technique / Conditioning / Sparring / Max Load), duration → **Total Workload = sRPE × min** |
| **Pain & Injury** | NPRS (0–10) + body-area/symptom note |
| **Range of Motion** | Goniometric joint angle (°) mapped to **% of athlete baseline** |
| **Sleep** | Duration (hrs), quality (1–10), tier (Poor / Average / Restorative) |
| **Nutrition** | Pre/Post/Main meal logs, macro tags, "ate 2–3 h before training?" fueling flag |

## Dashboards

- **Athlete Check-in** — one form covering all metrics; recent check-ins table with live derived values.
- **Coach Dashboard** — roster with status tiers + alert badges, and per-athlete:
  - **ROM progression** line chart vs 100% baseline (with 60% alert line)
  - **Pain & intensity overlay** (sRPE bars + pain NPRS line)
  - **Hydration & weight-loss** pre/post bars
  - **Sleep vs recovery matrix** (duration × quality, coloured by readiness)
  - **Nutrition & fueling overview** (workload bars marked fueled ✓ / under-fueled ✕)
  - Full food log and raw-metrics tables

## Automated alerts

| Alert | Trigger |
|---|---|
| 🔴 Hydration | Acute session weight loss **> 2.0%** |
| 🔴 ROM | ROM **< 60%** of baseline |
| 🔴 Pain spike | Pain rises **≥ 2** points vs previous check-in |
| 🟡 Sleep deprivation | Sleep **< 6 h** |
| 🔴 Severe sleep | **< 5 h** on **2 consecutive days** |
| 🟡 Under-fueling | High-intensity session (Sparring / Max Load / Conditioning) without a timely pre-workout meal |

## Status tiers

Derived from the worst active alert: 🟢 **Cleared** · 🟡 **Modified** · 🔴 **Restricted**.

## Project layout

```
index.html        # shell
styles.css        # dark fight-club theme
js/store.js       # persistence, SGT timestamping, derived-metric math
js/alerts.js      # alert engine + RTP status tiers
js/charts.js      # tiny hand-rolled SVG charts (no chart library)
js/app.js         # UI controller + views
```
