import * as E from './engine.js';
import { POLICY } from './policy.js';
import { load, save, uid, normalize, clearAll } from './store.js';
import { parseScores } from './paste.js';
import { StudentVue, syncAll } from './svue.js';
import { demoData } from './demo.js';

const SETTINGS = 'melonfork.settings';
const DEFAULT_RELAY = ''; // filled in after the relay is deployed
let data = load();
let settings = Object.assign({ relay: DEFAULT_RELAY, remember: false, username: '', password: '' }, JSON.parse(localStorage.getItem(SETTINGS) || '{}'));
let client = null;
let busy = '';

const $app = document.getElementById('app');
const MPS = ['MP1', 'MP2', 'MP3', 'MP4'];
const LEVELS = [['regular', 'Regular'], ['honors', 'Honors'], ['ap', 'AP'], ['ib', 'IB'], ['college', 'College (dual enrollment)']];
const TERMS = [['year', 'Full year'], ['S1', 'Semester 1 only'], ['S2', 'Semester 2 only']];

// ---------- helpers ----------
const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) + '%' : '—');
const n2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : '—');
const badge = (L) => `<span class="L ${L ? 'L-' + h(L[0]) : 'L-none'}">${h(L || '–')}</span>`;
const findCourse = (id) => data.courses.find((c) => c.id === id);
function persist() {
  save(data);
}
function saveSettings() {
  const s = { ...settings };
  if (!s.remember) { s.password = ''; }
  localStorage.setItem(SETTINGS, JSON.stringify(s));
}
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 2600);
}
function theme() {
  const t = data.theme === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : data.theme;
  document.documentElement.dataset.theme = t;
}
document.getElementById('theme').onclick = () => {
  const cur = document.documentElement.dataset.theme;
  data.theme = cur === 'dark' ? 'light' : 'dark';
  persist(); theme();
};

const semesterOf = (mp) => (mp === 'MP1' || mp === 'MP2' ? 'S1' : 'S2');
const inTerm = (c, sem) => c.term === 'year' || c.term === sem;
const coursesIn = (mp) => data.courses.filter((c) => inTerm(c, semesterOf(mp)));
function currentMP() {
  const now = new Date();
  const per = (data.extra && data.extra.periods) || [];
  for (const p of per) {
    const s = new Date(p.start), e = new Date(p.end);
    if (s <= now && now <= new Date(e.getTime() + 864e5)) return p.key;
  }
  // otherwise: last marking period that has any assignments
  let last = 'MP1';
  for (const m of MPS) if (data.courses.some((c) => c.mps[m] && c.mps[m].assignments.length)) last = m;
  return last;
}

// ---------- routing ----------
function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  return { page: parts[0] || '', arg: decodeURIComponent(parts[1] || ''), arg2: decodeURIComponent(parts[2] || '') };
}
function nav(page) {
  const items = [['grades', 'Grades'], ['semester', 'Semester'], ['gpa', 'GPA'], ['schedule', 'Schedule'], ['attendance', 'Attendance'], ['documents', 'Documents'], ['settings', 'Settings']];
  document.getElementById('nav').innerHTML = data.courses.length
    ? items.map(([k, v]) => `<a href="#/${k}" class="${page === k || (page === 'course' && k === 'grades') ? 'on' : ''}">${v}</a>`).join('')
    : '';
}
function render() {
  theme();
  const r = route();
  let page = r.page;
  if (!data.courses.length && !['login', 'settings', 'rules'].includes(page)) page = 'login';
  if (!page) page = 'grades';
  nav(page);
  const view = { login: viewLogin, grades: viewGrades, course: viewCourse, semester: viewSemester, gpa: viewGPA, schedule: viewSchedule, attendance: viewAttendance, documents: viewDocuments, settings: viewSettings, rules: viewRules }[page] || viewGrades;
  $app.innerHTML = view(r);
  wire(page, r);
}
addEventListener('hashchange', () => { render(); scrollTo(0, 0); });

// ---------- login ----------
function viewLogin() {
  return `<div class="login">
  <h1>MelonFork</h1>
  <p class="muted">Grades, what-ifs, semester grades and GPA for MCPS students. Your StudentVUE details go only to MCPS through your relay. Nothing is stored anywhere but this browser.</p>
  <form class="panel" id="loginForm">
    <label class="field"><span>StudentVUE username (student ID)</span><input name="u" autocomplete="username" value="${h(settings.username)}" required></label>
    <label class="field"><span>Password</span><input name="p" type="password" autocomplete="current-password" value="${h(settings.remember ? settings.password : '')}" required></label>
    <label class="row small"><input type="checkbox" name="rem" ${settings.remember ? 'checked' : ''}> Remember me on this device</label>
    ${settings.relay ? '' : `<div class="note warn small">No relay address yet. Set it in <a href="#/settings">Settings</a> first.</div>`}
    <div class="row" style="margin-top:10px"><button class="primary" ${busy ? 'disabled' : ''}>${busy ? h(busy) : 'Sign in'}</button></div>
  </form>
  <div class="row small"><button id="demo">Try with sample grades</button><button id="manual">Enter grades by hand</button><a href="#/settings">Settings</a></div>
  </div>`;
}

