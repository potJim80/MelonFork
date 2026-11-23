// Turns text copied from a StudentVUE course page (or any list of scores) into assignments.
// It is deliberately forgiving: one assignment per line, the score is the LAST "x / y"
// (or "x out of y") on the line, the category is whichever of the course's categories
// the line mentions. Lines with no score are skipped unless they say Missing.
import { uid } from './store.js';

const SCORE = /(\d+(?:\.\d+)?|\*{0,1})\s*(?:\/|out of)\s*(\d+(?:\.\d+)?)/gi;
const DATE = /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/;

function findCategory(line, categories) {
  const low = line.toLowerCase();
  let best = null;
  for (const c of categories) {
    const n = c.name.toLowerCase();
    if (low.includes(n) && (!best || n.length > best.name.length)) best = c;
  }
  if (best) return best.name;
  // Loose match: any distinctive word of a category name (e.g. "Assessments", "Practice").
  for (const c of categories) {
    const words = c.name.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 5);
    if (words.some((w) => low.includes(w))) return c.name;
  }
  return categories[0] ? categories[0].name : '';
}

export function parseScores(text, categories) {
  const out = [];
  const skipped = [];
  const lines = String(text).replace(/\r/g, '').split('\n');
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    // Drop dates first so "9/15/2026" is not read as a score.
    const dateM = line.match(DATE);
    const noDate = line.replace(new RegExp(DATE.source, 'g'), ' ');
    const scores = [...noDate.matchAll(SCORE)];
    const missing = /\bmissing\b/i.test(line);
    const excused = /\bexcused\b|\bexempt\b/i.test(line);
    if (!scores.length) { skipped.push(raw); continue; }
    const m = scores[scores.length - 1];
    const earned = m[1] === '' || m[1].startsWith('*') ? '' : Number(m[1]);
    const possible = Number(m[2]);
    if (!(possible > 0)) { skipped.push(raw); continue; }
    const cat = findCategory(noDate, categories);
    let name = noDate.slice(0, scores[0].index);
    if (cat) name = name.replace(new RegExp(cat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' ');
    name = name.replace(/\b(raw score|percentage|missing|excused|not graded|not for grading)\b/gi, ' ')
      .replace(/\s+/g, ' ').replace(/^[\s\-–|:]+|[\s\-–|:]+$/g, '').trim() || 'Assignment';
    out.push({
      id: uid(), name, category: cat, earned, possible,
      date: dateM ? dateM[0] : '', missing: missing && earned === '' ? true : false, excused,
    });
  }
  return { assignments: out, skipped };
}
