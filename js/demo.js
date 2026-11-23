// Made-up sample student for "Try with sample grades". No real person's data.
import { POLICY } from './policy.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const COURSES = [
  ['AP Biology', 'ap', 'Ms. Rivera', 91],
  ['AP Psychology', 'ap', 'Mr. Chen', 88],
  ['English 12', 'regular', 'Mrs. Okafor', 85],
  ['Honors Precalculus', 'honors', 'Mr. Patel', 80],
  ['AP US Government', 'ap', 'Ms. Brooks', 93],
  ['Spanish 4 Honors', 'honors', 'Sra. Gómez', 89],
  ['Physical Education', 'regular', 'Coach Lee', 97],
];

export function demoData() {
  const r = rng(20261123);
  const cats = POLICY.defaultCategories;
  const courses = COURSES.map(([name, level, teacher, skill], i) => {
    const mps = {};
    for (const [mp, count, month] of [['MP1', 14, 9], ['MP2', 7, 11]]) {
      const assignments = [];
      for (let k = 0; k < count; k++) {
        const cat = cats[k % 3 === 0 ? 0 : Math.min(cats.length - 1, 1)] || cats[0];
        const big = cat === cats[0];
        const possible = big ? [20, 50, 100][k % 3] : 10;
        const pct = Math.min(1.02, Math.max(0.45, (skill + (r() - 0.5) * 22) / 100));
        assignments.push({
          name: big ? ['Quiz', 'Unit test', 'Project'][k % 3] + ' ' + (k + 1) : 'Practice ' + (k + 1),
          category: cat.name, earned: Math.round(possible * pct * 2) / 2, possible,
          date: `${month}/${1 + k * 2}/2026`, from: 'svue',
        });
      }
      if (mp === 'MP2') assignments.push({ name: 'Unit test (not graded yet)', category: cats[0].name, earned: '', possible: 100, date: '12/4/2026', from: 'svue' });
      mps[mp] = { assignments };
    }
    return { name, level, teacher, period: i + 1, room: String(100 + i * 7), categories: cats.map((k) => ({ ...k })), mps, term: 'year', credits: 0.5 };
  });
  return { courses, prior: { unweighted: '3.85', weighted: '4.52', credits: '21' }, extra: { demo: true }, theme: 'auto' };
}
