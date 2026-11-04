// psych.js — psychological questionnaire definitions + scoring
// Zero dependencies. Shared by the input app (to render forms) and the
// dashboard (to score and chart results).
//
// IMPORTANT — LICENSING NOTE
// RESTQ-Sport, POMS and the Sport Motivation Scale II (SMS-II) are validated,
// COPYRIGHTED instruments. The exact official item wording is licensed and is
// NOT reproduced here. The items below are *representative placeholders* that
// preserve the correct subscale structure, response scales and scoring method.
// Replace the `text` of each item with the official licensed wording before any
// real-world / research use. Vealey's TSCI is reproduced structurally the same
// way for consistency.

/* --------------------------------------------------------------------------
 * Response scales
 * ------------------------------------------------------------------------ */

// RESTQ-Sport: 0 (never) … 6 (always)
export const RESTQ_SCALE = [
  { v: 0, label: 'never' }, { v: 1, label: 'seldom' }, { v: 2, label: 'sometimes' },
  { v: 3, label: 'often' }, { v: 4, label: 'more often' }, { v: 5, label: 'very often' },
  { v: 6, label: 'always' },
];

// POMS: 0 (not at all) … 4 (extremely)
export const POMS_SCALE = [
  { v: 0, label: 'not at all' }, { v: 1, label: 'a little' }, { v: 2, label: 'moderately' },
  { v: 3, label: 'quite a bit' }, { v: 4, label: 'extremely' },
];

// TSCI (Vealey): 1 (low) … 9 (high). Numeric scale with labelled end-anchors.
export const TSCI_SCALE = Array.from({ length: 9 }, (_, i) => ({ v: i + 1, label: String(i + 1) }));
export const TSCI_ANCHORS = { low: 'low confidence', high: 'high confidence' };

// SMS-II: 1 (does not correspond at all) … 7 (corresponds exactly).
export const SMS_SCALE = Array.from({ length: 7 }, (_, i) => ({ v: i + 1, label: String(i + 1) }));
export const SMS_ANCHORS = { low: 'does not correspond at all', high: 'corresponds exactly' };

/* --------------------------------------------------------------------------
 * RESTQ-Sport (Recovery–Stress Questionnaire for Athletes)
 * Structure: 19 scales → grouped into Stress-related and Recovery-related.
 * Short representative form: 2 items per scale (38 items). Each scale score is
 * the mean of its items (0–6). We also compute overall Stress and Recovery
 * indices (mean of their scale means).
 * ------------------------------------------------------------------------ */

const restqScale = (key, name, group, items) => ({ key, name, group, items });

export const RESTQ = {
  key: 'restq',
  title: 'RESTQ-Sport — Recovery–Stress Questionnaire',
  shortTitle: 'RESTQ-Sport',
  scaleResponses: RESTQ_SCALE,
  min: 0, max: 6,
  // group: 'stress' (higher = worse) or 'recovery' (higher = better)
  scales: [
    // ---- General stress ----
    restqScale('general_stress', 'General Stress', 'stress', [
      'I felt down or low in general.',
      'I felt mentally worn out.',
    ]),
    restqScale('emotional_stress', 'Emotional Stress', 'stress', [
      'I was easily irritated or short-tempered.',
      'I felt frustrated by things around me.',
    ]),
    restqScale('social_stress', 'Social Stress', 'stress', [
      'I argued or had conflict with people close to me.',
      'I felt let down by others.',
    ]),
    restqScale('conflicts_pressure', 'Conflicts / Pressure', 'stress', [
      'I felt under pressure to get things done.',
      'Unfinished tasks weighed on my mind.',
    ]),
    restqScale('fatigue', 'Fatigue', 'stress', [
      'I felt physically tired during the day.',
      'I struggled to stay awake or alert.',
    ]),
    restqScale('lack_of_energy', 'Lack of Energy', 'stress', [
      'I found it hard to concentrate.',
      'I lacked drive to get started on things.',
    ]),
    restqScale('physical_complaints', 'Physical Complaints', 'stress', [
      'I had aches or physical discomfort.',
      'Parts of my body felt sore or heavy.',
    ]),
    // ---- Sport-specific stress ----
    restqScale('disturbed_breaks', 'Disturbed Breaks', 'stress', [
      'My rest was interrupted during training blocks.',
      'I could not take proper breaks between sessions.',
    ]),
    restqScale('emotional_exhaustion', 'Emotional Exhaustion', 'stress', [
      'I felt emotionally drained by training.',
      'I felt burned out by my sport.',
    ]),
    restqScale('injury', 'Injury', 'stress', [
      'I was worried about getting injured.',
      'A niggle or injury concerned me.',
    ]),
    // ---- General recovery ----
    restqScale('success', 'Success', 'recovery', [
      'I was successful in what I set out to do.',
      'I felt good about my achievements.',
    ]),
    restqScale('social_recovery', 'Social Recovery', 'recovery', [
      'I had fun with friends or teammates.',
      'I felt supported by people around me.',
    ]),
    restqScale('physical_recovery', 'Physical Recovery', 'recovery', [
      'I felt physically relaxed.',
      'My body felt recovered and fresh.',
    ]),
    restqScale('general_wellbeing', 'General Well-being', 'recovery', [
      'I felt content and in a good mood.',
      'I felt comfortable and at ease.',
    ]),
    restqScale('sleep_quality', 'Sleep Quality', 'recovery', [
      'I slept well and without interruption.',
      'I woke up feeling rested.',
    ]),
    // ---- Sport-specific recovery ----
    restqScale('being_in_shape', 'Being in Shape', 'recovery', [
      'I felt physically in good shape.',
      'I felt fit for training and competition.',
    ]),
    restqScale('personal_accomplishment', 'Personal Accomplishment', 'recovery', [
      'I felt I belonged in my training group.',
      'I felt capable and competent in my sport.',
    ]),
    restqScale('self_efficacy', 'Self-efficacy', 'recovery', [
      'I was convinced I could perform well.',
      'I felt prepared for what was asked of me.',
    ]),
    restqScale('self_regulation', 'Self-regulation', 'recovery', [
      'I prepared myself mentally for sessions.',
      'I set myself clear goals and plans.',
    ]),
  ],
};

