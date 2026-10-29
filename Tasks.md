# Task List: Implementation Roadmap

- [x] **Task 1: Core Architecture & SGT Timezone Helper**
  - [x] Setup project structure with Eastside FC dark styling. — `index.html`, `styles.css`, `js/` modules
  - [x] Implement `getSingaporeTimestamp()` for automatic SGT timestamps. — `js/store.js`

- [x] **Task 2: Build Complete Athlete Input Form**
  - [x] Body Mass & Hydration inputs (Pre/Post Weight in kg, Thirst scale 1–10).
  - [x] Goniometric ROM & Pain inputs (Joint tested, Measured degrees °, NPRS 0–10, Location).
  - [x] Training Load & Intensity inputs (sRPE 1–10, Intensity Level dropdown, Duration in mins).
  - [x] Sleep inputs (Duration in hours, Quality scale 1–10, tier).
  - [x] Nutrition inputs (Pre/Post/Main meal text, fueling checkbox, quality tags).

- [x] **Task 3: Build Visual Analytics & Nutrition Feed**
  - [x] Line charts for Goniometric ROM progress and Pain trends (ROM chart, pain/sRPE overlay).
  - [x] Sleep vs. Readiness correlation chart (duration × quality, coloured by readiness).
  - [x] Nutrition Log timeline feed displaying meal logs alongside training sessions.

- [x] **Task 4: Build Automated Notification & Alert System**
  - [x] Evaluator for Pain spikes (≥2 pts), ROM drops (<60%), Sleep debt (<5–6 hrs), missing pre-workout fueling. — `js/alerts.js`
  - [x] Alert badges + banners across Athlete (readiness banner) and Coach (alerts pane + badges) views.

- [x] **Task 5: Build Coach Overview Dashboard**
  - [x] Grid tables displaying all metrics (Pain, ROM, sRPE Load, Sleep, Nutrition Summary) with SGT timestamps.
  - [x] Status filters (All, Cleared, Modified, Restricted) on the roster.
  - [x] Coach override controls (Clear / Modify / Restrict / Reset-to-auto, with note + SGT timestamp).
