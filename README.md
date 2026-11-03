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

### Option A — shared prototype over your local network (recommended)

The bundled **zero-dependency Node server** serves the pages **and** a shared data
store, so the input app and the coach dashboard see the **same data across devices**
on the same Wi-Fi — no manual export/import.

```bash
# from the project root (needs Node.js installed)
node server/server.js
```

It prints the addresses to open, e.g.:

```
On this machine:   http://localhost:8080/
On your network:   http://192.168.1.42:8080/   ← open this on your friend's device
```

- **Coach dashboard:** `http://<address>:8080/` (or `/index.html`)
- **Athlete input:**   `http://<address>:8080/input.html`

Shared data is saved to `server/data.json` (survives restarts; git-ignored).
The backend auto-detects: open the pages **through this server** and sharing turns on
automatically; open them any other way and each browser just uses its own local data.

> Prototype only — no auth/TLS. Fine for a trusted local network or demo.

### Option B — static, browser-only (e.g. GitHub Pages)

```bash
python3 -m http.server 8000
# Dashboard: http://localhost:8000/index.html
# Input:     http://localhost:8000/input.html
```

Any static server works. Here each browser stores its **own** data in `localStorage`
(not shared); use **⬇ Export / ⬆ Import** to move data between devices.

### Switching backends (local → Firebase later)

All networking lives in **`js/api.js`** behind one `CONFIG` block. To move to a hosted
database later (e.g. Firebase) so it works beyond the local network, set
`CONFIG.BACKEND = 'firebase'`, fill in `CONFIG.FIREBASE`, and implement the two marked
functions at the bottom of that file. **No other file needs to change.**

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
js/api.js         # swappable backend adapter (local / server / firebase) — change here only
js/store.js       # persistence (incl. mental logs), SGT timestamping, derived-metric math
js/alerts.js      # physiological alert engine + RTP status tiers
js/charts.js      # tiny hand-rolled SVG charts (physio + psych), no chart library
js/psych.js       # questionnaire definitions (RESTQ/POMS/TSCI/SMS-6) + scoring
js/input.js       # Athlete Input controller (Daily / Training / Mental logs)
js/dashboard.js   # Coach Dashboard controller (Physiological + Psychological tabs)
server/server.js  # zero-dependency Node server: static files + shared data API
```