/* --------------------------------------------------------------------------
 * POMS (Profile of Mood States)
 * 6 subscales. Short representative form: 3 items per subscale (18 items).
 * Subscale score = SUM of its items. Total Mood Disturbance (TMD) =
 * (Tension + Depression + Anger + Fatigue + Confusion) − Vigour (+100 const to
 * avoid negatives, matching the common POMS TMD convention).
 * ------------------------------------------------------------------------ */

const pomsSub = (key, name, polarity, items) => ({ key, name, polarity, items });

export const POMS = {
  key: 'poms',
  title: 'POMS — Profile of Mood States',
  shortTitle: 'POMS',
  scaleResponses: POMS_SCALE,
  min: 0, max: 4,
  // polarity: 'negative' adds to TMD; 'positive' (Vigour) subtracts from TMD
  subscales: [
    pomsSub('tension', 'Tension–Anxiety', 'negative', ['Tense', 'On edge', 'Uneasy']),
    pomsSub('depression', 'Depression–Dejection', 'negative', ['Discouraged', 'Sad', 'Hopeless']),
    pomsSub('anger', 'Anger–Hostility', 'negative', ['Annoyed', 'Resentful', 'Bad-tempered']),
    pomsSub('fatigue', 'Fatigue–Inertia', 'negative', ['Worn out', 'Sluggish', 'Exhausted']),
    pomsSub('confusion', 'Confusion–Bewilderment', 'negative', ['Confused', 'Unable to focus', 'Muddled']),
    pomsSub('vigour', 'Vigour–Activity', 'positive', ['Lively', 'Energetic', 'Full of pep']),
  ],
};

/* --------------------------------------------------------------------------
 * TSCI — Trait Sport-Confidence Inventory (Vealey)
 * 13 items, single factor, 1–9 scale. Score = mean of the 13 items (1–9).
 * ------------------------------------------------------------------------ */

export const TSCI = {
  key: 'tsci',
  title: 'TSCI — Trait Sport-Confidence Inventory',
  shortTitle: 'TSCI',
  scaleResponses: TSCI_SCALE,
  min: 1, max: 9,
  anchors: TSCI_ANCHORS,
  prompt: 'Compared with the most confident athlete you know, rate your confidence to…',
  items: [
    'execute the skills needed to be successful.',
    'make critical decisions during competition.',
    'perform under pressure.',
    'execute successful strategy.',
    'concentrate well enough to be successful.',
    'adapt to different competitive situations.',
    'achieve your competitive goals.',
    'be successful.',
    'consistently be successful.',
    'think and respond successfully during competition.',
    'meet the challenge of competition.',
    'be successful even when the odds are against you.',
    'bounce back from performing poorly.',
  ],
};

/* --------------------------------------------------------------------------
 * SMS-II — Sport Motivation Scale II (Pelletier et al., 2013)
 * The revised SMS: 6 subscales × 3 items = 18 items, 1–7 scale, spanning the
 * self-determination continuum (intrinsic → integrated → identified →
 * introjected → external → amotivation).
 * Subscale score = mean of its 3 items (1–7). We also compute a Relative
 * Autonomy Index (RAI) using standard SDT weights.
 * ------------------------------------------------------------------------ */

const smsSub = (key, name, raiWeight, items) => ({ key, name, raiWeight, items });

