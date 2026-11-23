// node test/run.mjs — checks the grade math against the MCPS rules and examples.
import * as E from '../js/engine.js';
import { parseScores } from '../js/paste.js';
import { mergeGradebook, mpKeyFor, guessLevel } from '../js/svue.js';
import { demoData } from '../js/demo.js';
import { normalize } from '../js/store.js';

let fail = 0, pass = 0;
const eq = (name, got, want) => {
  const ok = typeof want === 'number' ? (got === want || Math.abs(got - want) < 1e-9) : JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else { fail++; console.log('FAIL', name, '\n  got ', got, '\n  want', want); }
};
const course = (mps, extra = {}) => normalize({ courses: [{ name: 'T', categories: [{ name: 'All Tasks / Assessments', weight: 90 }, { name: 'Practice / Preparation', weight: 10 }], mps, ...extra }] }).courses[0];
const ovr = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { override: v, assignments: [] }]));

// Letter cutoffs + half-up rounding (IKA-RA III.B.6.c; "89.5% … rounds up to 90%, which is an A")
eq('89.5 is A', E.letterFor(89.5), 'A');
eq('89.49 is B', E.letterFor(89.49), 'B');
eq('79.5 is B', E.letterFor(79.5), 'B');
eq('69.5 is C', E.letterFor(69.5), 'C');
eq('59.5 is D', E.letterFor(59.5), 'D');
eq('59.4 is E', E.letterFor(59.4), 'E');
eq('0 is E', E.letterFor(0), 'E');

// MCPS worked example: MP1 89.5 -> 90, MP2 92.3 -> 92, (90+92)/2 = 91 -> A
let s = E.semesterGrade(course(ovr({ MP1: 89.5, MP2: 92.3 })), 'S1');
eq('mcps example pct', s.pct, 91); eq('mcps example letter', s.letter, 'A');
// 89 + 90 = 89.5 -> rounds to 90 -> A
s = E.semesterGrade(course(ovr({ MP1: 89, MP2: 90 })), 'S1');
eq('89/90 -> A', s.letter, 'A');
// 89.4 + 89.4 -> 89 + 89 -> 89 -> B (rounding happens per MP first)
eq('89.4/89.4 -> B', E.semesterGrade(course(ovr({ MP1: 89.4, MP2: 89.4 })), 'S1').letter, 'B');
// A + C used to be B on the old chart; now 95 + 72 = 83.5 -> 84 -> B, but 100 + 79 = 89.5 -> A
eq('100/79 -> A', E.semesterGrade(course(ovr({ MP1: 100, MP2: 79 })), 'S1').letter, 'A');
eq('95/72 -> B', E.semesterGrade(course(ovr({ MP1: 95, MP2: 72 })), 'S1').letter, 'B');
// one MP missing -> no semester letter
eq('missing MP2', E.semesterGrade(course(ovr({ MP1: 95 })), 'S1').letter, null);
// semester 2 uses MP3 + MP4
eq('S2 80/78 -> 79 C', E.semesterGrade(course(ovr({ MP3: 80, MP4: 78 })), 'S2').letter, 'C');
eq('S2 80/79 -> 79.5 B', E.semesterGrade(course(ovr({ MP3: 80, MP4: 79 })), 'S2').letter, 'B');

// EOC 40/40/20 (IKA-RA III.B.6.f): 88, 90, exam 95 -> 35.2+36+19 = 90.2 -> A
const eocC = course(ovr({ MP3: 88, MP4: 90 }), { eoc: true, exams: { S2: 95 } });
s = E.semesterGrade(eocC, 'S2');
eq('eoc pct', s.pct, 90.2); eq('eoc letter', s.letter, 'A');
eq('eoc only in Semester B', E.hasEOC(eocC, 'S1'), false);
eq('eoc missing exam -> I', E.semesterGrade(course(ovr({ MP3: 88, MP4: 90 }), { eoc: true }), 'S2').letter, 'I');

