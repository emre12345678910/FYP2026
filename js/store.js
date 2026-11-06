// store.js — persistence + Singapore Time + core domain logic
// Zero dependencies. Data persists in localStorage.

import { CONFIG, pushKey, pushAll, pullState, startSync, isShared, resolveBackend, activeBackend, KEYS } from './api.js?v=12';

export const SGT = 'Asia/Singapore';
const STORAGE_KEY = 'eastside_fc_checkins_v1';
const ATHLETE_KEY = 'eastside_fc_athletes_v1';
const MENTAL_KEY = 'eastside_fc_mental_v1';

// Re-export sync helpers so controllers can wire up live updates.
export { pushAll, pullState, startSync, isShared, resolveBackend, activeBackend, CONFIG as API_CONFIG };

// --- Backend write-through ---------------------------------------------------
// Every store write goes through localStorage (the synchronous cache the UI
// reads). When a shared backend is active, `persist()` also pushes that key up
// to the server in the background, so the other app/device sees it. Switching
// backends is done entirely in js/api.js — nothing here changes.
const SYNC_KEYS = new Set(Object.values(KEYS));
function persist(key, value) {
  localStorage.setItem(key, value);
  if (isShared() && SYNC_KEYS.has(key)) {
    // fire-and-forget; offline just keeps the local cache
    pushKey(key).catch(() => {});
  }
}

/* ----------------------------- Singapore Time ---------------------------- */

// Returns an ISO-like timestamp anchored to Asia/Singapore (UTC+8) with offset.
export function sgtNow() {
  return sgtFromDate(new Date());
}

// Named per the roadmap. Returns the SGT ISO string for "now".
export function getSingaporeTimestamp() {
  return sgtNow().sgt;
}

export function sgtFromDate(date) {
  // Build the wall-clock parts in SGT.
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: SGT,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(date).reduce((acc, p) => (acc[p.type] = p.value, acc), {});
  const wall = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
  return {
    // Canonical UTC instant for sorting / math.
    utc: date.toISOString(),
    // Human SGT wall clock.
    sgt: `${wall}+08:00`,
    date: `${parts.year}-${parts.month}-${parts.day}`, // SGT calendar day
    label: `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute} SGT`,
  };
}

export function formatSgt(utcIso) {
  return sgtFromDate(new Date(utcIso)).label;
}

export function sgtDay(utcIso) {
  return sgtFromDate(new Date(utcIso)).date;
}

// ISO week key for an instant, anchored to the SGT calendar day.
// Returns { key: 'YYYY-Www', label: 'Www YYYY', start: 'YYYY-MM-DD' (Mon) }.
// Used to group mental-log submissions into weeks for trend charts.
export function sgtWeek(utcIso) {
  const day = sgtDay(utcIso);                // 'YYYY-MM-DD' in SGT
  const d = new Date(day + 'T00:00:00Z');    // treat SGT calendar day as a plain date
  // ISO week: Thursday-based. Day-of-week Mon=1..Sun=7.
  const dow = (d.getUTCDay() + 6) % 7;       // 0=Mon..6=Sun
  const thursday = new Date(d);
  thursday.setUTCDate(d.getUTCDate() - dow + 3);
  const isoYear = thursday.getUTCFullYear();
  const jan1 = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.floor((thursday - jan1) / 86400000 / 7) + 1;
  // Monday that starts this week (for a readable range label).
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - dow);
  const mk = (x) => `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}`;
  return {
    key: `${isoYear}-W${String(week).padStart(2, '0')}`,
    label: `W${week}`,
    start: mk(monday),
  };
}

/* ------------------------------- Athletes -------------------------------- */

// Default daily hydration goal (ml) used to fill the hydration bar.
export const DEFAULT_HYDRATION_GOAL_ML = 3000;
export const DEFAULT_BOTTLE_ML = 750;

export function getAthletes() {
  const raw = localStorage.getItem(ATHLETE_KEY);
  if (raw) return JSON.parse(raw);
  const seed = [
    { id: 'a1', name: 'Marcus Tan', gender: 'Male', combatType: 'Boxing', avatar: 'boxer', romBaseline: 135, currentWeight: 72.5, age: 24, bottleMl: 750, hydrationGoalMl: 3000 },
    { id: 'a2', name: 'Priya Nair', gender: 'Female', combatType: 'Muay Thai', avatar: 'muaythai', romBaseline: 140, currentWeight: 61.0, age: 27, bottleMl: 600, hydrationGoalMl: 2500 },
    { id: 'a3', name: 'Devon Lee', gender: 'Male', combatType: 'Muay Thai', avatar: 'boxer', romBaseline: 130, currentWeight: 80.3, age: 22, bottleMl: 1000, hydrationGoalMl: 3500 },
  ];
  persist(ATHLETE_KEY, JSON.stringify(seed));
  return seed;
}

