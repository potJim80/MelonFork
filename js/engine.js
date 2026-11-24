// MelonFork grade engine — pure functions, no DOM. All MCPS rules live in policy.js.
import { POLICY, roundHalfUp } from './policy.js';
export { roundHalfUp };

export const num = (v) => (v === '' || v === null || v === undefined ? NaN : Number(v));

// An assignment counts toward the grade when it has points possible and is not excused.
// A score left blank is "not graded yet" unless it is flagged missing (then it counts as 0).
export function counts(a) {
  if (a.excused || a.removed) return false;
  const p = num(a.possible);
  if (!(p > 0)) return false;
  if (a.missing) return true;
  return Number.isFinite(num(a.earned));
}
export function earnedOf(a) {
  if (a.missing && !Number.isFinite(num(a.earned))) return 0;
  return num(a.earned);
}

// Per-category totals and the overall percentage for one marking period.
export function markingPeriod(course, mp) {
  const list = (mp && mp.assignments) || [];
  const cats = course.categories && course.categories.length ? course.categories : [{ name: 'Total Points', weight: 100 }];
  const weighted = course.categories && course.categories.length > 0 && cats.some((c) => num(c.weight) > 0);
  const rows = cats.map((c) => ({ name: c.name, weight: num(c.weight) || 0, earned: 0, possible: 0, count: 0, pct: NaN }));
  const byName = new Map(rows.map((r) => [r.name.toLowerCase(), r]));
  for (const a of list) {
    if (!counts(a)) continue;
    let r = byName.get(String(a.category || '').toLowerCase());
    if (!r) r = weighted ? null : rows[0];
    if (!r) continue; // assignment in a category the course doesn't weight: ignore, like Synergy
    r.earned += earnedOf(a);
    r.possible += num(a.possible);
    r.count++;
  }
  for (const r of rows) r.pct = r.possible > 0 ? (r.earned / r.possible) * 100 : NaN;
  let pct = NaN;
  if (weighted) {
    // Categories with nothing graded yet are left out and the rest re-scaled (Synergy behaviour).
    const live = rows.filter((r) => Number.isFinite(r.pct) && r.weight > 0);
    const w = live.reduce((s, r) => s + r.weight, 0);
    if (w > 0) pct = live.reduce((s, r) => s + r.pct * r.weight, 0) / w;
  } else {
    const e = rows.reduce((s, r) => s + r.earned, 0), p = rows.reduce((s, r) => s + r.possible, 0);
    if (p > 0) pct = (e / p) * 100;
  }
  return { rows, pct, weighted };
}

export function letterFor(pct) {
  if (!Number.isFinite(pct)) return null;
  const v = roundHalfUp(pct); // MCPS letters come from the whole-number percentage
  for (const [L, min] of POLICY.cutoffs) if (v >= min) return L;
  return POLICY.cutoffs[POLICY.cutoffs.length - 1][0];
}

export const hasWhatIf = (mp) => !!(mp && (mp.assignments || []).some((a) => a.edited || a.custom || a.removed));

// The percentage that counts for a marking period:
//  1. a percentage you typed in as a what-if (override),
//  2. otherwise MelonFork's own calculation from the assignments, by the MCPS rules
//     (StudentVUE's marking-period page can leave out assignments, so its number isn't used),
//  3. StudentVUE's number only when there are no assignments to calculate from.
export function mpPercent(course, key) {
  const mp = course.mps && course.mps[key];
  if (!mp) return NaN;
  const o = num(mp.override);
  if (Number.isFinite(o)) return o;
  const calc = markingPeriod(course, mp).pct;
  if (Number.isFinite(calc)) return calc;
  if (mp.reported && Number.isFinite(num(mp.reported.pct)) && mp.reported.pct !== null && !hasWhatIf(mp)) return num(mp.reported.pct);
  return calc;
}

// The marking-period grade with every what-if undone (real scores only).
export function actualPercent(course, key) {
  const mp = course.mps && course.mps[key];
  if (!mp) return NaN;
  const assignments = (mp.assignments || []).filter((a) => !a.custom).map((a) => {
    const y = { ...a, ...(a.orig || {}) };
    delete y.orig; delete y.edited; delete y.removed;
    return y;
  });
  return markingPeriod(course, { assignments }).pct;
}

export function mpLetter(course, key) {
  const mp = course.mps && course.mps[key];
  if (!mp) return null;
  const p = mpPercent(course, key);
  if (Number.isFinite(p)) return letterFor(p);
  if (mp.reported && POLICY.letters.includes(mp.reported.letter) && !hasWhatIf(mp)) return mp.reported.letter;
  return null;
}

export const hasEOC = (course, sem) => !!course.eoc && (course.term === 'year' ? sem === 'S2' : course.term === sem);