// What MP2 do I need? MP1 = 86 -> A needs 2*89.5-86 = 93
const needs = E.secondMPNeeds(course(ovr({ MP1: 86 })), 'S1');
eq('needs A', needs.find((x) => x.letter === 'A').need, 93);
eq('needs B', needs.find((x) => x.letter === 'B').need, 73);
eq('needs D guaranteed?', needs.find((x) => x.letter === 'D').need, 33);
eq('MP1 50: A out of reach', E.secondMPNeeds(course(ovr({ MP1: 50 })), 'S1').find((x) => x.letter === 'A').need, null);

// Category weighting: tasks 80/100 (80%), practice 10/10 (100%) -> 0.9*80 + 0.1*100 = 82
let c = course({ MP1: { assignments: [
  { name: 'Test', category: 'All Tasks / Assessments', earned: 80, possible: 100 },
  { name: 'HW', category: 'Practice / Preparation', earned: 10, possible: 10 },
  { name: 'Ungraded', category: 'All Tasks / Assessments', earned: '', possible: 50 },
  { name: 'Excused', category: 'All Tasks / Assessments', earned: 0, possible: 50, excused: true },
] } });
eq('weighted mp', E.markingPeriod(c, c.mps.MP1).pct, 82);
// empty category is skipped and the rest re-scaled
c = course({ MP1: { assignments: [{ name: 'Test', category: 'All Tasks / Assessments', earned: 45, possible: 50 }] } });
eq('only tasks graded', E.markingPeriod(c, c.mps.MP1).pct, 90);
// missing counts as 0
c = course({ MP1: { assignments: [
  { name: 'Test', category: 'All Tasks / Assessments', earned: 45, possible: 50 },
  { name: 'Lab', category: 'All Tasks / Assessments', earned: '', possible: 50, missing: true },
] } });
eq('missing = 0', E.markingPeriod(c, c.mps.MP1).pct, 45);
// StudentVUE's reported % is used until a what-if edit
c.mps.MP1.reported = { letter: 'E', pct: 45.0 };
eq('reported used', E.mpPercent(c, 'MP1'), 45);
c.mps.MP1.assignments[1].removed = true;
eq('what-if overrides reported', E.mpPercent(c, 'MP1'), 90);

// Precision: StudentVUE 88.2 + our calc 88.24 -> show 88.24; disagreement -> keep StudentVUE's
c = course({ MP1: { assignments: [{ name: 'T', category: 'All Tasks / Assessments', earned: 88.24, possible: 100 }] } });
c.mps.MP1.reported = { letter: 'B', pct: 88.2 };
eq('more digits when they agree', E.mpPercent(c, 'MP1'), 88.24);
c.mps.MP1.reported = { letter: 'B', pct: 86.0 };
eq('StudentVUE wins when they differ', E.mpPercent(c, 'MP1'), 86);
c = course({ MP1: { assignments: [{ name: 'T', category: 'All Tasks / Assessments', earned: 89.46, possible: 100 }] } });
c.mps.MP1.reported = { letter: 'A', pct: 89.5 };
eq('never changes the whole-number grade', E.mpPercent(c, 'MP1'), 89.5);

// Optimizer: tasks 40/50 so far (80%); next 50-pt task needed for A (89.5) -> (x+40)/100 >= .895 -> 49.5
c = course({ MP1: { assignments: [{ name: 'Q', category: 'All Tasks / Assessments', earned: 40, possible: 50 }] } });
let r = E.needOnNext(c, c.mps.MP1, 'All Tasks / Assessments', 50, 89.5);
eq('optimizer need', Math.round(r.need * 1000) / 1000, 49.5);
r = E.needOnNext(c, c.mps.MP1, 'All Tasks / Assessments', 10, 89.5);
eq('optimizer impossible (no extra credit)', r.need, Infinity);

