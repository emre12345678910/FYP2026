// store.js — persistence + Singapore Time + core domain logic
// Zero dependencies. Data persists in localStorage.

import { CONFIG, pushKey, pushAll, pullState, startSync, isShared, resolveBackend, activeBackend, KEYS } from './api.js?v=29';

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
  // IMPORTANT: do NOT persist a seed. On first load, shared (Firebase) data may
  // not have arrived yet; persisting a seed would push demo athletes to the
  // cloud and overwrite real data from other devices. Return demo athletes
  // in-memory only — they vanish once real data (local or cloud) exists and are
  // never written to the backend.
  return [
    { id: 'a1', name: 'Marcus Tan', gender: 'Male', combatType: 'Boxing', avatar: 'boxer', romBaseline: 135, currentWeight: 72.5, age: 24, bottleMl: 750, hydrationGoalMl: 3000, _demo: true },
    { id: 'a2', name: 'Priya Nair', gender: 'Female', combatType: 'Muay Thai', avatar: 'muaythai', romBaseline: 140, currentWeight: 61.0, age: 27, bottleMl: 600, hydrationGoalMl: 2500, _demo: true },
    { id: 'a3', name: 'Devon Lee', gender: 'Male', combatType: 'Muay Thai', avatar: 'boxer', romBaseline: 130, currentWeight: 80.3, age: 22, bottleMl: 1000, hydrationGoalMl: 3500, _demo: true },
  ];
}