// Semester grade, IKA-RA III.B.6.d-f: average of the two marking-period percentages, each
// rounded to a whole number; 40/40/20 with a state end-of-course exam. Returns
// {pct, letter, note}. pct is the unrounded average (the letter uses it rounded half up).
export function semesterGrade(course, sem, what = {}) {
  const [a, b] = POLICY.semesters[sem];
  const p1 = what[a] ?? mpPercent(course, a);
  const p2 = what[b] ?? mpPercent(course, b);
  const has1 = Number.isFinite(p1), has2 = Number.isFinite(p2);
  if (!has1 && !has2) return { pct: NaN, letter: null, note: '' };
  if (!has1 || !has2) {
    return { pct: NaN, letter: null, note: `${has1 ? b : a} has no grade yet, so the semester grade isn't set (MCPS shows M until both marking periods have grades).` };
  }
  const r1 = roundHalfUp(p1), r2 = roundHalfUp(p2);
  if (hasEOC(course, sem)) {
    const e = num(what.exam ?? (course.exams && course.exams[sem]));
    if (!Number.isFinite(e)) return { pct: NaN, letter: 'I', note: 'End-of-course exam score not in yet. MCPS marks the semester "I" until it arrives.' };
    const pct = (1 - POLICY.eocWeight) / 2 * (r1 + r2) + POLICY.eocWeight * e;
    return { pct, letter: letterFor(pct), note: `${a} ${r1} × 40% + ${b} ${r2} × 40% + exam ${e} × 20% = ${pct.toFixed(1)} → ${roundHalfUp(pct)}` };
  }
  const pct = (r1 + r2) / 2;
  return { pct, letter: letterFor(pct), note: `(${r1} + ${r2}) ÷ 2 = ${pct % 1 ? pct.toFixed(1) : pct}${pct % 1 ? ' → ' + roundHalfUp(pct) : ''}` };
}

// Lowest whole-number percentage needed in the second marking period of a semester for each
// letter, given the first one. Returns [{letter, need}] where need is a whole percent
// (the raw MP grade must be at least need - 0.5), 0 if guaranteed, or null if out of reach.
export function secondMPNeeds(course, sem) {
  const [a] = POLICY.semesters[sem];
  const p1 = mpPercent(course, a);
  if (!Number.isFinite(p1)) return [];
  const out = [];
  for (const [L, min] of POLICY.cutoffs) {
    if (!Number.isFinite(min)) continue;
    let need = null;
    for (let r2 = 0; r2 <= 100; r2++) {
      const g = semesterGrade(course, sem, { [POLICY.semesters[sem][1]]: r2 });
      if (g.letter && roundHalfUp(g.pct) >= min) { need = r2; break; }
    }
    out.push({ letter: L, need });
  }
  return out;
}

export const isWeighted = (course) => POLICY.weightedLevels.includes(course.level);

export function gradePoints(letter, course) {
  if (!letter || !(letter in POLICY.points)) return null;
  let p = POLICY.points[letter];
  if (isWeighted(course) && POLICY.weightBonusLetters.includes(letter)) p += POLICY.weightBonus;
  return p;
}

// GPA over a list of {letter, credits, course}. Returns {unweighted, weighted, credits}.
export function gpa(entries) {
  let c = 0, u = 0, w = 0;
  for (const e of entries) {
    if (!e.letter || !(e.letter in POLICY.points)) continue;
    const cr = num(e.credits) || 0;
    c += cr;
    u += POLICY.points[e.letter] * cr;
    w += gradePoints(e.letter, e.course) * cr;
  }
  return c > 0 ? { unweighted: u / c, weighted: w / c, credits: c } : { unweighted: NaN, weighted: NaN, credits: 0 };
}

export function combineGPA(prior, current) {
  const pc = num(prior && prior.credits) || 0;
  if (!(pc > 0) || !Number.isFinite(num(prior.unweighted))) return current;
  if (!(current.credits > 0)) return { unweighted: num(prior.unweighted), weighted: num(prior.weighted), credits: pc };
  const c = pc + current.credits;
  return {
    unweighted: (num(prior.unweighted) * pc + current.unweighted * current.credits) / c,
    weighted: ((Number.isFinite(num(prior.weighted)) ? num(prior.weighted) : num(prior.unweighted)) * pc + current.weighted * current.credits) / c,
    credits: c,
  };
}

// Score needed on one new assignment worth `possible` points in category `cat`
// for the marking period to reach `targetPct`. Returns {need, pct} or null.
export function needOnNext(course, mp, cat, possible, targetPct) {
  const P = num(possible);
  if (!(P > 0)) return null;
  const probe = (x) => {
    const m = { assignments: [...((mp && mp.assignments) || []), { name: '_probe', category: cat, earned: x, possible: P }] };
    return markingPeriod(course, m).pct;
  };
  // Grade is monotonic increasing in x; solve by bisection.
  let lo = 0, hi = POLICY.extraCredit ? P * 3 : P; // no extra credit in MCPS
  if (probe(hi) < targetPct) return { need: Infinity, best: probe(P) };
  if (probe(lo) >= targetPct) return { need: 0, best: probe(P) };
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (probe(mid) >= targetPct) hi = mid; else lo = mid;
  }
  return { need: hi, best: probe(P) };
}

// Lowest percentage that earns each letter (after the policy's rounding).
export function minPctFor(letter) {
  const row = POLICY.cutoffs.find(([L]) => L === letter);
  return row ? row[1] : NaN;
}