export function addAthlete({ name, gender, combatType, romBaseline, currentWeight, age, bottleMl }) {
  const athletes = getAthletes();
  const athlete = {
    id: 'a' + Date.now() + Math.floor(Math.random() * 100000),
    name: String(name).trim(),
    gender: gender || null,
    combatType: combatType || null,
    avatar: 'boxer', // default built-in avatar; editable via the profile panel
    romBaseline: Number(romBaseline) || 135,
    currentWeight: currentWeight != null && currentWeight !== '' ? Number(currentWeight) : null,
    age: age != null && age !== '' ? Number(age) : null,
    bottleMl: Number(bottleMl) || DEFAULT_BOTTLE_ML,
    hydrationGoalMl: DEFAULT_HYDRATION_GOAL_ML,
  };
  athletes.push(athlete);
  persist(ATHLETE_KEY, JSON.stringify(athletes));
  return athlete;
}

// Patch mutable profile fields on an athlete (e.g. bottle capacity, weight).
export function updateAthlete(id, patch) {
  const athletes = getAthletes();
  const a = athletes.find((x) => x.id === id);
  if (!a) return null;
  Object.assign(a, patch);
  persist(ATHLETE_KEY, JSON.stringify(athletes));
  return a;
}

/* ------------------------------- Check-ins ------------------------------- */