export function addAthlete({ name, gender, combatType, romBaseline, currentWeight, age, bottleMl }) {
  // Drop in-memory demo athletes so they are never persisted / pushed to cloud.
  const athletes = getAthletes().filter((a) => !a._demo);
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
    train_start: input.train_start || null, // HH:MM (SGT wall clock)
    train_end: input.train_end || null,     // HH:MM (SGT wall clock)
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

/* ---------------------------- Body-mass goal ----------------------------- */
// A simple, physiological-only goal attached to the athlete profile:
//   'maintain' | 'gain' | 'lose'. Defaults to 'maintain'. Stored on the athlete
// object (never touches the mental-log store).
export const MASS_GOALS = {
  maintain: { key: 'maintain', label: 'Maintain', verb: 'maintaining' },
  gain: { key: 'gain', label: 'Gain', verb: 'gaining' },
  lose: { key: 'lose', label: 'Lose', verb: 'losing' },
};

export function getMassGoal(athlete) {
  const g = athlete && athlete.massGoal;
  return MASS_GOALS[g] ? g : 'maintain';
}

// Evaluate whether the athlete is "on track" for their body-mass goal, based on
// the net change across their recorded body-mass series. Returns
// { onTrack: bool, label, detail, cls } or null when there isn't enough data.
//   maintain → net change within ±1.0 kg of the first recording
//   gain     → latest is at least 0.2 kg above the first recording
//   lose     → latest is at least 0.2 kg below the first recording
export function massGoalStatus(athlete) {
  const goal = getMassGoal(athlete);
  const list = checkinsForAthlete(athlete.id).filter((c) => c.body_mass_kg != null);
  if (list.length < 2) {
    return { onTrack: null, label: 'Not enough data', detail: 'Log a few weigh-ins to track progress.', cls: 'muted' };
  }
  const first = list[0].body_mass_kg;
  const latest = list[list.length - 1].body_mass_kg;
  const net = Math.round((latest - first) * 10) / 10;
  const netStr = `${net > 0 ? '+' : ''}${net.toFixed(1)} kg since first recording`;
  if (goal === 'maintain') {
    const onTrack = Math.abs(net) <= 1.0;
    return onTrack
      ? { onTrack: true, label: 'You are on track!', detail: `Steady · ${netStr}`, cls: 'green' }
      : { onTrack: false, label: 'Drifting off goal', detail: `Weight moved ${netStr}`, cls: 'yellow' };
  }
  if (goal === 'gain') {
    const onTrack = net >= 0.2;
    return onTrack
      ? { onTrack: true, label: 'You are on track!', detail: `Trending up · ${netStr}`, cls: 'green' }
      : { onTrack: false, label: 'Not gaining yet', detail: netStr, cls: 'yellow' };
  }
  // lose
  const onTrack = net <= -0.2;
  return onTrack
    ? { onTrack: true, label: 'You are on track!', detail: `Trending down · ${netStr}`, cls: 'green' }
    : { onTrack: false, label: 'Not losing yet', detail: netStr, cls: 'yellow' };
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

// Returns the hydration record for an athlete on a specific SGT day (YYYY-MM-DD),
// with per-tap timestamps so callers can bucket fluid into time windows.
export function getHydrationForDay(athleteId, sgtDayKey) {
  const store = getHydrationStore();
  return normHydration(store[`${athleteId}|${sgtDayKey}`]);
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

/* ---------------------------- Nutrition (kcal) --------------------------- */
// Per-athlete, per-SGT-day calorie tracking, mirroring the hydration store.
// Record shape: { foods: [{ id, note, kcal, label, sgt, utc }], target }.
//   foods  — logged food items (each with a kcal value).
//   target — the athlete's daily calorie goal/maintenance for that day.
const NUTRITION_KEY = 'eastside_fc_nutrition_v1';

// Singapore HPB (Health Promotion Board) local-food calorie estimates (kcal
// per standard serving). Values are rounded typical portions used for a quick
// estimate — coaches/athletes can always log an exact kcal manually.
export const HPB_FOODS = [
  // --- Rice & mixed-rice dishes ---
  { name: 'Steamed Chicken Rice', kcal: 600 },
  { name: 'Roasted Chicken Rice', kcal: 610 },
  { name: 'Cai Png (2 Veg 1 Meat)', kcal: 650 },
  { name: 'Cai Png (3 Veg 1 Meat)', kcal: 600 },
  { name: 'Nasi Lemak (w/ chicken wing)', kcal: 650 },
  { name: 'Nasi Briyani (chicken)', kcal: 870 },
  { name: 'Thunder Tea Rice', kcal: 420 },
  { name: 'Economic Bee Hoon', kcal: 400 },
  { name: 'Claypot Rice', kcal: 700 },
  // --- Noodles ---
  { name: 'Sliced Fish Soup + Rice', kcal: 450 },
  { name: 'Fishball Noodles (dry)', kcal: 500 },
  { name: 'Fishball Noodle Soup', kcal: 340 },
  { name: 'Mee Soto', kcal: 480 },
  { name: 'Mee Rebus', kcal: 560 },
  { name: 'Laksa', kcal: 590 },
  { name: 'Char Kway Teow', kcal: 740 },
  { name: 'Hokkien Mee', kcal: 630 },
  { name: 'Wanton Mee (dry)', kcal: 410 },
  { name: 'Ban Mian (soup)', kcal: 475 },
  { name: 'Prawn Mee (soup)', kcal: 430 },
  { name: 'Bak Chor Mee (dry)', kcal: 510 },
  // --- Malay / Indian ---
  { name: 'Roti Prata (2 plain)', kcal: 340 },
  { name: 'Chicken Rice (Hainanese set)', kcal: 607 },
  { name: 'Mutton Soup (w/ bread)', kcal: 400 },
  { name: 'Satay (10 sticks, chicken)', kcal: 490 },
  { name: 'Lontong', kcal: 500 },
  // --- Soups & lighter mains ---
  { name: 'Yong Tau Foo (soup, 7 pcs)', kcal: 400 },
  { name: 'Sliced Fish Bee Hoon Soup', kcal: 370 },
  { name: 'Porridge (chicken)', kcal: 300 },
  // --- Proteins & recovery ---
  { name: 'Whey Protein Shake', kcal: 150 },
  { name: 'Chicken Breast (150g)', kcal: 250 },
  { name: 'Grilled Fish Fillet (150g)', kcal: 220 },
  { name: 'Tofu (200g)', kcal: 150 },
  { name: '2 Eggs (boiled)', kcal: 160 },
  { name: 'Hard-boiled Egg (1)', kcal: 78 },
  { name: 'Greek Yogurt (150g)', kcal: 130 },
  { name: 'Peanut Butter (2 tbsp)', kcal: 190 },
  // --- Carbs & sides ---
  { name: 'Wholemeal Bread (2 slices)', kcal: 140 },
  { name: 'Kaya Toast (2 slices)', kcal: 300 },
  { name: 'White Rice (1 bowl)', kcal: 280 },
  { name: 'Brown Rice (1 bowl)', kcal: 220 },
  { name: 'Oats (1 bowl, cooked)', kcal: 150 },
  { name: 'Sweet Potato (medium)', kcal: 115 },
  // --- Fruit & drinks ---
  { name: 'Banana', kcal: 105 },
  { name: 'Apple', kcal: 95 },
  { name: 'Soya Bean Milk (sweet)', kcal: 130 },
  { name: 'Teh Tarik', kcal: 180 },
  { name: 'Kopi O (no sugar)', kcal: 10 },
  { name: 'Milo (hot, 1 cup)', kcal: 200 },
  { name: 'Coconut Water (1 cup)', kcal: 45 },
  { name: 'Isotonic Drink (500ml)', kcal: 130 },
  // --- Raw ingredients (weigh-by-gram). `per100g` = kcal per 100 g; `kcal`
  // is the default-serving estimate (100 g, or a typical portion) shown in the
  // list. When one of these is selected the estimator offers a grams input. ---
  { name: 'Rice, cooked', kcal: 130, per100g: 130, grams: 200 },      // ~1 bowl = 200g = 260
  { name: 'Brown rice, cooked', kcal: 112, per100g: 112, grams: 200 },
  { name: 'Chicken breast, cooked', kcal: 165, per100g: 165, grams: 150 },
  { name: 'Chicken thigh, cooked', kcal: 209, per100g: 209, grams: 150 },
  { name: 'Beef, lean cooked', kcal: 250, per100g: 250, grams: 150 },
  { name: 'Salmon, cooked', kcal: 206, per100g: 206, grams: 150 },
  { name: 'White fish, cooked', kcal: 110, per100g: 110, grams: 150 },
  { name: 'Tofu, firm', kcal: 144, per100g: 144, grams: 200 },
  { name: 'Prawns, cooked', kcal: 99, per100g: 99, grams: 150 },
  { name: 'Pasta, cooked', kcal: 131, per100g: 131, grams: 200 },
  { name: 'Noodles, cooked', kcal: 138, per100g: 138, grams: 200 },
  { name: 'Potato, boiled', kcal: 87, per100g: 87, grams: 150 },
  { name: 'Sweet potato, boiled', kcal: 90, per100g: 90, grams: 150 },
  { name: 'Oats, dry', kcal: 389, per100g: 389, grams: 50 },
  { name: 'Broccoli, cooked', kcal: 35, per100g: 35, grams: 100 },
  { name: 'Mixed vegetables', kcal: 45, per100g: 45, grams: 100 },
  { name: 'Avocado', kcal: 160, per100g: 160, grams: 100 },
  // --- Fixed-portion raw items (counted/served, not weighed) ---
  { name: 'Egg, whole (per 1, ~50g)', kcal: 78 },
  { name: 'Egg white (per 1)', kcal: 17 },
  { name: 'Bread, white (1 slice)', kcal: 75 },
  { name: 'Olive oil (1 tbsp)', kcal: 119 },
  { name: 'Peanut butter (1 tbsp)', kcal: 95 },
  { name: 'Almonds (28g / ~23 nuts)', kcal: 164 },
  { name: 'Milk, full cream (1 cup, 250ml)', kcal: 150 },
  { name: 'Milk, low fat (1 cup, 250ml)', kcal: 105 },
  { name: 'Cheese, cheddar (1 slice, ~20g)', kcal: 80 },
  { name: 'Butter (1 tsp)', kcal: 34 },
];

// Training-load-based calorie target for boxers (body weight × kcal/kg factor):
//   • Light / easy drill ......... 35–40 kcal/kg
//   • Mixed camp / conditioning .. 45–55 kcal/kg
//   • Heavy sparring / high-vol .. 60–70 kcal/kg
// The day type is inferred from that day's logged training (intensity level,
// session RPE and total minutes). Athletes can still override the target via
// the slider; this just drives the *recommended* default each day.
export const DEFAULT_MAINTENANCE_KCAL = 2800;

export const CALORIE_DAY_TYPES = {
  light: { key: 'light', label: 'Light / rest day', lo: 35, hi: 40 },
  mixed: { key: 'mixed', label: 'Mixed camp / conditioning', lo: 45, hi: 55 },
  heavy: { key: 'heavy', label: 'Heavy sparring / high-volume', lo: 60, hi: 70 },
};

// Classify an athlete's SGT day into a calorie day-type from their training
// check-ins on that day. Heavy = any Sparring/Max Load session, RPE ≥ 8, or
// ≥ 90 min total. Mixed = Conditioning, RPE ≥ 5, or ≥ 30 min. Else Light.
export function calorieDayType(athleteId, sgtDayKey) {
  const day = sgtDayKey || sgtNow().date;
  const sessions = getCheckins().filter((c) =>
    c.athleteId === athleteId && (c.sgtDay || sgtDay(c.timestampUtc)) === day &&
    (c.intensity_level || c.srpe != null || c.duration_mins != null));
  if (!sessions.length) return 'light';
  const minutes = sessions.reduce((s, c) => s + (Number(c.duration_mins) || 0), 0);
  const maxRpe = sessions.reduce((m, c) => Math.max(m, Number(c.srpe) || 0), 0);
  const levels = sessions.map((c) => c.intensity_level);
  const heavyLevel = levels.some((l) => l === 'Sparring' || l === 'Max Load');
  const mixedLevel = levels.some((l) => l === 'Conditioning');
  if (heavyLevel || maxRpe >= 8 || minutes >= 90) return 'heavy';
  if (mixedLevel || maxRpe >= 5 || minutes >= 30) return 'mixed';
  return 'light';
}

// Full recommended-calorie breakdown for an athlete on a day. Returns:
//   { dayType, label, lo, hi, rangeLo, rangeHi, recommended, weight }
// recommended = midpoint of the kcal/kg range × body weight (rounded to 10).
export function calorieTargetInfo(athlete, sgtDayKey) {
  const w = athlete && athlete.currentWeight ? Number(athlete.currentWeight) : null;
  const dayType = calorieDayType(athlete.id, sgtDayKey);
  const t = CALORIE_DAY_TYPES[dayType];
  if (!w) {
    return { dayType, label: t.label, lo: t.lo, hi: t.hi, rangeLo: null, rangeHi: null, recommended: DEFAULT_MAINTENANCE_KCAL, weight: null };
  }
  const rangeLo = Math.round((w * t.lo) / 10) * 10;
  const rangeHi = Math.round((w * t.hi) / 10) * 10;
  const recommended = Math.round((w * ((t.lo + t.hi) / 2)) / 10) * 10;
  return { dayType, label: t.label, lo: t.lo, hi: t.hi, rangeLo, rangeHi, recommended, weight: w };
}

// The recommended daily calorie goal (training-load based). Falls back to 2800.
export function maintenanceKcal(athlete, sgtDayKey) {
  return calorieTargetInfo(athlete, sgtDayKey).recommended;
}

function getNutritionStore() {
  const raw = localStorage.getItem(NUTRITION_KEY);
  return raw ? JSON.parse(raw) : {};
}

// Normalises a stored record to { foods: [], target: number|null, manual: 0 }.
//   manual — a quick-entry calories number the athlete types/drags on the
//            slider instead of logging each food. It ADDS to the food total;
//            it never subtracts logged food.
function normNutrition(rec) {
  if (!rec) return { foods: [], target: null, manual: 0 };
  return {
    foods: Array.isArray(rec.foods) ? rec.foods : [],
    target: rec.target ?? null,
    manual: Math.max(0, Number(rec.manual) || 0),
  };
}

// Today's (SGT) nutrition record for an athlete.
export function getNutritionToday(athleteId) {
  return normNutrition(getNutritionStore()[`${athleteId}|${sgtNow().date}`]);
}

// Nutrition record for an athlete on a specific SGT day.
export function getNutritionForDay(athleteId, sgtDayKey) {
  return normNutrition(getNutritionStore()[`${athleteId}|${sgtDayKey}`]);
}

// Sum of the food items logged for a record (no manual quick-entry).
function foodKcal(rec) {
  return rec.foods.reduce((s, f) => s + (Number(f.kcal) || 0), 0);
}

// Food-only kcal for today / a given day (the "Sum" of the food log).
export function nutritionFoodKcalToday(athleteId) {
  return foodKcal(getNutritionToday(athleteId));
}
export function nutritionFoodKcalForDay(athleteId, sgtDayKey) {
  return foodKcal(getNutritionForDay(athleteId, sgtDayKey));
}

// TOTAL consumed kcal = logged food + the manual quick-entry. This is what the
// big number, balance, dashboard and trend all use.
export function nutritionKcalToday(athleteId) {
  const rec = getNutritionToday(athleteId);
  return foodKcal(rec) + (rec.manual || 0);
}
export function nutritionKcalForDay(athleteId, sgtDayKey) {
  const rec = getNutritionForDay(athleteId, sgtDayKey);
  return foodKcal(rec) + (rec.manual || 0);
}

// Last-7-SGT-days calorie series for an athlete (for the weekly trend chart).
// Each point: { key, label, logged, target } where logged = food + manual and
// target is the day's stored override if present, else the recommended goal.
export function calorieWeekSeries(athlete) {
  const out = [];
  const now = Date.now();
  for (let i = 6; i >= 0; i--) {
    const key = sgtDay(new Date(now - i * 86400000).toISOString());
    const rec = getNutritionForDay(athlete.id, key);
    const logged = foodKcal(rec) + (rec.manual || 0);
    const target = rec.target != null ? rec.target : calorieTargetInfo(athlete, key).recommended;
    out.push({ key, label: key.slice(5), logged, target });
  }
  return out;
}

// Adds a food item to today's log. note = label, kcal = calories (number).
// portion multiplies the kcal (e.g. 1.5x). Returns the updated record.
export function addFoodItem(athleteId, note, kcal, portion = 1) {
  const ts = sgtNow();
  const store = getNutritionStore();
  const key = `${athleteId}|${ts.date}`;
  const rec = normNutrition(store[key]);
  const cal = Math.round((Number(kcal) || 0) * (Number(portion) || 1));
  rec.foods.push({
    id: 'food_' + Date.now() + Math.floor(Math.random() * 1000),
    note: String(note || '').trim() || 'Food item',
    kcal: cal,
    portion: Number(portion) || 1,
    sgt: ts.sgt, utc: ts.utc, label: ts.label,
  });
  store[key] = rec;
  persist(NUTRITION_KEY, JSON.stringify(store));
  return { ...rec };
}

// Removes a food item (by id) from today's log.
export function removeFoodItem(athleteId, foodId) {
  const day = sgtNow().date;
  const store = getNutritionStore();
  const key = `${athleteId}|${day}`;
  const rec = normNutrition(store[key]);
  rec.foods = rec.foods.filter((f) => f.id !== foodId);
  store[key] = rec;
  persist(NUTRITION_KEY, JSON.stringify(store));
  return { ...rec };
}

// Sets today's calorie TARGET (the goal line) for an athlete.
export function setCalorieTarget(athleteId, target) {
  const day = sgtNow().date;
  const store = getNutritionStore();
  const key = `${athleteId}|${day}`;
  const rec = normNutrition(store[key]);
  rec.target = Math.max(0, Math.round(Number(target) || 0));
  store[key] = rec;
  persist(NUTRITION_KEY, JSON.stringify(store));
  return { ...rec };
}

// Sets today's MANUAL quick-entry calories (the slider / number box) for an
// athlete. This is a shortcut for when they don't want to log each food — it
// ADDS to the food-log total and is clamped to ≥ 0, so it can never subtract
// the calories they already logged.
export function setManualKcal(athleteId, kcal) {
  const day = sgtNow().date;
  const store = getNutritionStore();
  const key = `${athleteId}|${day}`;
  const rec = normNutrition(store[key]);
  rec.manual = Math.max(0, Math.round(Number(kcal) || 0));
  store[key] = rec;
  persist(NUTRITION_KEY, JSON.stringify(store));
  return { ...rec };
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

  // Remove their nutrition records (keys are "athleteId|SGTday").
  const nut = getNutritionStore();
  let nutChanged = false;
  for (const key of Object.keys(nut)) {
    if (key.startsWith(id + '|')) { delete nut[key]; nutChanged = true; }
  }
  if (nutChanged) persist(NUTRITION_KEY, JSON.stringify(nut));

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
      [NUTRITION_KEY]: getNutritionStore(),
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
  const incomingNutrition = d[NUTRITION_KEY] || {};

  if (mode === 'replace') {
    persist(ATHLETE_KEY, JSON.stringify(incomingAthletes));
    persist(STORAGE_KEY, JSON.stringify(incomingCheckins));
    persist(MENTAL_KEY, JSON.stringify(incomingMental));
    persist(OVERRIDE_KEY, JSON.stringify(incomingOverrides));
    persist(HYDRATION_KEY, JSON.stringify(incomingHydration));
    persist(NUTRITION_KEY, JSON.stringify(incomingNutrition));
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

  const nut = getNutritionStore();
  for (const [k, v] of Object.entries(incomingNutrition)) if (!nut[k]) nut[k] = v;
  persist(NUTRITION_KEY, JSON.stringify(nut));

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

// Minutes between a training start and end (HH:MM). Unlike sleep this is NOT
// overnight-aware: a session is same-day, so if end <= start we treat it as an
// invalid entry and return null (prevents a reversed/mis-typed time from
// inflating workload = sRPE × minutes to ~1440).
export function trainMinutesBetween(startHHMM, endHHMM) {
  if (!startHHMM || !endHHMM) return null;
  const [sh, sm] = startHHMM.split(':').map(Number);
  const [eh, em] = endHHMM.split(':').map(Number);
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return null;
  const mins = (eh * 60 + em) - (sh * 60 + sm);
  return mins > 0 ? mins : null;
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
