// node test/run.mjs — checks the grade math against the MCPS rules and examples.
import * as E from '../js/engine.js';
import { parseScores } from '../js/paste.js';
import { mergeGradebook, mpKeyFor, guessLevel, syncAll, periodInfo } from '../js/svue.js';
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
// The grade comes from the assignments by the MCPS rules; StudentVUE's number only when there are none
c.mps.MP1.reported = { letter: 'E', pct: 45.0 };
eq('calc beats reported', E.mpPercent(c, 'MP1'), 45);
c.mps.MP1.assignments[1].removed = true;
eq('what-if counts', E.mpPercent(c, 'MP1'), 90);
eq('actual ignores what-ifs', E.actualPercent(c, 'MP1'), 45);
c = course({ MP1: { assignments: [] } });
c.mps.MP1.reported = { letter: 'B', pct: 86 };
eq('reported when nothing to calculate', E.mpPercent(c, 'MP1'), 86);

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

// Interim pages: StudentVUE's MP2 page can leave out MP2 work dated before MP2 starts; it shows
// only on the MP2 Interim page. Shape of the real AP Psych case, 2026-11-24 (StudentVUE showed 91).
{
  const W = [{ type: 'All Tasks / Assessments', weight: '90%' }, { type: 'Practice / Preparation', weight: '10%' }, { type: 'TOTAL', weight: '100%' }];
  const A = (id, cat, e, p, due) => ({ gradebookID: id, measure: 'a' + id, type: cat === 'T' ? 'All Tasks / Assessments' : 'Practice / Preparation', points: `${e} / ${p}`, dueDate: due });
  const page = (name, raw, list) => ({ courses: [{ courseID: 'PSY', period: '4', title: 'AP Psychology A (PSY)', marks: [{ markName: name, calculatedScoreString: '', calculatedScoreRaw: raw, gradeCalculationSummary: W, assignments: list }] }] });
  const mp1 = [A(1, 'T', 9, 10, '10/16/2020'), A(2, 'P', 12, 12, '10/12/2020')];
  const late = [A(10, 'P', 5, 5, '10/29/2020'), A(11, 'T', 10, 10, '10/29/2020'), A(12, 'T', 5, 5, '10/27/2020'), A(13, 'P', 10, 10, '10/26/2020'), A(14, 'P', 10, 10, '10/23/2020')];
  const mp2 = [A(20, 'P', 10, 10, '11/13/2020'), A(21, 'P', 10, 10, '11/9/2020'), A(22, 'T', 11, 14, '11/6/2020'), A(23, 'T', 18, 20, '11/5/2020')];
  const periods = [['MP1 Interim', '8/25/2020', '10/2/2020'], ['MP1', '8/25/2020', '10/30/2020'], ['MP2 Interim', '10/5/2020', '12/10/2020'], ['MP2', '11/4/2020', '1/22/2021'], ['MP3', '1/26/2099', '4/9/2099']]
    .map(([gradePeriod, startDate, endDate], index) => ({ index, gradePeriod, startDate, endDate }));
  const books = { 0: page('MP1 Interim', '96', mp1), 1: page('MP1', '96', mp1), 2: page('MP2 Interim', '91', [...mp2, ...late, mp1[0]]), 3: page('MP2', '87', mp2) };
  const client = {
    login: async () => {}, schedule: async () => null, attendance: async () => null, documents: async () => [],
    gradebook: async (i) => ({ ...(i == null ? books[2] : books[i]), reportingPeriods: periods, reportingPeriod: { gradePeriod: 'MP2 Interim' } }),
  };
  const list = [];
  await syncAll(client, list);
  eq('interim-only work counted in MP2', list[0].mps.MP2.assignments.length, 9);
  eq('MP2 matches StudentVUE interim', Math.round(E.mpPercent(list[0], 'MP2') * 100) / 100, 90.82);
  eq('MP1 work not pulled into MP2', list[0].mps.MP1.assignments.length, 2);
  eq('future MP left empty', list[0].mps.MP3, undefined);
  eq('period info', [periodInfo('MP2 Interim'), periodInfo('MP3')], [{ key: 'MP2', interim: true }, { key: 'MP3', interim: false }]);
}

// Demo data loads and produces grades
const demo = normalize(demoData());
eq('demo courses', demo.courses.length, 7);
eq('demo has S1 letter', !!E.semesterGrade(demo.courses[0], 'S1').letter, true);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
