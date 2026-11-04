# Data boundaries — Physiological vs Psychological

These rules define a hard boundary between the two data domains in this project.
Kiro must follow them in all future work on this repo.

## The rule

- **The physiological side must never create, edit, update, or delete psychological data.**
  Physiological logging (Daily log, Training log — body mass, blood pressure,
  sleep, hydration, nutrition, training load, pain/injury, ROM, sweat rate) and
  any physiological code path must not write to the psychological store.

- **Psychological data (the Mental log: RESTQ, POMS, TSCI, SMS-II) is entered
  ONLY via the Mental log in the Input app**, and is **read-only everywhere else**
  — including the entire Coach Dashboard (Physiological tab, Psychological tab,
  and Weekly Trends). The dashboard displays psychological results; it never
  edits them.

- The reverse also holds: psychological code paths must not write physiological
  check-in data.

## Where each domain lives (for reference)

- Physiological records → check-ins store (`eastside_fc_checkins_v1`), written by
  `saveCheckin()` in `js/store.js`. Produced by the **Daily** and **Training**
  logs in `js/input.js`.
- Psychological records → mental-log store (`eastside_fc_mental_v1`), written by
  `saveMentalLog()` in `js/store.js`. Produced ONLY by the **Mental** log in
  `js/input.js`.

## What this means in practice for Kiro

- Do **not** add code that lets a physiological form/control call
  `saveMentalLog()` / `deleteMentalLog()` or otherwise mutate the mental-log
  store, and do not let psychological forms call `saveCheckin()` /
  `deleteCheckin()`.
- Keep the Coach Dashboard strictly **read-only** for psychological data: render
  and chart it, but never add edit/delete affordances for mental-log responses
  there.
- If a future feature appears to require crossing this boundary, stop and ask
  the user before implementing it.
