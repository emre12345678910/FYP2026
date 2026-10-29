// alerts.js — automated notification & alert engine + RTP status tiers
import { fluidLossPct, romPct, sgtDay, HIGH_INTENSITY } from './store.js';

// Severity: 'red' (🔴 Restricted-worthy) | 'yellow' (🟡 Warning) | 'info'
// Each alert: { severity, icon, title, detail, checkinId, athleteId }

export function evaluateAthlete(athlete, checkins) {
  const alerts = [];
  const sorted = [...checkins].sort(
    (a, b) => new Date(a.timestampUtc) - new Date(b.timestampUtc)
  );

  sorted.forEach((c, i) => {
    const prev = sorted[i - 1];

    // --- Hydration: acute session weight loss > 2.0% ---
    const loss = fluidLossPct(c.pre_weight_kg, c.post_weight_kg);
    if (loss != null && loss > 2.0) {
      alerts.push(mk('red', '🔴', 'Hydration — acute fluid loss',
        `${loss.toFixed(1)}% body-mass loss this session (limit 2.0%).`, c, athlete));
    }

    // --- ROM drop < 60% of baseline ---
    // prefer the stored rom_percentage, fall back to recomputing from degrees
    const rom = c.rom_percentage != null
      ? c.rom_percentage
      : romPct(c.goniometer_degrees, athlete.romBaseline);
    if (rom != null && rom < 60) {
      alerts.push(mk('red', '🔴', 'ROM below threshold',
        `ROM at ${Math.round(rom)}% of baseline (${c.goniometer_degrees ?? '—'}° / ${athlete.romBaseline}°)${c.joint_tested ? ` · ${c.joint_tested}` : ''}.`, c, athlete));
    }

    // --- Acute pain spike: >= 2 point increase vs previous check-in ---
    if (prev && c.pain_score != null && prev.pain_score != null && c.pain_score - prev.pain_score >= 2) {
      alerts.push(mk('red', '🔴', 'Acute pain spike',
        `Pain rose ${prev.pain_score} → ${c.pain_score} (NPRS) since last check-in${c.pain_location ? ` · ${c.pain_location}` : ''}.`, c, athlete));
    }

    // --- Under-fueling: high-intensity session without a timely pre-workout meal ---
    if (HIGH_INTENSITY.includes(c.intensity_level)) {
      const nl = c.nutrition_log || {};
      const fueled = nl.pre_workout_meal && nl.pre_workout_meal.trim().length > 0;
      const timely = nl.fueled_before_session === true;
      if (!fueled || !timely) {
        alerts.push(mk('yellow', '🟡', 'Under-fueling risk',
          `${c.intensity_level} logged ${fueled ? 'but not fueled 2–3h prior' : 'with no pre-workout meal entry'}.`, c, athlete));
      }
    }

    // --- Sleep deprivation: < 6h warning ---
    // Recommendation is >8h sleep. Below 8h is a warning; below 6h is acute.
    if (c.sleep_hours != null && c.sleep_hours < 6) {
      alerts.push(mk('red', '🔴', 'Acute sleep deprivation',
        `Only ${c.sleep_hours}h sleep logged (recommended over 8h).`, c, athlete));
    } else if (c.sleep_hours != null && c.sleep_hours < 8) {
      alerts.push(mk('yellow', '🟡', 'Below sleep recommendation',
        `${c.sleep_hours}h sleep logged (recommended over 8h).`, c, athlete));
    }
  });

  // --- Sleep red alert: < 6h for 2 consecutive calendar days (SGT) ---
  const byDay = groupSleepByDay(sorted);
  const days = Object.keys(byDay).sort();
  for (let i = 1; i < days.length; i++) {
    const d1 = byDay[days[i - 1]];
    const d2 = byDay[days[i]];
    if (isNextDay(days[i - 1], days[i]) && d1 < 6 && d2 < 6) {
      alerts.push({
        severity: 'red', icon: '🔴',
        title: 'Severe sleep deprivation',
        detail: `<6h sleep on consecutive days (${days[i - 1]}: ${d1}h, ${days[i]}: ${d2}h) · recommended over 8h.`,
        athleteId: athlete.id, checkinId: null,
      });
    }
  }

  return alerts;
}

function groupSleepByDay(checkins) {
  const map = {};
  for (const c of checkins) {
    if (c.sleep_hours == null) continue;
    const day = c.sgtDay || sgtDay(c.timestampUtc);
    map[day] = map[day] == null ? c.sleep_hours : Math.min(map[day], c.sleep_hours);
  }
  return map;
}

function isNextDay(a, b) {
  const da = new Date(a + 'T00:00:00Z');
  const db = new Date(b + 'T00:00:00Z');
  return (db - da) === 86400000;
}

function mk(severity, icon, title, detail, c, athlete) {
  return { severity, icon, title, detail, checkinId: c.id, athleteId: athlete.id };
}

/* ----------------------- Per-log readiness rubric ------------------------ */
// Deterministic Return-to-Play readiness from a single log's absolute values.
// Returns 'RED' | 'YELLOW' | 'GREEN'. Missing values are treated as safe
// (they don't push a tier worse than the data supports).
export function evaluateReadinessStatus(log) {
  const pain = log.pain_score;
  const rom = log.rom_percentage;
  const sleep = log.sleep_hours;
  const fueled = log.nutrition_log ? log.nutrition_log.fueled_before_session : undefined;

  // Sleep recommendation is over 8h: <6h is restrictive, <8h is a modifier.
  // RED TIER (Restricted)
  if ((pain != null && pain >= 6) ||
      (rom != null && rom <= 60) ||
      (sleep != null && sleep < 6)) {
    return 'RED';
  }
  // YELLOW TIER (Modified)
  if ((pain != null && pain >= 3) ||
      (rom != null && rom <= 80) ||
      (sleep != null && sleep < 8) ||
      fueled === false) {
    return 'YELLOW';
  }
  // GREEN TIER (Cleared)
  return 'GREEN';
}

const TIERS = {
  RED: { tier: 'Restricted', icon: '🔴', cls: 'red', rank: 3 },
  YELLOW: { tier: 'Modified', icon: '🟡', cls: 'yellow', rank: 2 },
  GREEN: { tier: 'Cleared', icon: '🟢', cls: 'green', rank: 1 },
};

export function tierMeta(code) {
  return TIERS[code] || TIERS.GREEN;
}

// Overall athlete status = worst per-log readiness across their check-ins,
// using the deterministic rubric above. This is the authoritative display tier.
export function readinessTier(checkins) {
  let worst = 'GREEN';
  for (const log of checkins) {
    const code = evaluateReadinessStatus(log);
    if (TIERS[code].rank > TIERS[worst].rank) worst = code;
  }
  return tierMeta(worst);
}

// Legacy: status tier derived from the event-based alert list. Retained for
// callers that want an alert-driven view; the readiness rubric is preferred.
export function statusTier(alerts) {
  if (alerts.some((a) => a.severity === 'red')) {
    return { tier: 'Restricted', icon: '🔴', cls: 'red' };
  }
  if (alerts.some((a) => a.severity === 'yellow')) {
    return { tier: 'Modified', icon: '🟡', cls: 'yellow' };
  }
  return { tier: 'Cleared', icon: '🟢', cls: 'green' };
}