async function doSync(u, p) {
  client = new StudentVue(settings.relay, u, p);
  busy = 'Signing in…'; render();
  try {
    data.extra = Object.assign({}, data.extra, await syncAll(client, data.courses, (s) => { busy = s; const b = document.querySelector('#loginForm button, #syncBtn'); if (b) b.textContent = s; }));
    data.extra.lastSync = new Date().toISOString();
    data.courses = normalize(data).courses;
    persist();
    busy = '';
    toast('Grades updated from StudentVUE');
    location.hash = '#/grades';
    render();
  } catch (e) {
    busy = '';
    client = null;
    render();
    toast(e.message || String(e));
  }
}

// ---------- grades ----------
function viewGrades(r) {
  const mp = MPS.includes(r.arg) ? r.arg : currentMP();
  const sem = semesterOf(mp);
  const list = coursesIn(mp);
  const g = E.gpa(list.map((c) => ({ letter: E.mpLetter(c, mp), credits: c.credits, course: c })));
  const sg = E.gpa(data.courses.filter((c) => inTerm(c, sem)).map((c) => ({ letter: E.semesterGrade(c, sem).letter, credits: c.credits, course: c })));
  const synced = data.extra && data.extra.lastSync ? `Updated ${new Date(data.extra.lastSync).toLocaleString()}` : 'Not synced with StudentVUE';
  return `<div class="row"><h1>Grades</h1><span class="spacer"></span><span class="muted small">${h(synced)}</span>
    ${settings.username ? `<button id="syncBtn" ${busy ? 'disabled' : ''}>${busy ? h(busy) : 'Refresh'}</button>` : ''}</div>
  <div class="tabs">${MPS.map((m) => `<button data-mp="${m}" class="${m === mp ? 'on' : ''}">${m}</button>`).join('')}</div>
  <div class="stats">
    <div class="stat"><div class="k">${mp} GPA (unweighted)</div><div class="v">${n2(g.unweighted)}</div></div>
    <div class="stat"><div class="k">${mp} GPA (weighted)</div><div class="v">${n2(g.weighted)}</div></div>
    <div class="stat"><div class="k">${sem === 'S1' ? 'Semester 1' : 'Semester 2'} GPA, projected</div><div class="v">${n2(sg.unweighted)} <span class="small muted">/ ${n2(sg.weighted)} w</span></div></div>
  </div>
  <div class="cards">${list.map((c) => card(c, mp)).join('') || '<p class="muted">No courses in this marking period.</p>'}</div>
  <p class="small muted" style="margin-top:16px">Letters follow MCPS rules. <a href="#/rules">How grades are calculated</a>.</p>`;
}
function card(c, mp) {
  const m = c.mps[mp];
  const calc = E.markingPeriod(c, m);
  const L = E.mpLetter(c, mp);
  const sem = E.semesterGrade(c, semesterOf(mp));
  const rep = m.reported;
  const diff = false;
  return `<a class="card" href="#/course/${c.id}/${mp}">
    <div class="row"><div class="title">${h(c.name)}</div><span class="spacer"></span>${badge(L)}</div>
    <div class="meta">${c.period ? 'Period ' + h(c.period) + ' · ' : ''}${h(c.teacher)}${c.level !== 'regular' ? ' · ' + h(LEVELS.find((x) => x[0] === c.level)[1]) : ''}</div>
    <div class="row" style="margin-top:6px"><span class="grade">${pct(E.mpPercent(c, mp), 2)}</span>
      ${E.hasWhatIf(m) ? '<span class="pill">what-if</span>' : ''}${m.override ? '<span class="pill">set by hand</span>' : ''}
      <span class="spacer"></span><span class="small muted">Semester: ${badge(sem.letter)}</span></div>
    ${diff ? `<div class="small muted">StudentVUE shows ${h(rep.letter)}${rep.pct != null ? ' (' + pct(rep.pct) + ')' : ''}</div>` : ''}
  </a>`;
}

