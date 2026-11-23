// MCPS high school grading rules, 2026-27. Every number here comes from the sources listed
// at the bottom (MCPS Regulation IKA-RA rev. Oct 9 2026, IKC-RA, 2026-27 HS Course Bulletin).

// Half-up rounding to a whole percent, as Synergy does ("89.5% … rounds up to 90%").
export const roundHalfUp = (x) => Math.floor(Math.round(x * 1e6) / 1e6 + 0.5);

export const POLICY = {
  letters: ['A', 'B', 'C', 'D', 'E'],
  // IKA-RA III.B.6.c: A 89.5-100, B 79.5-89.4, C 69.5-79.4, D 59.5-69.4, E 0-59.4
  cutoffs: [['A', 89.5], ['B', 79.5], ['C', 69.5], ['D', 59.5], ['E', -Infinity]],
  semesters: { S1: ['MP1', 'MP2'], S2: ['MP3', 'MP4'] },
  // IKA-RA III.E.6.a: practice/preparation homework is at most 10% of the MP grade.
  defaultCategories: [{ name: 'All Tasks / Assessments', weight: 90 }, { name: 'Practice / Preparation', weight: 10 }],
  extraCredit: false, // IKA-RA III.E.8.a prohibits extra credit and bonus points
  points: { A: 4, B: 3, C: 2, D: 1, E: 0 },
  // IKC-RA II.G + bulletin: +1 for A, B, C in Honors, AL, AP, IB; dual-credit college courses count as advanced level.
  weightedLevels: ['honors', 'ap', 'ib', 'college'],
  weightBonus: 1,
  weightBonusLetters: ['A', 'B', 'C'],
  eocWeight: 0.2, // IKA-RA III.B.6.f: MSDE end-of-course exam = 20%, each MP 40%
  semesterSummary: 'Semester grade = average of the two marking-period percentages (each rounded to a whole number first), rounded half up. Courses with a state end-of-course exam: 40% / 40% / exam 20%.',
  gpaSummary: 'GPA uses semester (final) grades only. A=4, B=3, C=2, D=1, E=0; Honors, AP, IB and Montgomery College dual-credit courses add 1 point to A, B and C. Each course is weighted by its credit (0.5 per semester; 1.0 for double-period and dual-credit courses).',
  sources: [
    { title: 'MCPS Regulation IKA-RA, Grading and Reporting (revised Oct 9, 2026)', url: 'https://ww2.montgomeryschoolsmd.org/departments/policy/detail.aspx?recID=224&policyID=IKA-RA&sectionID=9' },
    { title: 'IKA-RA full text (PDF)', url: 'https://ww2.montgomeryschoolsmd.org/departments/policy/pdf/260113%20ika-ra%20final.pdf' },
    { title: 'Changes to IKA-RA beginning in the 2026-2027 school year (family handout)', url: 'https://www.montgomeryschoolsmd.org/siteassets/district/parents/family-resources/grading.pdf' },
    { title: 'MCPS Regulation IKC-RA, Grade Point Averages', url: 'https://ww2.montgomeryschoolsmd.org/departments/policy/pdf/ikcra.pdf' },
    { title: '2026-27 MCPS High School Course Bulletin', url: 'https://www.montgomeryschoolsmd.org/siteassets/district/curriculum/coursebulletin/2026-27/0468.26_202627_hs_coursebulletin-v08-2026.pdf' },
    { title: 'MCPS secondary grading FAQ (missing marking-period grades, rounding)', url: 'https://www.montgomeryschoolsmd.org/siteassets/district/curriculum/grading-and-reporting/sec-grading-and-reporting-faq.pdf' },
    { title: 'MCPS news, Dec 2025: how semester grades are calculated (worked example)', url: 'https://www.montgomeryschoolsmd.org/news/mcps-news/2025/12/secondary-student-grading/' },
    { title: 'MCPS 2026-27 traditional calendar (marking period end dates)', url: 'https://ww2.montgomeryschoolsmd.org/calendar/pdfs/2026-2027/2026-2027-TRADITIONAL-Calendar.pdf' },
    { title: 'MCPS Form 280-93, dual enrollment credit', url: 'https://www.montgomeryschoolsmd.org/departments/forms/pdf/280-93.pdf' },
  ],
  rulesHtml: `
  <div class="panel">
  <h2 style="margin-top:0">Marking period grade</h2>
  <p>Each category's grade is points earned ÷ points possible. Categories are combined by their weights. A category with nothing graded yet is left out and the others are scaled up, which is what StudentVUE does. Most MCPS courses use <b>All Tasks / Assessments</b> and <b>Practice / Preparation</b>. Practice / Preparation can be at most 10%, and each course team sets the exact split, so MelonFork uses the weights StudentVUE reports.</p>
  <p>Missing work counts as 0. Excused work is left out. Extra credit isn't allowed in MCPS, so the optimizer never assumes more than full marks.</p>
  <h2>Letters</h2>
  <table class="matrix small" style="max-width:420px"><tr><th>A</th><th>B</th><th>C</th><th>D</th><th>E</th></tr>
  <tr><td>89.5–100</td><td>79.5–89.4</td><td>69.5–79.4</td><td>59.5–69.4</td><td>0–59.4</td></tr></table>
  <p>Percentages round half up to a whole number, so 89.5% becomes 90% (an A) and 89.4% stays a B.</p>
  <h2>Semester grade</h2>
  <p>Since 2025-26 MCPS no longer uses a letter-grade chart. Each marking period counts equally. The semester grade is the average of the two marking-period percentages, each rounded to a whole number first, and then rounded half up again.</p>
  <p class="note">Example from MCPS: MP1 89.5% → 90, MP2 92.3% → 92. (90 + 92) ÷ 2 = 91, so the semester grade is an A. And 89 + 90 = 179, ÷ 2 = 89.5, which rounds to 90, also an A.</p>
  <p>Courses with a Maryland end-of-course exam (Biology, NSL Government) count each marking period 40% and the exam 20% in Semester B. Turn this on in the course's settings if it applies. If a marking period has no grade, a semester course shows M (missing) until the teacher posts one.</p>
  <h2>GPA</h2>
  <p>Only semester (final) grades count. Marking-period GPAs are shown for your information but aren't part of the official GPA. Unweighted: A 4, B 3, C 2, D 1, E 0. Weighted: Honors, AP, IB and Montgomery College dual-credit courses add 1 to A, B and C (so A 5, B 4, C 3, D 1, E 0). Each semester course is 0.5 credit. Double-period courses and dual-credit college courses are 1.0. GPAs are rounded to two decimals.</p>
  <h2>Retakes and late work (for what-ifs)</h2>
  <p>A reassessment replaces the original score only if it's higher. Late work handed in by the final deadline can lose at most 10%. Work that shows progress can't be graded below 50%. No single assignment can be more than 20% of a marking period grade.</p>
  <h2>Wootton</h2>
  <p>Wootton follows the district regulation. Its 2026-27 handbook was still "coming soon" when MelonFork was built, and there's no separate Wootton grading policy, so each course's syllabus has the exact category split.</p>
  </div>`,
};