export const SMS = {
  key: 'sms',
  title: 'SMS-II — Sport Motivation Scale II',
  shortTitle: 'SMS-II',
  scaleResponses: SMS_SCALE,
  min: 1, max: 7,
  anchors: SMS_ANCHORS,
  prompt: 'Why do you practise your sport?',
  // ordered most self-determined → least; raiWeight used for the autonomy index
  // 3 representative items per subscale (18 total), matching the SMS-II structure
  subscales: [
    smsSub('intrinsic', 'Intrinsic Motivation', 3, [
      'For the pleasure I feel when I improve at my sport.',
      'Because I really enjoy the experience of training.',
      'For the satisfaction of learning something new about my sport.',
    ]),
    smsSub('integrated', 'Integrated Regulation', 2, [
      'Because practising my sport is part of who I am.',
      'Because it reflects the values I care about.',
      'Because my sport is an expression of myself.',
    ]),
    smsSub('identified', 'Identified Regulation', 1, [
      'Because it is a good way to develop myself.',
      'Because it helps me reach goals that matter to me.',
      'Because training is one of the best ways to improve other parts of my life.',
    ]),
    smsSub('introjected', 'Introjected Regulation', -1, [
      "Because I'd feel guilty if I didn't train.",
      'Because I must do it to feel good about myself.',
      'Because I would feel bad about myself if I stopped.',
    ]),
    smsSub('external', 'External Regulation', -2, [
      'For the recognition or rewards I get from others.',
      'Because people around me expect me to.',
      'Because it lets me earn approval from others.',
    ]),
    smsSub('amotivation', 'Amotivation', -3, [
      "I'm not sure anymore; I wonder if it's worth it.",
      "I don't seem to be getting much out of it.",
      "I used to have good reasons, but now I ask myself why I keep going.",
    ]),
  ],
};

export const QUESTIONNAIRES = { restq: RESTQ, poms: POMS, tsci: TSCI, sms: SMS };

/* --------------------------------------------------------------------------
 * Scoring
 * A mental-log submission stores per-questionnaire raw answers keyed by item
 * id, e.g. responses = { restq: {restq_general_stress_0: 4, ...}, poms: {...} }
 * ------------------------------------------------------------------------ */

function mean(arr) {
  const v = arr.filter((x) => x != null);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
}

// Builds a stable item id for a questionnaire item.
export function itemId(qKey, scaleKey, idx) {
  return `${qKey}_${scaleKey}_${idx}`;
}

// --- RESTQ ---
export function scoreRestq(answers) {
  if (!answers) return null;
  const scales = RESTQ.scales.map((sc) => {
    const vals = sc.items.map((_, i) => answers[itemId('restq', sc.key, i)]);
    return { key: sc.key, name: sc.name, group: sc.group, score: mean(vals) };
  });
  const stressScales = scales.filter((s) => s.group === 'stress' && s.score != null);
  const recoveryScales = scales.filter((s) => s.group === 'recovery' && s.score != null);
  const stressIndex = mean(stressScales.map((s) => s.score));
  const recoveryIndex = mean(recoveryScales.map((s) => s.score));
  return {
    scales,
    stressIndex,
    recoveryIndex,
    // Positive = recovery dominant (good). Negative = stress dominant (watch).
    recoveryStressBalance: (recoveryIndex != null && stressIndex != null) ? recoveryIndex - stressIndex : null,
  };
}

// --- POMS ---
export function scorePoms(answers) {
  if (!answers) return null;
  const subscales = POMS.subscales.map((sub) => {
    const vals = sub.items.map((_, i) => answers[itemId('poms', sub.key, i)]).filter((x) => x != null);
    const score = vals.length ? vals.reduce((s, x) => s + x, 0) : null; // SUM
    return { key: sub.key, name: sub.name, polarity: sub.polarity, score };
  });
  const neg = subscales.filter((s) => s.polarity === 'negative').reduce((s, x) => s + (x.score || 0), 0);
  const vig = subscales.find((s) => s.key === 'vigour');
  const tmd = neg - (vig && vig.score != null ? vig.score : 0) + 100; // +100 convention
  return { subscales, tmd };
}

// --- TSCI ---
export function scoreTsci(answers) {
  if (!answers) return null;
  const vals = TSCI.items.map((_, i) => answers[itemId('tsci', 'item', i)]);
  const score = mean(vals);
  return { score, band: score == null ? null : score >= 6 ? 'high' : score >= 4 ? 'moderate' : 'low' };
}

// --- SMS-II ---
export function scoreSms(answers) {
  if (!answers) return null;
  const subscales = SMS.subscales.map((sub) => {
    const vals = sub.items.map((_, i) => answers[itemId('sms', sub.key, i)]);
    return { key: sub.key, name: sub.name, raiWeight: sub.raiWeight, score: mean(vals) };
  });
  // Relative Autonomy Index = Σ (weight × subscale mean)
  const rai = subscales.every((s) => s.score != null)
    ? subscales.reduce((s, x) => s + x.raiWeight * x.score, 0) : null;
  return { subscales, rai };
}

// Scores a whole mental-log submission into a convenient object.
export function scoreMentalLog(ml) {
  if (!ml || !ml.responses) return null;
  const r = ml.responses;
  return {
    restq: scoreRestq(r.restq),
    poms: scorePoms(r.poms),
    tsci: scoreTsci(r.tsci),
    sms: scoreSms(r.sms),
  };
}