export function getCheckins() {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

// Accepts raw form inputs + the athlete (for ROM baseline) and persists a record
// matching the design-document schema. `workload` and `rom_percentage` are
// calculated and stored on the record; `timestamp` is an SGT ISO string.
export function saveCheckin(input, athlete) {
  const checkins = getCheckins();
  const ts = sgtNow();
  const baseline = athlete ? athlete.romBaseline : null;

  const rom_percentage = input.goniometer_degrees != null
    ? round(romPct(input.goniometer_degrees, baseline), 0) : null;
  const workload = totalWorkload(input.srpe, input.duration_mins);
  // Sweat rate uses today's logged water intake as fluids consumed.
  const fluidsMl = input.athleteId ? getHydrationToday(input.athleteId).ml : 0;
  const sweat_rate_lph = sweatRateLph(input.pre_weight_kg, input.post_weight_kg, input.duration_mins, fluidsMl);

  const entry = {
    id: 'log_' + Date.now() + Math.floor(Math.random() * 1000),
    timestamp: ts.sgt,          // SGT ISO string (design schema)
    timestampUtc: ts.utc,       // canonical UTC instant for sorting/charts
    sgtDay: ts.date,            // SGT calendar day for grouping
    athleteId: input.athleteId,

    // Body Mass (single recording, timestamped via `timestamp`/`timestampSgt`)
    body_mass_kg: input.body_mass_kg ?? null,

    // Vitals — Blood Pressure (mmHg), timestamped via the record's `timestamp`
    bp_systolic: input.bp_systolic ?? null,
    bp_diastolic: input.bp_diastolic ?? null,
    bp_timing: input.bp_timing || null, // 'Before training' | 'After training'

    // ROM & Pain
    joint_tested: input.joint_tested || null,
    goniometer_degrees: input.goniometer_degrees ?? null,
    rom_percentage,
    pain_score: input.pain_score ?? null,
    pain_location: input.pain_location || null,
    pain_symptoms: input.pain_symptoms || [],
    pain_description: input.pain_description || null,
    pain_actions: input.pain_actions || null,
    pain_period: input.pain_period || null,

    // Load & Intensity (pre/post weigh-in + derived sweat rate live here now)
    srpe: input.srpe ?? null,
    intensity_level: input.intensity_level || null,
    duration_mins: input.duration_mins ?? null,
    workload,
    pre_weight_kg: input.pre_weight_kg ?? null,
    post_weight_kg: input.post_weight_kg ?? null,
    sweat_rate_lph,

    // Sleep
    sleep_type: input.sleep_type || null, // 'Overnight' | 'Nap'
    sleep_hours: input.sleep_hours ?? null,
    sleep_minutes: input.sleep_minutes ?? null,
    sleep_start: input.sleep_start || null,
    sleep_end: input.sleep_end || null,

    // Nutrition Log
    nutrition_log: {
      pre_workout_meal: input.nutrition_log?.pre_workout_meal || '',
      post_workout_meal: input.nutrition_log?.post_workout_meal || '',
      main_meal: input.nutrition_log?.main_meal || '',
      quality_tags: input.nutrition_log?.quality_tags || [],
      fueled_before_session: input.nutrition_log?.fueled_before_session === true,
    },
  };
  checkins.push(entry);
  persist(STORAGE_KEY, JSON.stringify(checkins));
  return entry;
}

function round(v, dp) {
  if (v == null) return null;
  const f = Math.pow(10, dp);
  return Math.round(v * f) / f;
}

export function deleteCheckin(id) {
  const checkins = getCheckins().filter((c) => c.id !== id);
  persist(STORAGE_KEY, JSON.stringify(checkins));
}

/* --------------------------- Mental logs -------------------------------- */
// Psychological questionnaire submissions (RESTQ / POMS / TSCI / SMS-II).
// Each record stores the raw per-item responses; scoring is derived in psych.js.

export function getMentalLogs() {
  const raw = localStorage.getItem(MENTAL_KEY);
  return raw ? JSON.parse(raw) : [];
}

// Persists a mental-log submission. `responses` is keyed by questionnaire:
//   { restq: { <itemId>: 0-6, ... }, poms: {...}, tsci: {...}, sms: {...} }
export function saveMentalLog(input) {
  const logs = getMentalLogs();
  const ts = sgtNow();
  const entry = {
    id: 'mlog_' + Date.now() + Math.floor(Math.random() * 1000),
    timestamp: ts.sgt,
    timestampUtc: ts.utc,
    sgtDay: ts.date,
    athleteId: input.athleteId,
    responses: input.responses || {},
  };
  logs.push(entry);
  persist(MENTAL_KEY, JSON.stringify(logs));
  return entry;
}

export function deleteMentalLog(id) {
  persist(MENTAL_KEY, JSON.stringify(getMentalLogs().filter((m) => m.id !== id)));
}

export function mentalLogsForAthlete(athleteId) {
  return getMentalLogs()
    .filter((m) => m.athleteId === athleteId)
    .sort((a, b) => new Date(a.timestampUtc) - new Date(b.timestampUtc));
}

/* ------------------------- Coach status overrides ------------------------ */
// A coach can manually override an athlete's auto-computed readiness tier.
// Stored per athlete: { tier: 'Cleared'|'Modified'|'Restricted'|null, note, by }
const OVERRIDE_KEY = 'eastside_fc_overrides_v1';

export function getOverrides() {
  const raw = localStorage.getItem(OVERRIDE_KEY);
  return raw ? JSON.parse(raw) : {};
}

export function getOverride(athleteId) {
  return getOverrides()[athleteId] || null;
}

export function setOverride(athleteId, tier, note) {
  const all = getOverrides();
  if (!tier) {
    delete all[athleteId]; // clear override -> revert to auto
  } else {
    all[athleteId] = { tier, note: note || '', setAt: getSingaporeTimestamp() };
  }
  persist(OVERRIDE_KEY, JSON.stringify(all));
}

export function checkinsForAthlete(athleteId) {
  return getCheckins()
    .filter((c) => c.athleteId === athleteId)
    .sort((a, b) => new Date(a.timestampUtc) - new Date(b.timestampUtc));
}

// Most-recent body-mass recording for an athlete (used to show "previous
// weight" and compute the change vs the one being entered). Returns kg or null.
export function lastBodyMass(athleteId) {
  const withMass = checkinsForAthlete(athleteId).filter((c) => c.body_mass_kg != null);
  return withMass.length ? withMass[withMass.length - 1].body_mass_kg : null;
}

/* --------------------------- Hydration tracking -------------------------- */
// Daily water intake, keyed by athleteId + SGT day. Stores ml drunk + the
// number of bottle taps, so the bar can show both volume and count.
const HYDRATION_KEY = 'eastside_fc_hydration_v1';

function getHydrationStore() {
  const raw = localStorage.getItem(HYDRATION_KEY);
  return raw ? JSON.parse(raw) : {};
}

// Total ml drunk by an athlete on a given SGT calendar day (YYYY-MM-DD).
export function hydrationMlForDay(athleteId, sgtDayKey) {
  const rec = getHydrationStore()[`${athleteId}|${sgtDayKey}`];
  return rec ? (rec.ml || 0) : 0;
}

// Normalises a stored record to the current shape ({ ml, taps, entries[] }),
// tolerating older records that only had { ml, taps }.
function normHydration(rec) {
  if (!rec) return { ml: 0, taps: 0, entries: [] };
  return { ml: rec.ml || 0, taps: rec.taps || 0, entries: rec.entries || [] };
}

// Returns today's (SGT) hydration record for an athlete:
// { ml, taps, entries: [{ ml, sgt, utc, label }] }.
export function getHydrationToday(athleteId) {
  const day = sgtNow().date;
  const store = getHydrationStore();
  return normHydration(store[`${athleteId}|${day}`]);
}

// Adds one bottle (bottleMl) to today's intake, timestamping the tap (SGT).
export function addBottle(athleteId, bottleMl) {
  const ts = sgtNow();
  const store = getHydrationStore();
  const key = `${athleteId}|${ts.date}`;
  const rec = normHydration(store[key]);
  const ml = Number(bottleMl) || 0;
  rec.ml += ml;
  rec.taps += 1;
  rec.entries.push({ ml, sgt: ts.sgt, utc: ts.utc, label: ts.label });
  store[key] = rec;
  persist(HYDRATION_KEY, JSON.stringify(store));
  return { ...rec };
}

// Removes the most recent bottle for today (undo an accidental tap).
export function removeBottle(athleteId) {
  const day = sgtNow().date;
  const store = getHydrationStore();
  const key = `${athleteId}|${day}`;
  const rec = normHydration(store[key]);
  if (rec.entries.length) {
    const last = rec.entries.pop();
    rec.ml = Math.max(0, rec.ml - (last.ml || 0));
    rec.taps = Math.max(0, rec.taps - 1);
  }
  store[key] = rec;
  persist(HYDRATION_KEY, JSON.stringify(store));
  return { ...rec };
}

// Daily hydration goal (ml) for an athlete:
//   baseline  = 30–40 ml per kg of body weight  (we use the midpoint, 35)
//   exercise  = 500–1000 ml per hour trained     (we use the midpoint, 750)
// `exerciseMinutes` is today's total training time (sum of duration_mins).
// Returns a breakdown so the UI can explain the number.
export function hydrationGoalMl(athlete, exerciseMinutes = 0) {
  const ML_PER_KG = 35;        // midpoint of 30–40
  const ML_PER_EX_HOUR = 750;  // midpoint of 500–1000
  const weight = athlete && athlete.currentWeight ? Number(athlete.currentWeight) : null;
  const baseline = weight ? Math.round(weight * ML_PER_KG) : (athlete && athlete.hydrationGoalMl) || DEFAULT_HYDRATION_GOAL_ML;
  const exerciseHours = (Number(exerciseMinutes) || 0) / 60;
  const exercise = Math.round(exerciseHours * ML_PER_EX_HOUR);
  return { total: baseline + exercise, baseline, exercise, exerciseHours, weight };
}

// Sum of today's (SGT) training minutes across an athlete's check-ins.
export function exerciseMinutesToday(athleteId) {
  const day = sgtNow().date;
  return getCheckins()
    .filter((c) => c.athleteId === athleteId && (c.sgtDay || sgtDay(c.timestampUtc)) === day)
    .reduce((sum, c) => sum + (Number(c.duration_mins) || 0), 0);
}

// Deletes an athlete and all of their associated data: check-ins, coach
// override, and hydration records. Returns true if the athlete existed.
export function deleteAthlete(id) {
  const athletes = getAthletes();
  if (!athletes.some((a) => a.id === id)) return false;

  // Remove the athlete.
  persist(ATHLETE_KEY, JSON.stringify(athletes.filter((a) => a.id !== id)));

  // Remove their check-ins.
  persist(STORAGE_KEY, JSON.stringify(getCheckins().filter((c) => c.athleteId !== id)));

  // Remove their mental logs.
  persist(MENTAL_KEY, JSON.stringify(getMentalLogs().filter((m) => m.athleteId !== id)));

  // Remove their coach override.
  const overrides = getOverrides();
  if (overrides[id]) { delete overrides[id]; persist(OVERRIDE_KEY, JSON.stringify(overrides)); }

  // Remove their hydration records (keys are "athleteId|SGTday").
  const hyd = getHydrationStore();
  let changed = false;
  for (const key of Object.keys(hyd)) {
    if (key.startsWith(id + '|')) { delete hyd[key]; changed = true; }
  }
  if (changed) persist(HYDRATION_KEY, JSON.stringify(hyd));

  return true;
}

/* --------------------------- Export / Import ----------------------------- */
// NOTE: all data lives in this browser's localStorage, which is per-device and
// never leaves the machine. To move data to another device, Export here and
// Import the file there. (A true cross-device sync would require a backend.)

const EXPORT_VERSION = 1;

// Bundles every data store into a single portable object.
export function exportData() {
  return {
    app: 'eastside-fc',
    version: EXPORT_VERSION,
    exportedAt: sgtNow().sgt,
    data: {
      [ATHLETE_KEY]: getAthletes(),
      [STORAGE_KEY]: getCheckins(),
      [MENTAL_KEY]: getMentalLogs(),
      [OVERRIDE_KEY]: getOverrides(),
      [HYDRATION_KEY]: getHydrationStore(),
    },
  };
}

// Imports a previously exported bundle.
//   mode 'replace' — overwrite all local data with the file's data.
//   mode 'merge'   — keep local data, add athletes/check-ins/hydration from the
//                    file that aren't already present (by id / key).
// Returns a summary of what was imported.
export function importData(bundle, mode = 'replace') {
  if (!bundle || bundle.app !== 'eastside-fc' || !bundle.data) {
    throw new Error('Not a valid Eastside FC export file.');
  }
  const d = bundle.data;
  const incomingAthletes = d[ATHLETE_KEY] || [];
  const incomingCheckins = d[STORAGE_KEY] || [];
  const incomingMental = d[MENTAL_KEY] || [];
  const incomingOverrides = d[OVERRIDE_KEY] || {};
  const incomingHydration = d[HYDRATION_KEY] || {};

  if (mode === 'replace') {
    persist(ATHLETE_KEY, JSON.stringify(incomingAthletes));
    persist(STORAGE_KEY, JSON.stringify(incomingCheckins));
    persist(MENTAL_KEY, JSON.stringify(incomingMental));
    persist(OVERRIDE_KEY, JSON.stringify(incomingOverrides));
    persist(HYDRATION_KEY, JSON.stringify(incomingHydration));
    return { mode, athletes: incomingAthletes.length, checkins: incomingCheckins.length };
  }

  // merge
  const athletes = getAthletes();
  const athleteIds = new Set(athletes.map((a) => a.id));
  let addedAthletes = 0;
  for (const a of incomingAthletes) if (!athleteIds.has(a.id)) { athletes.push(a); athleteIds.add(a.id); addedAthletes++; }
  persist(ATHLETE_KEY, JSON.stringify(athletes));

  const checkins = getCheckins();
  const checkinIds = new Set(checkins.map((c) => c.id));
  let addedCheckins = 0;
  for (const c of incomingCheckins) if (!checkinIds.has(c.id)) { checkins.push(c); checkinIds.add(c.id); addedCheckins++; }
  persist(STORAGE_KEY, JSON.stringify(checkins));

  const mental = getMentalLogs();
  const mentalIds = new Set(mental.map((m) => m.id));
  for (const m of incomingMental) if (!mentalIds.has(m.id)) { mental.push(m); mentalIds.add(m.id); }
  persist(MENTAL_KEY, JSON.stringify(mental));

  const overrides = getOverrides();
  for (const [id, ov] of Object.entries(incomingOverrides)) if (!overrides[id]) overrides[id] = ov;
  persist(OVERRIDE_KEY, JSON.stringify(overrides));

  const hyd = getHydrationStore();
  for (const [k, v] of Object.entries(incomingHydration)) if (!hyd[k]) hyd[k] = v;
  persist(HYDRATION_KEY, JSON.stringify(hyd));

  return { mode, athletes: addedAthletes, checkins: addedCheckins };
}

/* ----------------------------- Derived metrics --------------------------- */

// Acute body-mass shift (%) = (pre - post) / pre * 100. Positive = fluid loss.
export function fluidLossPct(pre, post) {
  if (!pre || !post) return null;
  return ((pre - post) / pre) * 100;
}

// Total internal workload = sRPE x duration(min).
export function totalWorkload(srpe, durationMin) {
  if (srpe == null || durationMin == null) return null;
  return srpe * durationMin;
}

// Sweat rate (litres per hour) for a session:
//   (pre_kg - post_kg + fluids_litres) / duration_hours
// 1 kg body-mass loss ≈ 1 L sweat. Adding fluids drunk during the session
// gives true sweat loss. Returns L/h rounded to 2 dp, or null if not derivable.
export function sweatRateLph(preKg, postKg, durationMin, fluidsMl = 0) {
  if (preKg == null || postKg == null || !durationMin) return null;
  const litresLost = (preKg - postKg) + ((Number(fluidsMl) || 0) / 1000);
  const hours = durationMin / 60;
  if (hours <= 0) return null;
  return Math.round((litresLost / hours) * 100) / 100;
}

// Classifies a blood-pressure reading (mmHg) using the reference categories:
//   Normal            : systolic < 120   and diastolic < 80
//   High-Normal        : systolic 130–139 or  diastolic 85–89   (borderline)
//   Hypertension St.1 : systolic 140–159 or  diastolic 90–99
//   Hypertension St.2 : systolic ≥ 160   or  diastolic ≥ 100
// Returns { label, cls } where cls is green | yellow | red for colouring.
export function bpCategory(systolic, diastolic) {
  const s = Number(systolic), d = Number(diastolic);
  if (!s || !d) return null;
  if (s >= 160 || d >= 100) return { label: 'Hypertension Stage 2', cls: 'red' };
  if ((s >= 140 && s <= 159) || (d >= 90 && d <= 99)) return { label: 'Hypertension Stage 1', cls: 'red' };
  if ((s >= 130 && s <= 139) || (d >= 85 && d <= 89)) return { label: 'High-Normal (Borderline)', cls: 'yellow' };
  if (s < 120 && d < 80) return { label: 'Normal', cls: 'green' };
  // Between the table's bands (e.g. 120–129 systolic): treat as Normal-ish.
  return { label: 'Normal', cls: 'green' };
}

// Hours between a "slept at" and "woke at" time (HH:MM strings). Handles the
// overnight case (wake time earlier than sleep time rolls to the next day).
export function sleepHoursBetween(startHHMM, endHHMM) {
  const mins = sleepMinutesBetween(startHHMM, endHHMM);
  if (mins == null) return null;
  return Math.round((mins / 60) * 10) / 10; // 1 decimal
}

// Total minutes slept between two HH:MM times (overnight-aware).
export function sleepMinutesBetween(startHHMM, endHHMM) {
  if (!startHHMM || !endHHMM) return null;
  const [sh, sm] = startHHMM.split(':').map(Number);
  const [eh, em] = endHHMM.split(':').map(Number);
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return null;
  let mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins <= 0) mins += 24 * 60; // crossed midnight
  return mins;
}