// ---------- course ----------
function viewCourse(r) {
  const c = findCourse(r.arg);
  if (!c) return '<p>Course not found. <a href="#/grades">Back</a></p>';
  const mp = MPS.includes(r.arg2) ? r.arg2 : currentMP();
  const m = c.mps[mp];
  const calc = E.markingPeriod(c, m);
  const L = E.mpLetter(c, mp);
  const sem = semesterOf(mp);
  const rows = m.assignments;
  const catOpts = (sel) => (c.categories.length ? c.categories : [{ name: 'Total Points' }]).map((k) => `<option ${k.name === sel ? 'selected' : ''}>${h(k.name)}</option>`).join('');
  return `<p class="small"><a href="#/grades/${mp}">← Grades</a></p>
  <div class="row"><h1 style="margin:0">${h(c.name)}</h1><span class="spacer"></span>${badge(L)}<span class="big grade">${pct(E.mpPercent(c, mp), 2)}</span></div>
  <p class="muted small">${c.period ? 'Period ' + h(c.period) + ' · ' : ''}${h(c.teacher)}${c.email ? ' · <a href="mailto:' + h(c.email) + '">' + h(c.email) + '</a>' : ''}${c.room ? ' · Room ' + h(c.room) : ''}</p>
  <div class="tabs">${MPS.filter((x) => inTerm(c, semesterOf(x))).map((x) => `<button data-cmp="${x}" class="${x === mp ? 'on' : ''}">${x}</button>`).join('')}</div>
  ${m.reported && m.reported.letter ? `<div class="note small">StudentVUE's own mark for ${mp}: <b>${h(m.reported.letter)}</b>${m.reported.pct != null ? ' (' + pct(m.reported.pct, 2) + ')' : ''}.
     ${E.hasWhatIf(m) ? 'You have what-if changes, so the grade above is MelonFork\'s calculation from the assignments.' : Number.isFinite(calc.pct) && m.reported.pct != null && Math.abs(calc.pct - m.reported.pct) >= 0.05 ? `Calculated from the assignments it's ${pct(calc.pct, 2)}. The teacher may have settings StudentVUE doesn't show (for example dropped scores), so MelonFork uses StudentVUE's number until you change something.` : ''}</div>` : ''}
  ${E.hasWhatIf(m) || m.override ? `<div class="row" style="margin-bottom:10px"><span class="pill">what-if mode</span><button data-act="reset">Undo all changes for ${mp}</button></div>` : ''}

  <div class="panel"><h2 style="margin-top:0">Categories</h2>
  <div class="table-wrap"><table><tr><th>Category</th><th>Weight</th><th>Points</th><th>Grade</th></tr>
  ${calc.rows.map((k) => `<tr><td>${h(k.name)}</td><td>${calc.weighted ? k.weight + '%' : '—'}</td><td>${n2(k.earned)} / ${n2(k.possible)}</td><td>${pct(k.pct, 2)} ${badge(E.letterFor(k.pct))}</td></tr>`).join('')}
  </table></div>
  <details class="small" style="margin-top:8px"><summary>Edit categories</summary>
    <div id="catEdit">${(c.categories.length ? c.categories : []).map((k, i) => `<div class="row" style="margin:4px 0"><input data-cat-name="${i}" value="${h(k.name)}"><input type="number" step="any" data-cat-w="${i}" value="${k.weight}">%<button data-act="delcat" data-i="${i}" class="ghost danger">✕</button></div>`).join('')}</div>
    <button data-act="addcat">Add category</button> <span class="muted">No categories = total points.</span>
  </details></div>

  <div class="panel"><div class="row"><h2 style="margin:0">Assignments</h2><span class="spacer"></span><button data-act="add">Add what-if assignment</button></div>
  <div class="table-wrap"><table>
  <tr><th>Assignment</th><th class="hide-sm">Category</th><th>Score</th><th>Out of</th><th>%</th><th></th></tr>
  ${rows.map((a) => {
    const p = E.counts(a) ? (E.earnedOf(a) / Number(a.possible)) * 100 : NaN;
    return `<tr class="${a.edited || a.custom ? 'changed' : ''} ${a.removed ? 'off' : ''}" data-id="${a.id}">
      <td>${a.custom ? `<input data-f="name" value="${h(a.name)}">` : h(a.name)}<div class="small muted">${h(a.date || '')}${a.missing ? ' · missing' : ''}${a.excused ? ' · excused' : ''}${a.notes ? ' · ' + h(a.notes) : ''}</div></td>
      <td class="hide-sm"><select data-f="category">${catOpts(a.category)}</select></td>
      <td><input type="number" step="any" data-f="earned" value="${a.earned === '' || a.earned == null ? '' : h(a.earned)}" placeholder="${a.missing ? '0' : '—'}"></td>
      <td><input type="number" step="any" data-f="possible" value="${h(a.possible)}"></td>
      <td>${pct(p)}</td>
      <td><button class="ghost" data-act="${a.removed ? 'restore' : 'del'}" title="${a.removed ? 'Bring back' : 'Leave out'}">${a.removed ? '↺' : '✕'}</button></td></tr>`;
  }).join('') || '<tr><td colspan="6" class="muted">No assignments yet.</td></tr>'}
  </table></div>
  <details style="margin-top:10px"><summary>Paste scores</summary>
    <p class="small muted">Copy the assignment list from a StudentVUE course page (or type one per line, like <code>Unit 2 Test 42/50</code>) and paste it here.</p>
    <textarea id="pasteBox" placeholder="Quiz 3  All Tasks / Assessments  18 / 20"></textarea>
    <div class="row"><button data-act="paste">Add these</button><label class="small row"><input type="checkbox" id="pasteReplace"> Replace this marking period's list</label></div>
  </details></div>

  <div class="panel"><h2 style="margin-top:0">Grade optimizer</h2>
    <p class="small muted">What do I need on the next assignment?</p>
    <div class="row">Target <select id="optL">${POLICY.letters.slice(0, -1).map((x) => `<option>${x}</option>`).join('')}</select>
      for <select id="optFor"><option value="mp">${mp}</option>${POLICY.semesters[sem][1] === mp && inTerm(c, sem) ? `<option value="sem">the semester</option>` : ''}</select>
      in <select id="optCat">${catOpts('')}</select> worth <input type="number" id="optPts" value="100" step="any"> points
      <button data-act="opt" class="primary">Calculate</button></div>
    <div id="optOut" class="note" style="display:none"></div>
  </div>

  ${semesterPanel(c, sem)}

  <div class="panel"><h2 style="margin-top:0">Course settings</h2>
    <div class="row">
      <label class="field"><span>Level</span><select data-cset="level">${LEVELS.map(([k, v]) => `<option value="${k}" ${c.level === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="field"><span>Runs</span><select data-cset="term">${TERMS.map(([k, v]) => `<option value="${k}" ${c.term === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="field"><span>Credit per semester</span><input type="number" step="0.25" data-cset="credits" value="${h(c.credits)}"></label>
      <label class="field"><span>Name</span><input data-cset="name" value="${h(c.name)}"></label>
    </div>
    <label class="row small" style="margin-bottom:10px"><input type="checkbox" data-cset="eoc" ${c.eoc ? 'checked' : ''}> Has a Maryland end-of-course exam (Biology, NSL Government): it counts 20% of the Semester B grade</label>
    <button class="danger" data-act="delcourse">Delete course</button>
  </div>`;
}

function semesterPanel(c, sem) {
  if (!inTerm(c, sem)) return '';
  const [a, b] = POLICY.semesters[sem];
  const res = E.semesterGrade(c, sem);
  const auto = (key) => { const p = E.mpPercent({ ...c, mps: { ...c.mps, [key]: { ...c.mps[key], override: '' } } }, key); return Number.isFinite(p) ? p.toFixed(2) : 'no grade'; };
  const inp = (key) => `<label class="field"><span>${key} %</span><input type="number" step="any" min="0" max="100" data-ovr="${key}" value="${h(c.mps[key].override)}" placeholder="${h(auto(key))}"></label>`;
  const exam = E.hasEOC(c, sem)
    ? `<label class="field"><span>End-of-course exam (50–100)</span><input type="number" step="any" min="50" max="100" data-exam="${sem}" value="${h(c.exams[sem] ?? '')}" placeholder="not in yet"></label>`
    : '';
  const needs = E.secondMPNeeds(c, sem);
  return `<div class="panel"><h2 style="margin-top:0">${sem === 'S1' ? 'Semester 1' : 'Semester 2'} grade</h2>
    <div class="row">${inp(a)}${inp(b)}${exam}
      <div><div class="small muted">Semester grade</div><div class="big">${badge(res.letter)} <span class="grade">${Number.isFinite(res.pct) ? roundHalf(res.pct) + '%' : ''}</span></div></div></div>
    <p class="small muted">${res.note ? h(res.note) + '. ' : ''}Type a percentage above to try a what-if. Leave it blank to use the real grade.</p>
    ${needs.length ? `<table class="small" style="max-width:460px"><tr><th>Semester grade</th><th>${b} needs (rounded)</th></tr>
      ${needs.map((x) => `<tr><td>${badge(x.letter)}</td><td>${x.need === null ? 'out of reach' : x.need === 0 ? 'guaranteed' : x.need + '% <span class="muted">(' + (x.need - 0.5) + '% or higher)</span>'}</td></tr>`).join('')}</table>` : ''}
  </div>`;
}
const roundHalf = (p) => E.roundHalfUp(p);

// ---------- semester ----------
function viewSemester(r) {
  const sem = r.arg === 'S2' ? 'S2' : (r.arg === 'S1' ? 'S1' : semesterOf(currentMP()));
  const [a, b] = POLICY.semesters[sem];
  const list = data.courses.filter((c) => inTerm(c, sem));
  const anyExam = list.some((c) => E.hasEOC(c, sem));
  const g = E.gpa(list.map((c) => ({ letter: E.semesterGrade(c, sem).letter, credits: c.credits, course: c })));
  const cell = (c, k) => { const p = E.mpPercent(c, k); return Number.isFinite(p) ? `${badge(E.letterFor(p))} ${E.roundHalfUp(p)}%` : '<span class="muted">—</span>'; };
  return `<h1>Semester grades</h1>
  <div class="tabs"><button data-sem="S1" class="${sem === 'S1' ? 'on' : ''}">Semester 1</button><button data-sem="S2" class="${sem === 'S2' ? 'on' : ''}">Semester 2</button></div>
  <div class="stats"><div class="stat"><div class="k">Semester GPA (unweighted)</div><div class="v">${n2(g.unweighted)}</div></div>
  <div class="stat"><div class="k">Semester GPA (weighted)</div><div class="v">${n2(g.weighted)}</div></div></div>
  <div class="panel table-wrap"><table><tr><th>Course</th><th>${a}</th><th>${b}</th>${anyExam ? '<th>EOC exam</th>' : ''}<th>Semester</th><th class="hide-sm">How</th><th class="hide-sm">Points</th></tr>
  ${list.map((c) => {
    const res = E.semesterGrade(c, sem);
    const gp = E.gradePoints(res.letter, c);
    return `<tr><td><a href="#/course/${c.id}/${b}">${h(c.name)}</a></td><td>${cell(c, a)}</td><td>${cell(c, b)}</td>
      ${anyExam ? `<td>${E.hasEOC(c, sem) ? h(c.exams[sem] ?? '—') : '<span class="muted small">n/a</span>'}</td>` : ''}
      <td>${badge(res.letter)}</td><td class="hide-sm small muted">${h(res.note)}</td><td class="hide-sm">${gp == null ? '—' : gp.toFixed(1)}</td></tr>`;
  }).join('')}</table></div>
  <p class="small muted">Open a course to try what-ifs. ${h(POLICY.semesterSummary)} <a href="#/rules">Full rules</a>.</p>`;
}

// ---------- GPA ----------
function viewGPA() {
  const entries = [];
  for (const sem of ['S1', 'S2']) for (const c of data.courses) if (inTerm(c, sem)) entries.push({ sem, course: c, letter: E.semesterGrade(c, sem).letter, credits: c.credits });
  const year = E.gpa(entries);
  const s1 = E.gpa(entries.filter((e) => e.sem === 'S1'));
  const cum = E.combineGPA(data.prior, year);
  return `<h1>GPA</h1>
  <div class="stats">
    <div class="stat"><div class="k">Semester 1</div><div class="v">${n2(s1.unweighted)} <span class="small muted">/ ${n2(s1.weighted)} w</span></div></div>
    <div class="stat"><div class="k">This year (projected)</div><div class="v">${n2(year.unweighted)} <span class="small muted">/ ${n2(year.weighted)} w</span></div></div>
    <div class="stat"><div class="k">Cumulative (projected)</div><div class="v">${n2(cum.unweighted)} <span class="small muted">/ ${n2(cum.weighted)} w</span></div></div>
  </div>
  <div class="panel"><h2 style="margin-top:0">Before this year</h2>
    <p class="small muted">From the transcript or last report card. Leave blank to see this year only.</p>
    <div class="row">
      <label class="field"><span>Unweighted GPA</span><input type="number" step="0.001" data-prior="unweighted" value="${h(data.prior.unweighted)}"></label>
      <label class="field"><span>Weighted GPA</span><input type="number" step="0.001" data-prior="weighted" value="${h(data.prior.weighted)}"></label>
      <label class="field"><span>Credits attempted</span><input type="number" step="0.5" data-prior="credits" value="${h(data.prior.credits)}"></label>
    </div></div>
  <div class="panel table-wrap"><table><tr><th>Semester</th><th>Course</th><th>Level</th><th>Credit</th><th>Grade</th><th>Points</th></tr>
  ${entries.map((e) => `<tr><td>${e.sem}</td><td>${h(e.course.name)}</td><td>${h(LEVELS.find((x) => x[0] === e.course.level)[1])}</td><td>${h(e.credits)}</td><td>${badge(e.letter)}</td><td>${E.gradePoints(e.letter, e.course) == null ? '—' : E.gradePoints(e.letter, e.course).toFixed(1)}</td></tr>`).join('')}
  </table></div>
  <p class="small muted">${h(POLICY.gpaSummary)} <a href="#/rules">Full rules</a>.</p>`;
}

// ---------- schedule / attendance / documents ----------
function needSync(what) {
  return `<div class="panel"><p>${what} come from StudentVUE. <a href="#/login">Sign in</a> to load them.</p></div>`;
}
function viewSchedule() {
  const s = data.extra && data.extra.schedule;
  if (!s) return `<h1>Schedule</h1>${data.extra && data.extra.scheduleError ? `<div class="note warn">${h(data.extra.scheduleError)}</div>` : ''}${needSync('Schedules')}`;
  return `<h1>Schedule</h1><p class="muted">${h(s.termName)}</p>
  <div class="panel table-wrap"><table><tr><th>Period</th><th>Course</th><th>Teacher</th><th>Room</th></tr>
  ${s.classes.map((c) => `<tr><td>${h(c.period)}</td><td>${h(c.name)}</td><td>${h(c.teacher)}</td><td>${h(c.room)}</td></tr>`).join('')}</table></div>
  ${s.terms.length ? `<h2>Terms</h2><div class="panel table-wrap"><table><tr><th>Term</th><th>Starts</th><th>Ends</th></tr>${s.terms.map((t) => `<tr><td>${h(t.name)}</td><td>${h(t.start)}</td><td>${h(t.end)}</td></tr>`).join('')}</table></div>` : ''}`;
}
function viewAttendance() {
  const a = data.extra && data.extra.attendance;
  if (!a) return `<h1>Attendance</h1>${data.extra && data.extra.attendanceError ? `<div class="note warn">${h(data.extra.attendanceError)}</div>` : ''}${needSync('Attendance records')}`;
  const max = Math.max(1, ...a.periods.map((p) => p.excused + p.unexcused + p.tardies));
  return `<h1>Attendance</h1>
  <div class="panel table-wrap"><table><tr><th>Period</th><th>Excused</th><th>Unexcused</th><th>Tardies</th><th style="width:40%"></th></tr>
  ${a.periods.map((p) => `<tr><td>${h(p.period)}</td><td>${p.excused}</td><td>${p.unexcused}</td><td>${p.tardies}</td><td><div class="bar"><i style="width:${((p.excused + p.unexcused + p.tardies) / max) * 100}%"></i></div></td></tr>`).join('')}</table></div>
  <h2>Days</h2><div class="panel table-wrap"><table><tr><th>Date</th><th>What</th><th>Periods</th></tr>
  ${a.absences.map((x) => `<tr><td>${h(x.date)}</td><td>${h(x.description || x.reason)}${x.note ? '<div class="small muted">' + h(x.note) + '</div>' : ''}</td><td class="small">${x.periods.map((p) => h(p.period + ' ' + (p.reason || p.name))).join('<br>')}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Nothing recorded.</td></tr>'}</table></div>`;
}
function viewDocuments() {
  const d = data.extra && data.extra.documents;
  if (!d) return `<h1>Documents</h1>${data.extra && data.extra.documentsError ? `<div class="note warn">${h(data.extra.documentsError)}</div>` : ''}${needSync('Report cards and documents')}`;
  return `<h1>Documents</h1>
  <div class="panel table-wrap"><table><tr><th>Date</th><th>Document</th><th></th></tr>
  ${d.map((x) => `<tr><td>${h(x.date)}</td><td>${h(x.comment || x.name)}<div class="small muted">${h(x.type)}</div></td><td><button data-doc="${h(x.gu)}">Open</button></td></tr>`).join('') || '<tr><td colspan="3" class="muted">No documents.</td></tr>'}</table></div>
  ${client ? '' : '<p class="small muted">Opening a document needs you to be signed in this session.</p>'}`;
}

// ---------- settings / rules ----------
function viewSettings() {
  return `<h1>Settings</h1>
  <div class="panel"><h2 style="margin-top:0">StudentVUE relay</h2>
    <p class="small muted">Browsers can't talk to StudentVUE directly, so MelonFork goes through a small relay (the same job GradeMelon's server does). The relay passes requests to MCPS and keeps nothing.</p>
    <label class="field"><span>Relay address</span><input id="relay" value="${h(settings.relay)}" placeholder="https://melonfork-relay.example.workers.dev"></label>
    <div class="row"><button data-act="saveRelay" class="primary">Save</button><button data-act="ping">Test</button>${settings.username ? `<button data-act="forget">Forget saved login</button>` : ''}</div>
  </div>
  <div class="panel"><h2 style="margin-top:0">Your data</h2>
    <div class="row"><button data-act="export">Download a backup</button><label class="btn">Restore a backup<input type="file" id="importFile" accept=".json" hidden></label>
    <button data-act="addcourse">Add a course by hand</button><button data-act="demo">Load sample grades</button><button data-act="clear" class="danger">Erase everything</button></div>
  </div>
  <div class="panel"><h2 style="margin-top:0">Appearance</h2>
    <select id="themeSel">${['auto', 'light', 'dark'].map((t) => `<option ${data.theme === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
  <p class="small muted"><a href="#/rules">How grades are calculated (MCPS rules and sources)</a></p>`;
}
function viewRules() {
  return `<h1>How MelonFork calculates grades</h1>
  ${POLICY.rulesHtml}
  <h2>Sources</h2><ul class="small">${POLICY.sources.map((s) => `<li><a href="${h(s.url)}" target="_blank" rel="noopener noreferrer">${h(s.title)}</a></li>`).join('')}</ul>`;
}

// ---------- events ----------
function wire(page, r) {
  const q = (s) => $app.querySelector(s);
  const qa = (s) => [...$app.querySelectorAll(s)];
  if (page === 'login') {
    const f = q('#loginForm');
    f.onsubmit = (e) => {
      e.preventDefault();
      if (!settings.relay) { toast('Set the relay address in Settings first'); return; }
      settings.username = f.u.value.trim();
      settings.remember = f.rem.checked;
      settings.password = f.p.value;
      saveSettings();
      doSync(settings.username, f.p.value);
    };
    q('#demo').onclick = () => { data = normalize(demoData()); persist(); location.hash = '#/grades'; render(); };
    q('#manual').onclick = () => { addCourse(); };
  }
  if (page === 'grades') {
    qa('[data-mp]').forEach((b) => (b.onclick = () => (location.hash = '#/grades/' + b.dataset.mp)));
    const s = q('#syncBtn');
    if (s) s.onclick = () => {
      if (client) return doSync(client.username, client.password);
      if (settings.remember && settings.password) return doSync(settings.username, settings.password);
      location.hash = '#/login';
    };
  }
  if (page === 'semester') qa('[data-sem]').forEach((b) => (b.onclick = () => (location.hash = '#/semester/' + b.dataset.sem)));
  if (page === 'gpa') qa('[data-prior]').forEach((i) => (i.onchange = () => { data.prior[i.dataset.prior] = i.value; persist(); render(); }));
  if (page === 'documents') qa('[data-doc]').forEach((b) => (b.onclick = () => openDoc(b.dataset.doc)));
  if (page === 'settings') wireSettings(q);
  if (page === 'course') wireCourse(r, q, qa);
}

function wireSettings(q) {
  $app.onclick = async (e) => {
    const act = e.target.dataset.act;
    if (!act) return;
    if (act === 'saveRelay') { settings.relay = q('#relay').value.trim().replace(/\/+$/, ''); saveSettings(); toast('Saved'); }
    if (act === 'ping') {
      const url = q('#relay').value.trim().replace(/\/+$/, '');
      try { const res = await fetch(url + '/ping'); toast(res.ok ? 'Relay is working' : 'Relay answered ' + res.status); } catch (_) { toast('Could not reach the relay'); }
    }
    if (act === 'forget') { settings.username = ''; settings.password = ''; settings.remember = false; saveSettings(); client = null; toast('Forgotten'); render(); }
    if (act === 'export') {
      const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'melonfork-backup.json'; a.click();
    }
    if (act === 'addcourse') addCourse();
    if (act === 'demo') { if (!data.courses.length || confirm('Replace your grades with sample grades?')) { data = normalize(demoData()); persist(); location.hash = '#/grades'; } }
    if (act === 'clear') { if (confirm('Erase all grades and settings from this browser?')) { clearAll(); localStorage.removeItem(SETTINGS); location.hash = '#/login'; location.reload(); } }
  };
  q('#importFile').onchange = async (e) => {
    try { data = normalize(JSON.parse(await e.target.files[0].text())); persist(); toast('Backup restored'); location.hash = '#/grades'; } catch (_) { toast('That file is not a MelonFork backup'); }
  };
  q('#themeSel').onchange = (e) => { data.theme = e.target.value; persist(); theme(); };
}

function addCourse() {
  const c = normalize({ courses: [{ name: 'New course', categories: POLICY.defaultCategories.map((k) => ({ ...k })) }] }).courses[0];
  data.courses.push(c);
  persist();
  location.hash = `#/course/${c.id}/${currentMP()}`;
}

function wireCourse(r, q, qa) {
  const c = findCourse(r.arg);
  if (!c) return;
  const mp = MPS.includes(r.arg2) ? r.arg2 : currentMP();
  const m = c.mps[mp];
  const commit = () => { persist(); render(); };
  qa('[data-cmp]').forEach((b) => (b.onclick = () => (location.hash = `#/course/${c.id}/${b.dataset.cmp}`)));

  // assignment edits (what-if)
  qa('tr[data-id] [data-f]').forEach((inp) => {
    inp.onchange = () => {
      const a = m.assignments.find((x) => x.id === inp.closest('tr').dataset.id);
      const f = inp.dataset.f;
      if (!a.custom && !a.orig) a.orig = { earned: a.earned, possible: a.possible, category: a.category, missing: a.missing };
      let v = inp.value;
      if (f === 'earned' || f === 'possible') v = v === '' ? '' : Number(v);
      a[f] = v;
      if (f === 'earned' && v !== '') a.missing = false;
      if (a.orig) {
        const o = a.orig;
        a.edited = !(String(o.earned) === String(a.earned) && String(o.possible) === String(a.possible) && o.category === a.category);
        if (!a.edited) { a.missing = o.missing; delete a.orig; }
      }
      commit();
    };
  });
  $app.onclick = (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act;
    const tr = t.closest('tr[data-id]');
    const a = tr && m.assignments.find((x) => x.id === tr.dataset.id);
    if (act === 'del') { if (a.custom) m.assignments.splice(m.assignments.indexOf(a), 1); else a.removed = true; commit(); }
    if (act === 'restore') { a.removed = false; commit(); }
    if (act === 'add') {
      m.assignments.unshift({ id: uid(), name: 'What-if assignment', category: (c.categories[0] || { name: 'Total Points' }).name, earned: '', possible: 100, custom: true });
      commit();
    }
    if (act === 'reset') {
      m.assignments = m.assignments.filter((x) => !x.custom).map((x) => {
        const y = { ...x, ...(x.orig || {}) };
        delete y.orig; delete y.edited; delete y.removed;
        return y;
      });
      m.override = '';
      commit();
    }
    if (act === 'paste') {
      const { assignments, skipped } = parseScores(q('#pasteBox').value, c.categories);
      if (!assignments.length) { toast('No scores found. Each line needs something like 18/20.'); return; }
      const added = assignments.map((x) => ({ ...x, custom: !q('#pasteReplace').checked && m.assignments.some((y) => y.from === 'svue') }));
      m.assignments = q('#pasteReplace').checked ? added : [...added, ...m.assignments];
      toast(`Added ${assignments.length} score${assignments.length > 1 ? 's' : ''}${skipped.length ? `, skipped ${skipped.length} line${skipped.length > 1 ? 's' : ''}` : ''}`);
      commit();
    }
    if (act === 'opt') {
      const L = q('#optL').value, cat = q('#optCat').value, pts = Number(q('#optPts').value);
      let target = E.minPctFor(L);
      const forSem = q('#optFor').value === 'sem';
      const out = q('#optOut');
      if (forSem) {
        const row = E.secondMPNeeds(c, semesterOf(mp)).find((x) => x.letter === L);
        out.style.display = 'block';
        if (!row || row.need === null) { out.textContent = `A semester ${L} is out of reach even with 100% in ${mp}.`; return; }
        if (row.need === 0) { out.textContent = `The semester ${L} is already guaranteed.`; return; }
        target = row.need - 0.5;
      }
      const goal = forSem ? `a semester ${L} (${mp} at ${target}% or higher)` : `a ${L} (${target}% or higher) for ${mp}`;
      const res = E.needOnNext(c, m, cat, pts, target);
      out.style.display = 'block';
      if (!res) out.textContent = 'Enter how many points the assignment is worth.';
      else if (res.need === 0) out.textContent = `You keep ${goal} even with a 0 on it (a full score would give ${mp} ${pct(res.best, 2)}).`;
      else if (res.need === Infinity || res.need > pts) out.textContent = `Not reachable with one ${pts}-point ${cat} assignment: a perfect score would give ${mp} ${pct(res.best, 2)}. You'd need more assignments, or a retake.`;
      else out.textContent = `You need at least ${(Math.ceil(res.need * 100) / 100).toFixed(2)} / ${pts} (${pct((res.need / pts) * 100)}) for ${goal}.`;
    }
    if (act === 'addcat') { c.categories.push({ name: 'New category', weight: 0 }); commit(); }
    if (act === 'delcat') { c.categories.splice(Number(t.dataset.i), 1); commit(); }
    if (act === 'delcourse') { if (confirm(`Delete ${c.name}?`)) { data.courses.splice(data.courses.indexOf(c), 1); persist(); location.hash = '#/grades'; } }
  };
  qa('[data-cat-name]').forEach((i) => (i.onchange = () => {
    const k = c.categories[Number(i.dataset.catName)];
    const old = k.name;
    k.name = i.value.trim() || old;
    for (const x of MPS) for (const a of c.mps[x].assignments) if (a.category === old) a.category = k.name;
    commit();
  }));
  qa('[data-cat-w]').forEach((i) => (i.onchange = () => { c.categories[Number(i.dataset.catW)].weight = Number(i.value) || 0; commit(); }));
  qa('[data-ovr]').forEach((s) => (s.onchange = () => { c.mps[s.dataset.ovr].override = s.value === '' ? '' : Number(s.value); commit(); }));
  qa('[data-exam]').forEach((s) => (s.onchange = () => { c.exams[s.dataset.exam] = s.value === '' ? '' : Math.min(100, Math.max(50, Number(s.value))); commit(); }));
  qa('[data-cset]').forEach((s) => (s.onchange = () => {
    const k = s.dataset.cset;
    c[k] = k === 'credits' ? Number(s.value) || 0 : k === 'eoc' ? s.checked : s.value;
    if (k === 'level' && s.value === 'college' && c.credits === 0.5) c.credits = 1; // dual credit = 1 credit
    commit();
  }));
}

async function openDoc(gu) {
  if (!client) {
    if (settings.remember && settings.password) client = new StudentVue(settings.relay, settings.username, settings.password);
    else { toast('Sign in first to open documents'); location.hash = '#/login'; return; }
  }
  try {
    toast('Opening…');
    const files = await client.documentContent(gu);
    if (!files.length) { toast('Document is empty'); return; }
    const bin = atob(files[0].base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url; a.download = files[0].name || 'document.pdf'; a.click();
  } catch (e) { toast(e.message); }
}

render();