// GPA (IKC-RA): AP A = 5, Honors D = 1, regular B = 3
const g = E.gpa([
  { letter: 'A', credits: 0.5, course: { level: 'ap' } },
  { letter: 'D', credits: 0.5, course: { level: 'honors' } },
  { letter: 'B', credits: 0.5, course: { level: 'regular' } },
  { letter: 'A', credits: 1, course: { level: 'college' } },
]);
eq('gpa unweighted', g.unweighted, (4 * .5 + 1 * .5 + 3 * .5 + 4 * 1) / 2.5);
eq('gpa weighted', g.weighted, (5 * .5 + 1 * .5 + 3 * .5 + 5 * 1) / 2.5);
eq('cumulative', E.combineGPA({ unweighted: 4, weighted: 4.5, credits: 10 }, { unweighted: 3, weighted: 3.5, credits: 10, }).unweighted, 3.5);

// Paste parser
const pasted = parseScores(`9/15/2026\tQuiz 1\tAll Tasks / Assessments\t8 out of 10.0000\tRaw Score\t8.00 / 10.0000
9/18/2026 Homework 3 Practice / Preparation 5.00 / 5.0000
Header line without a score
Unit 2 Test 42/50
10/1/2026 Lab report All Tasks / Assessments Missing / 20`, [{ name: 'All Tasks / Assessments' }, { name: 'Practice / Preparation' }]);
eq('paste count', pasted.assignments.length, 4);
eq('paste quiz', [pasted.assignments[0].name, pasted.assignments[0].category, pasted.assignments[0].earned, pasted.assignments[0].possible], ['Quiz 1', 'All Tasks / Assessments', 8, 10]);
eq('paste hw cat', pasted.assignments[1].category, 'Practice / Preparation');
eq('paste plain', [pasted.assignments[2].name, pasted.assignments[2].earned, pasted.assignments[2].possible], ['Unit 2 Test', 42, 50]);
eq('paste date not a score', pasted.assignments[0].date, '9/15/2026');
eq('paste skipped', pasted.skipped.length, 1);

// StudentVUE JSON -> model (field names from the GradeMelon library's JSON parser)
const gb = { courses: [{ courseID: 'ENG12A', period: '2', title: 'English 12 A (ENG12A)', room: '211', staff: 'Okafor, N', staffEMail: 'n@x', marks: [{
  markName: 'MP1', calculatedScoreString: 'B', calculatedScoreRaw: '86.4',
  gradeCalculationSummary: [{ type: 'All Tasks / Assessments', weight: '90%', points: '172', pointsPossible: '200' }, { type: 'Practice / Preparation', weight: '10%', points: '9', pointsPossible: '10' }, { type: 'TOTAL', weight: '100%' }],
  assignments: [{ measure: 'Essay &amp; outline', type: 'All Tasks / Assessments', points: '86.00 / 100.0000', displayScore: '86', dueDate: '10/2/2026' },
                { measure: 'Reading log', type: 'Practice / Preparation', points: '10.0000', displayScore: 'Not Graded', dueDate: '10/9/2026' }],
}] }] };
const merged = mergeGradebook([], gb, 'MP1');
eq('merge name', merged[0].name, 'English 12 A');
eq('merge cats', merged[0].categories, [{ name: 'All Tasks / Assessments', weight: 90 }, { name: 'Practice / Preparation', weight: 10 }]);
eq('merge entity', merged[0].mps.MP1.assignments[0].name, 'Essay & outline');
eq('merge ungraded', [merged[0].mps.MP1.assignments[1].earned, merged[0].mps.MP1.assignments[1].possible], ['', 10]);
eq('merge reported', merged[0].mps.MP1.reported, { letter: 'B', pct: 86.4 });
mergeGradebook(merged, gb, 'MP2');
eq('merge same course again', merged.length, 1);
eq('mp key', [mpKeyFor('MP1', 0), mpKeyFor('Quarter 3', 2), mpKeyFor('1st Progress', 0), mpKeyFor('Fall', 1)], ['MP1', 'MP3', null, 'MP2']);
eq('levels', [guessLevel('AP Biology A'), guessLevel('Precalculus Hon A'), guessLevel('English 12 A')], ['ap', 'honors', 'regular']);

// Demo data loads and produces grades
const demo = normalize(demoData());
eq('demo courses', demo.courses.length, 7);
eq('demo has S1 letter', !!E.semesterGrade(demo.courses[0], 'S1').letter, true);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
