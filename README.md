# Eastside FC — Rehab & Return-to-Play Monitor

A physiological **and** psychological monitoring and Return-to-Play (RTP) system for Eastside Fight Club.
**Zero dependencies, zero build step.** Data persists in the browser's `localStorage` and every entry is
auto-timestamped in **Singapore Time (`Asia/Singapore`, UTC+8)**.

## Two apps, one data store

The project is split into **two pages** that share the same code and `localStorage`:

| Page | Who | Purpose |
|---|---|---|
| **`input.html`** | Athletes | **Input app** — three logs: **Daily**, **Training**, **Mental** |
| **`index.html`** | Coach | **Dashboard** (read-only / output only) — **Physiological** tab (sub-tabs *Daily* / *Training*) + **Psychological** tab |

The input app writes; the dashboard reads. Because they share the same browser origin + `localStorage`,
data entered on a device shows up on that device's dashboard automatically. To move data between devices,
use **⬇ Export / ⬆ Import** (true cross-device sync would need a backend).

## Run it

Because the apps use ES modules, serve them over a local web server (not `file://`):

```bash
# from this folder
python3 -m http.server 8000
# Dashboard (coach):      http://localhost:8000/index.html
# Input app (athletes):   http://localhost:8000/input.html
```

Any static server works. No internet connection or packages are required.

## Psychological monitoring (Mental log)

The Mental log captures four aspects, each via a validated sport-psychology instrument. The dashboard
scores every submission and charts the results on the coach's **Psychological** tab:

| Aspect | Instrument | Dashboard output |
|---|---|---|
| **Stress** | **RESTQ-Sport** (Recovery–Stress Questionnaire) | Scale profile chart (stress vs recovery) + stress/recovery trend |
| **Mood** | **POMS** (Profile of Mood States) | Mood profile + Total Mood Disturbance (TMD) trend |
| **Confidence** | **Vealey's TSCI** (Trait Sport-Confidence Inventory) | Confidence (1–9) trend |
| **Motivation** | **SMS-6** (Sport Motivation Scale) | Subscale profile + Relative Autonomy Index trend |

> ⚠️ **Licensing:** RESTQ-Sport, POMS and SMS are copyrighted instruments. This repo ships **representative
> placeholder item wording** with the correct subscale structure, response scales and scoring. **Replace the
> item text in `js/psych.js` with the official licensed wording before any real-world or research use.**

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
index.html        # Coach Dashboard shell (read-only)
input.html        # Athlete Input app shell
styles.css        # dark fight-club theme
js/store.js       # persistence (incl. mental logs), SGT timestamping, derived-metric math
js/alerts.js      # physiological alert engine + RTP status tiers
js/charts.js      # tiny hand-rolled SVG charts (physio + psych), no chart library
js/psych.js       # questionnaire definitions (RESTQ/POMS/TSCI/SMS-6) + scoring
js/input.js       # Athlete Input controller (Daily / Training / Mental logs)
js/dashboard.js   # Coach Dashboard controller (Physiological + Psychological tabs)
```