// Formats a total minute count as "7 h 30 min" (or "45 min" / "8 h").
export function formatHoursMinutes(totalMinutes) {
  if (totalMinutes == null) return '—';
  const h = Math.floor(totalMinutes / 60);
  const m = Math.round(totalMinutes % 60);
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

// ROM as a percentage of the athlete's baseline joint angle.
export function romPct(angleDeg, baselineDeg) {
  if (!angleDeg || !baselineDeg) return null;
  return Math.max(0, Math.min(100, (angleDeg / baselineDeg) * 100));
}

export const COMBAT_TYPES = ['Boxing', 'Muay Thai'];
export const SLEEP_TYPES = ['Overnight', 'Nap'];
export const BP_TIMINGS = ['Before training', 'After training'];
export const INTENSITY_LEVELS = ['Technique', 'Conditioning', 'Sparring', 'Max Load'];
export const HIGH_INTENSITY = ['Sparring', 'Max Load', 'Conditioning'];
export const SLEEP_TIERS = ['Poor', 'Average', 'Restorative'];
export const MEAL_WINDOWS = ['Pre-workout', 'Post-workout', 'Main meal'];
export const MACRO_TAGS = ['High Protein', 'Adequate Carbs', 'Carbs for Recovery', 'Clean/Whole Foods', 'Fast Food'];

// Selectable pain/injury symptoms (checkbox list at the top of the section).
export const PAIN_SYMPTOMS = [
  'General dull muscle tightness / stiffness / fatigue',
  'Sharp / sudden pain during movement',
  'Localised joint swelling',
  'Visible instability',
  'Radiating numbness',
  'Head knock with dizziness / confusion',
];
