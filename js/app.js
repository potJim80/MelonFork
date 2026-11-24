import * as E from './engine.js';
import { POLICY } from './policy.js';
import { load, save, uid, normalize, clearAll } from './store.js';
import { parseScores } from './paste.js';
import { StudentVue, syncAll } from './svue.js';
import { demoData } from './demo.js';

const SETTINGS = 'melonfork.settings';
const DEFAULT_RELAY = 'https://melonfork-relay.akbarinmahdi.workers.dev';
let data = load();
let settings = Object.assign({ relay: DEFAULT_RELAY, remember: false, username: '', password: '' }, JSON.parse(localStorage.getItem(SETTINGS) || '{}'));
if (!settings.relay) settings.relay = DEFAULT_RELAY;
let client = null;
let busy = '';

const $app = document.getElementById('app');
const MPS = ['MP1', 'MP2', 'MP3', 'MP4'];
const LEVELS = [['regular', 'Regular'], ['honors', 'Honors'], ['ap', 'AP'], ['ib', 'IB'], ['college', 'College (dual enrollment)']];
const TERMS = [['year', 'Full year'], ['S1', 'Semester 1 only'], ['S2', 'Semester 2 only']];

// ---------- helpers ----------
const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) + '%' : '—');
const n2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : '—');
const lk = (L) => (L && 'ABCDE'.includes(L[0]) ? L[0] : 'none');
const badge = (L, size = '') => `<span class="L ${size} L-${L === 'I' ? 'I' : lk(L)}">${h(L || '–')}</span>`;
const findCourse = (id) => data.courses.find((c) => c.id === id);
const levelName = (c) => (LEVELS.find((x) => x[0] === c.level) || LEVELS[0])[1];
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
  let last = 'MP1';
  for (const m of MPS) if (data.courses.some((c) => c.mps[m] && c.mps[m].assignments.length)) last = m;
  return last;
}
const semGPA = (sem) => E.gpa(data.courses.filter((c) => inTerm(c, sem)).map((c) => ({ letter: E.semesterGrade(c, sem).letter, credits: c.credits, course: c })));

// ---------- icons (stroke, 24px grid) ----------
const ICON = {
  grades: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  semester: '<path d="M4 19V5"/><path d="M4 19h16"/><path d="M8 15l4-5 3 3 5-6"/>',
  gpa: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M7 10.5V16c0 1.5 2.2 3 5 3s5-1.5 5-3v-5.5"/>',
  schedule: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h1"/><path d="M3 12h1"/><path d="M3 18h1"/>',
  attendance: '<rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9.5h18"/><path d="M8 2.5v4"/><path d="M16 2.5v4"/>',
  documents: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6"/><path d="M9 17h6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  x: '<path d="M18 6L6 18"/><path d="M6 6l12 12"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
};
const ico = (k, s = 20) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;

// ---------- routing ----------
function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  return { page: parts[0] || '', arg: decodeURIComponent(parts[1] || ''), arg2: decodeURIComponent(parts[2] || '') };
}
function nav(page) {
  const items = [['grades', 'Grades'], ['semester', 'Semester'], ['gpa', 'GPA'], ['schedule', 'Schedule'], ['attendance', 'Attendance'], ['documents', 'Documents'], ['sep'], ['settings', 'Settings']];
  document.getElementById('nav').innerHTML = items.map(([k, v]) => k === 'sep' ? '<div class="sep"></div>'
    : `<a href="#/${k}" class="${page === k || (page === 'course' && k === 'grades') || (page === 'rules' && k === 'settings') ? 'on' : ''} n-${k}"${page === k ? ' aria-current="page"' : ''}>${ico(k)}<span>${v}</span></a>`).join('');
}
function render() {
  theme();
  const r = route();
  let page = r.page;
  if (!data.courses.length && !['login', 'settings', 'rules'].includes(page)) page = 'login';
  if (!page) page = 'grades';
  document.body.classList.toggle('bare', page === 'login');
  nav(page);
  const view = { login: viewLogin, grades: viewGrades, course: viewCourse, semester: viewSemester, gpa: viewGPA, schedule: viewSchedule, attendance: viewAttendance, documents: viewDocuments, settings: viewSettings, rules: viewRules }[page] || viewGrades;
  $app.innerHTML = view(r);
  wire(page, r);
}
addEventListener('hashchange', () => { render(); scrollTo(0, 0); });

// ---------- sign in ----------
function viewLogin() {
  return `<div class="login">
  <div class="brand"><img src="icon.svg" alt="" width="36" height="36"> MelonFork</div>
  <form id="loginForm">
    <h1>Sign in with StudentVUE</h1>
    <label class="f">Student ID<input name="u" autocomplete="username" inputmode="numeric" value="${h(settings.username)}" required></label>
    <label class="f">Password<input name="p" type="password" autocomplete="current-password" value="${h(settings.remember ? settings.password : '')}" required></label>
    <label class="check"><input type="checkbox" name="rem" ${settings.remember ? 'checked' : ''}> Remember me</label>
    <button class="primary" ${busy ? 'disabled' : ''}>${busy ? h(busy) : 'Sign in'}</button>
    <button type="button" id="demo">Try sample grades</button>
  </form>
  <div class="row small">${data.courses.length ? '<a href="#/grades">Back to grades</a>' : '<a href="#" id="manual">Enter grades by hand</a>'}</div>
  </div>`;
}

async function doSync(u, p) {
  client = new StudentVue(settings.relay, u, p);
  busy = 'Signing in…'; render();
  try {
    data.extra = Object.assign({}, data.extra, await syncAll(client, data.courses, (s) => { busy = s; const b = document.querySelector('#loginForm button.primary, #syncBtn .lbl'); if (b) b.textContent = s; }));
    data.extra.lastSync = new Date().toISOString();
    delete data.extra.demo;
    data.courses = normalize(data).courses;
    persist();
    busy = '';
    toast('Grades updated');
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
function syncedLabel() {
  if (data.extra && data.extra.demo) return 'Sample grades';
  if (!(data.extra && data.extra.lastSync)) return 'Entered by hand';
  const d = new Date(data.extra.lastSync);
  const today = d.toDateString() === new Date().toDateString();
  return 'Updated ' + (today ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' }));
}
function viewGrades(r) {
  const mp = MPS.includes(r.arg) ? r.arg : currentMP();
  const sem = semesterOf(mp);
  const list = coursesIn(mp);
  const g = E.gpa(list.map((c) => ({ letter: E.mpLetter(c, mp), credits: c.credits, course: c })));
  const sg = semGPA(sem);
  const cum = E.combineGPA(data.prior, E.gpa(['S1', 'S2'].flatMap((s) => data.courses.filter((c) => inTerm(c, s)).map((c) => ({ letter: E.semesterGrade(c, s).letter, credits: c.credits, course: c })))));
  const hasPrior = Number(data.prior.credits) > 0;
  return `<div class="head"><div class="t"><span class="sub">${h(syncedLabel())}</span><h1>Grades</h1></div>
    <div class="seg" role="group" aria-label="Marking period">${MPS.map((m) => `<button data-mp="${m}" class="${m === mp ? 'on' : ''}" aria-pressed="${m === mp}">${m}</button>`).join('')}</div>
    ${settings.username ? `<button id="syncBtn" class="primary" ${busy ? 'disabled' : ''}>${ico('refresh', 18)}<span class="lbl">${busy ? h(busy) : 'Refresh'}</span></button>` : ''}</div>
  <div class="tiles">
    <div class="tile"><span class="k">${sem === 'S1' ? 'Semester 1' : 'Semester 2'} GPA</span><span class="v">${n2(sg.unweighted)}</span><span class="s">Weighted <b>${n2(sg.weighted)}</b></span></div>
    <div class="tile"><span class="k">${mp} GPA</span><span class="v">${n2(g.unweighted)}</span><span class="s">Weighted <b>${n2(g.weighted)}</b></span></div>
    ${hasPrior ? `<div class="tile opt"><span class="k">Cumulative</span><span class="v">${n2(cum.unweighted)}</span><span class="s">Weighted <b>${n2(cum.weighted)}</b></span></div>` : ''}
  </div>
  <div class="cards">${list.map((c) => card(c, mp)).join('') || '<div class="panel empty">No courses this marking period.</div>'}</div>`;
}
function card(c, mp) {
  const m = c.mps[mp];
  const p = E.mpPercent(c, mp);
  const L = E.mpLetter(c, mp);
  const sem = E.semesterGrade(c, semesterOf(mp));
  return `<a class="card" href="#/course/${c.id}/${mp}">
    <div class="top">${badge(L, 'big')}
      <div class="nm"><b>${h(c.name)}</b><span>${c.period ? 'Period ' + h(c.period) + ' · ' : ''}${h(c.teacher)}</span></div>
      <span class="p">${pct(p)}</span></div>
    <div class="prog"><i class="bg-${lk(L)}" style="width:${Number.isFinite(p) ? Math.max(0, Math.min(100, p)) : 0}%"></i></div>
    <div class="foot">Semester ${badge(sem.letter)}${E.hasWhatIf(m) || m.override ? '<span class="tag edit">what-if</span>' : ''}<span class="spacer"></span>${c.level !== 'regular' ? h(levelName(c)) : ''}</div>
  </a>`;
}

// ---------- course ----------
function viewCourse(r) {
  const c = findCourse(r.arg);
  if (!c) return '<div class="panel empty">Course not found. <a href="#/grades">Back to grades</a></div>';
  const mp = MPS.includes(r.arg2) ? r.arg2 : currentMP();
  const m = c.mps[mp];
  const calc = E.markingPeriod(c, m);
  const L = E.mpLetter(c, mp);
  const sem = semesterOf(mp);
  const whatIf = E.hasWhatIf(m) || m.override !== '';
  const cats = c.categories.length ? c.categories : [{ name: 'Total Points' }];
  const catOpts = (sel) => cats.map((k) => `<option ${k.name === sel ? 'selected' : ''}>${h(k.name)}</option>`).join('');
  const actual = E.actualPercent(c, mp);
  const rep = Number.isFinite(actual) ? `Actual ${pct(actual)}` : '';
  const mpTabs = MPS.filter((x) => inTerm(c, semesterOf(x))).map((x) => {
    const xp = E.mpPercent(c, x);
    return `<button data-cmp="${x}" class="${x === mp ? 'on' : ''}" aria-pressed="${x === mp}">${x}${x !== mp && Number.isFinite(xp) ? '<span class="hide-sm"> · ' + pct(xp) + '</span>' : ''}</button>`;
  }).join('');
  return `<a href="#/grades/${mp}" class="row small" style="font-weight:700;text-decoration:none;min-height:32px">${ico('back', 16)} All grades</a>
  <section class="panel ch">
    ${badge(L, 'xl')}
    <div class="nm"><h1>${h(c.name)}</h1><span class="muted">${c.period ? 'Period ' + h(c.period) + ' · ' : ''}${h(c.teacher)}${c.level !== 'regular' ? ' · ' + h(levelName(c)) : ''}</span></div>
    <div class="pp"><b>${pct(E.mpPercent(c, mp))}</b>${whatIf && rep ? `<span class="small muted">${h(rep)}</span>` : ''}</div>
    <div class="bar"><div class="seg" role="group" aria-label="Marking period">${mpTabs}</div>
      ${whatIf ? `<button class="soft" data-act="reset">${ico('undo', 16)} Undo what-ifs</button>` : ''}</div>
  </section>

  <div class="cols">
    <div class="main">
      <section class="panel flush" aria-label="Assignments">
        <div class="bar-h"><h2>Assignments</h2><button class="primary" data-act="add">${ico('plus', 16)} Add what-if</button></div>
        <div class="scroll"><table>
          <thead><tr><th>Assignment</th><th class="hide-sm">Category</th><th>Score</th><th>Grade</th><th><span class="muted" style="position:absolute;left:-9999px">Leave out</span></th></tr></thead>
          <tbody>${m.assignments.map((a) => row(a, catOpts)).join('') || '<tr><td colspan="5" class="empty">No assignments yet.</td></tr>'}</tbody>
        </table></div>
        <details style="padding:12px 20px 16px;border-top:1px solid var(--line2)"><summary>Paste scores</summary>
          <div style="display:flex;flex-direction:column;gap:10px;margin-top:8px">
            <textarea id="pasteBox" placeholder="Unit 2 Test   42/50"></textarea>
            <div class="row"><button data-act="paste">Add</button><label class="row small"><input type="checkbox" id="pasteReplace"> Replace this list</label></div>
          </div>
        </details>
      </section>
    </div>

    <div class="aside">
      <section class="panel" aria-label="Categories"><h2>Categories</h2>
        ${calc.rows.map((k) => `<div class="cat"><div class="l"><b>${h(k.name)}</b>${calc.weighted ? `<span class="muted">${k.weight}%</span>` : ''}<b class="num">${pct(k.pct)}</b></div>
          <div class="prog b8"><i class="bg-${lk(E.letterFor(k.pct))}" style="width:${Number.isFinite(k.pct) ? Math.min(100, k.pct) : 0}%"></i></div>
          <span class="small muted num">${+k.earned.toFixed(2)} / ${+k.possible.toFixed(2)} points</span></div>`).join('')}
      </section>

      <section class="panel" aria-label="Score needed"><h2>Score needed</h2>
        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">
          <label class="f">Goal<select id="optGoal">${POLICY.letters.slice(0, -1).map((x) => `<option value="mp:${x}">${x} for ${mp}</option>`).join('')}${POLICY.semesters[sem][1] === mp && inTerm(c, sem) ? POLICY.letters.slice(0, -1).map((x) => `<option value="sem:${x}" ${x === 'A' ? 'selected' : ''}>Semester ${x}</option>`).join('') : ''}</select></label>
          <label class="f">Category<select id="optCat">${catOpts('')}</select></label>
          <label class="f">Worth (points)<input type="number" id="optPts" value="100" step="any" style="width:100%;text-align:left"></label>
        </div>
        <p class="result" id="optOut"></p>
      </section>

      ${semesterPanel(c, sem)}

      <section class="panel"><details><summary>Course settings</summary>
        <div style="display:flex;flex-direction:column;gap:12px;margin-top:10px">
          <label class="f">Name<input data-cset="name" value="${h(c.name)}"></label>
          <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">
            <label class="f">Level<select data-cset="level">${LEVELS.map(([k, v]) => `<option value="${k}" ${c.level === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
            <label class="f">Runs<select data-cset="term">${TERMS.map(([k, v]) => `<option value="${k}" ${c.term === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
            <label class="f">Credit per semester<input type="number" step="0.25" data-cset="credits" value="${h(c.credits)}" style="width:100%;text-align:left"></label>
          </div>
          <label class="row small"><input type="checkbox" data-cset="eoc" ${c.eoc ? 'checked' : ''}> State end-of-course exam (20% of Semester B)</label>
          <div class="f">Categories${(c.categories || []).map((k, i) => `<div class="row" style="flex-wrap:nowrap"><input data-cat-name="${i}" value="${h(k.name)}" style="flex:1;min-width:0"><input type="number" step="any" data-cat-w="${i}" value="${k.weight}"><span>%</span><button class="icon" data-act="delcat" data-i="${i}" aria-label="Remove ${h(k.name)}">${ico('x', 16)}</button></div>`).join('')}
            <button data-act="addcat" style="align-self:flex-start">${ico('plus', 16)} Category</button></div>
          <button class="danger" data-act="delcourse" style="align-self:flex-start">Delete course</button>
        </div></details></section>
    </div>
  </div>`;
}
function row(a, catOpts) {
  const p = E.counts(a) ? (E.earnedOf(a) / Number(a.possible)) * 100 : NaN;
  const sub = [a.date, a.missing ? 'Missing' : '', a.excused ? 'Excused' : '', a.edited && a.orig ? `was ${a.orig.earned === '' || a.orig.earned == null ? '—' : a.orig.earned}` : '', a.custom ? 'what-if' : ''].filter(Boolean).join(' · ');
  return `<tr class="${a.edited || a.custom ? 'changed' : ''} ${a.removed ? 'off' : ''}" data-id="${a.id}">
    <td>${a.custom ? `<input data-f="name" value="${h(a.name)}" aria-label="Assignment name" style="width:100%;max-width:220px">` : `<b>${h(a.name)}</b>`}<div class="sub">${h(sub)}</div></td>
    <td class="hide-sm"><select data-f="category" aria-label="Category">${catOpts(a.category)}</select></td>
    <td style="white-space:nowrap"><input type="number" step="any" data-f="earned" aria-label="Score" value="${a.earned === '' || a.earned == null ? '' : h(a.earned)}" placeholder="${a.missing ? '0' : '—'}"> <span class="muted">/</span> ${a.custom ? `<input type="number" step="any" data-f="possible" aria-label="Out of" value="${h(a.possible)}">` : `<span class="muted num">${h(+Number(a.possible).toFixed(2))}</span>`}</td>
    <td class="num" style="font-weight:800"><span class="t-${lk(E.letterFor(p))}">${pct(p)}</span></td>
    <td style="text-align:right"><button class="icon" data-act="${a.removed ? 'restore' : 'del'}" aria-label="${a.removed ? 'Bring back' : 'Leave out'} ${h(a.name)}">${ico(a.removed ? 'undo' : 'x', 16)}</button></td></tr>`;
}

function semesterPanel(c, sem) {
  if (!inTerm(c, sem)) return '';
  const [a, b] = POLICY.semesters[sem];
  const res = E.semesterGrade(c, sem);
  const auto = (key) => { const p = E.mpPercent({ ...c, mps: { ...c.mps, [key]: { ...c.mps[key], override: '' } } }, key); return Number.isFinite(p) ? p.toFixed(2) : '—'; };
  const inp = (key) => `<label class="f">${key}<input type="number" step="any" min="0" max="100" data-ovr="${key}" value="${h(c.mps[key].override)}" placeholder="${h(auto(key))}" style="width:84px"></label>`;
  const exam = E.hasEOC(c, sem) ? `<label class="f">Exam<input type="number" step="any" min="50" max="100" data-exam="${sem}" value="${h(c.exams[sem] ?? '')}" placeholder="—" style="width:72px"></label>` : '';
  const needs = E.secondMPNeeds(c, sem);
  return `<section class="panel" aria-label="${sem === 'S1' ? 'Semester 1' : 'Semester 2'}">
    <div class="row"><h2 class="spacer">${sem === 'S1' ? 'Semester 1' : 'Semester 2'}</h2>${Number.isFinite(res.pct) ? `<span class="num muted">${pct(res.pct)}</span>` : ''}${badge(res.letter, 'big')}</div>
    <div class="row" style="align-items:flex-end">${inp(a)}${inp(b)}${exam}</div>
    ${needs.length ? `<table class="need"><caption style="text-align:left;font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;padding-bottom:4px">${b} needed</caption>
      ${needs.map((x) => `<tr><td><b class="t-${x.letter}">${x.letter}</b></td><td style="text-align:right" class="num">${x.need === null ? '<span class="muted">out of reach</span>' : x.need === 0 ? '<span class="muted">locked in</span>' : '<b>' + pct(x.need - 0.5) + '</b>'}</td></tr>`).join('')}</table>` : ''}
  </section>`;
}

// ---------- semester ----------
function viewSemester(r) {
  const sem = r.arg === 'S2' ? 'S2' : (r.arg === 'S1' ? 'S1' : semesterOf(currentMP()));
  const [a, b] = POLICY.semesters[sem];
  const list = data.courses.filter((c) => inTerm(c, sem));
  const anyExam = list.some((c) => E.hasEOC(c, sem));
  const g = semGPA(sem);
  const cell = (c, k) => { const p = E.mpPercent(c, k); return Number.isFinite(p) ? `<b class="t-${lk(E.letterFor(p))}">${E.letterFor(p)}</b> <span class="muted">${pct(p)}</span>` : '<span class="muted">—</span>'; };
  return `<div class="head"><div class="t"><h1>Semester grades</h1></div>
    <div class="seg" role="group" aria-label="Semester"><button data-sem="S1" class="${sem === 'S1' ? 'on' : ''}">Semester 1</button><button data-sem="S2" class="${sem === 'S2' ? 'on' : ''}">Semester 2</button></div></div>
  <div class="tiles">
    <div class="tile"><span class="k">Semester GPA</span><span class="v">${n2(g.unweighted)}</span><span class="s">${g.credits ? g.credits + (g.credits === 1 ? ' credit' : ' credits') : ''}</span></div>
    <div class="tile"><span class="k">Weighted</span><span class="v">${n2(g.weighted)}</span><span class="s">Honors, AP, IB +1</span></div>
  </div>
  <section class="panel flush"><div class="scroll"><table>
    <thead><tr><th>Course</th><th>${a}</th><th>${b}</th>${anyExam ? '<th>Exam</th>' : ''}<th>Semester</th><th class="hide-sm" style="text-align:right">Points</th></tr></thead>
    <tbody>${list.map((c) => {
      const res = E.semesterGrade(c, sem);
      const gp = E.gradePoints(res.letter, c);
      return `<tr><td><a href="#/course/${c.id}/${b}" style="color:var(--ink);text-decoration:none"><b>${h(c.name)}</b></a><div class="sub">${h(levelName(c))}</div></td><td>${cell(c, a)}</td><td>${cell(c, b)}</td>
        ${anyExam ? `<td>${E.hasEOC(c, sem) ? h(c.exams[sem] ?? '—') : '<span class="muted">—</span>'}</td>` : ''}
        <td style="white-space:nowrap">${badge(res.letter)} <span class="muted num">${Number.isFinite(res.pct) ? pct(res.pct) : ''}</span></td><td class="hide-sm num" style="text-align:right;font-weight:700">${gp == null ? '—' : gp.toFixed(1)}</td></tr>`;
    }).join('') || '<tr><td colspan="6" class="empty">No courses this semester.</td></tr>'}</tbody></table></div></section>`;
}

// ---------- GPA ----------
function viewGPA() {
  const entries = [];
  for (const sem of ['S1', 'S2']) for (const c of data.courses) if (inTerm(c, sem)) entries.push({ sem, course: c, letter: E.semesterGrade(c, sem).letter, credits: c.credits });
  const year = E.gpa(entries);
  const s1 = E.gpa(entries.filter((e) => e.sem === 'S1'));
  const cum = E.combineGPA(data.prior, year);
  return `<div class="head"><div class="t"><h1>GPA</h1></div></div>
  <div class="tiles">
    <div class="tile"><span class="k">Semester 1</span><span class="v">${n2(s1.unweighted)}</span><span class="s">Weighted <b>${n2(s1.weighted)}</b></span></div>
    <div class="tile"><span class="k">This year</span><span class="v">${n2(year.unweighted)}</span><span class="s">Weighted <b>${n2(year.weighted)}</b></span></div>
    <div class="tile"><span class="k">Cumulative</span><span class="v">${n2(cum.unweighted)}</span><span class="s">Weighted <b>${n2(cum.weighted)}</b></span></div>
  </div>
  <section class="panel"><h2>Before this year</h2>
    <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;max-width:480px">
      <label class="f">Unweighted<input type="number" step="0.001" data-prior="unweighted" value="${h(data.prior.unweighted)}" style="width:100%;text-align:left"></label>
      <label class="f">Weighted<input type="number" step="0.001" data-prior="weighted" value="${h(data.prior.weighted)}" style="width:100%;text-align:left"></label>
      <label class="f">Credits<input type="number" step="0.5" data-prior="credits" value="${h(data.prior.credits)}" style="width:100%;text-align:left"></label>
    </div></section>
  <section class="panel flush"><div class="scroll"><table>
    <thead><tr><th>Course</th><th>Semester</th><th class="hide-sm">Credit</th><th>Grade</th><th style="text-align:right">Points</th></tr></thead>
    <tbody>${entries.map((e) => { const gp = E.gradePoints(e.letter, e.course); return `<tr><td><b>${h(e.course.name)}</b><div class="sub">${h(levelName(e.course))}</div></td><td>${e.sem === 'S1' ? '1' : '2'}</td><td class="hide-sm num">${h(e.credits)}</td><td>${badge(e.letter)}</td><td class="num" style="text-align:right;font-weight:700">${gp == null ? '—' : gp.toFixed(1)}</td></tr>`; }).join('')}</tbody>
  </table></div></section>`;
}

// ---------- schedule / attendance / documents ----------
function needSync(title, err) {
  return `<div class="head"><div class="t"><h1>${title}</h1></div></div>
  <section class="panel">${err ? `<span class="muted">${h(err)}</span>` : ''}<div class="row"><span class="spacer muted">Sign in to load this from StudentVUE.</span><a class="btn primary" href="#/login">Sign in</a></div></section>`;
}
function viewSchedule() {
  const s = data.extra && data.extra.schedule;
  if (!s) return needSync('Schedule', data.extra && data.extra.scheduleError);
  return `<div class="head"><div class="t">${s.termName ? `<span class="sub">${h(s.termName)}</span>` : ''}<h1>Schedule</h1></div></div>
  <section class="panel flush"><div class="scroll"><table><thead><tr><th>Period</th><th>Course</th><th>Teacher</th><th class="hide-sm">Room</th></tr></thead>
  <tbody>${s.classes.map((c) => `<tr><td class="num"><b>${h(c.period)}</b></td><td><b>${h(c.name)}</b></td><td>${h(c.teacher)}</td><td class="hide-sm">${h(c.room)}</td></tr>`).join('')}</tbody></table></div></section>`;
}
function viewAttendance() {
  const a = data.extra && data.extra.attendance;
  if (!a) return needSync('Attendance', data.extra && data.extra.attendanceError);
  const max = Math.max(1, ...a.periods.map((p) => p.excused + p.unexcused + p.tardies));
  return `<div class="head"><div class="t"><h1>Attendance</h1></div></div>
  <section class="panel flush"><div class="scroll"><table><thead><tr><th>Period</th><th>Excused</th><th>Unexcused</th><th>Tardies</th><th class="hide-sm" style="width:35%"></th></tr></thead>
  <tbody>${a.periods.map((p) => `<tr><td class="num"><b>${h(p.period)}</b></td><td class="num">${p.excused}</td><td class="num">${p.unexcused}</td><td class="num">${p.tardies}</td><td class="hide-sm"><div class="prog"><i class="bg-B" style="width:${((p.excused + p.unexcused + p.tardies) / max) * 100}%"></i></div></td></tr>`).join('')}</tbody></table></div></section>
  <section class="panel flush"><div class="scroll"><table><thead><tr><th>Date</th><th>Absence</th><th>Periods</th></tr></thead>
  <tbody>${a.absences.map((x) => `<tr><td class="num">${h(x.date)}</td><td><b>${h(x.description || x.reason)}</b>${x.note ? '<div class="sub">' + h(x.note) + '</div>' : ''}</td><td class="small">${x.periods.map((p) => h(p.period + ' ' + (p.reason || p.name))).join('<br>')}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">Nothing recorded.</td></tr>'}</tbody></table></div></section>`;
}
function viewDocuments() {
  const d = data.extra && data.extra.documents;
  if (!d) return needSync('Documents', data.extra && data.extra.documentsError);
  return `<div class="head"><div class="t"><h1>Documents</h1></div></div>
  <section class="panel flush"><div class="scroll"><table><thead><tr><th>Date</th><th>Document</th><th></th></tr></thead>
  <tbody>${d.map((x) => `<tr><td class="num">${h(x.date)}</td><td><b>${h(x.comment || x.name)}</b><div class="sub">${h(x.type)}</div></td><td style="text-align:right"><button data-doc="${h(x.gu)}">Open</button></td></tr>`).join('') || '<tr><td colspan="3" class="empty">No documents.</td></tr>'}</tbody></table></div></section>`;
}

// ---------- settings / rules ----------
function viewSettings() {
  return `<div class="head"><div class="t"><h1>Settings</h1></div></div>
  <section class="panel"><h2>StudentVUE</h2>
    <div class="row">${settings.username ? `<span class="spacer">Signed in as <b>${h(settings.username)}</b></span><a class="btn" href="#/login">Sign in again</a><button data-act="forget">Forget login</button>` : `<span class="spacer muted">Not signed in</span><a class="btn primary" href="#/login">Sign in</a>`}</div>
    <details><summary>Relay</summary><div class="row" style="margin-top:8px"><input id="relay" value="${h(settings.relay)}" aria-label="Relay address" style="flex:1;min-width:220px"><button data-act="saveRelay">Save</button><button data-act="ping">Test</button></div></details>
  </section>
  <section class="panel"><h2>Grades</h2>
    <div class="row"><button data-act="addcourse">${ico('plus', 16)} Add course</button><button data-act="export">Back up</button><label class="btn">Restore<input type="file" id="importFile" accept=".json" hidden></label><button data-act="demo">Sample grades</button><button data-act="clear" class="danger">Erase all</button></div>
  </section>
  <section class="panel phone-only"><div class="row"><a class="btn" href="#/attendance">${ico('attendance', 18)} Attendance</a><a class="btn" href="#/documents">${ico('documents', 18)} Documents</a></div></section>
  <section class="panel"><h2>Appearance</h2>
    <div class="seg" role="group" aria-label="Theme" style="align-self:flex-start">${[['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(([k, v]) => `<button data-theme="${k}" class="${data.theme === k ? 'on' : ''}">${v}</button>`).join('')}</div>
  </section>
  <a href="#/rules" class="small">MCPS grading rules and sources</a>`;
}
function viewRules() {
  return `<a href="#/settings" class="row small" style="font-weight:700;text-decoration:none;min-height:32px">${ico('back', 16)} Settings</a>
  <div class="head"><div class="t"><h1>Grading rules</h1></div></div>
  ${POLICY.rulesHtml}
  <section class="panel"><h2>Sources</h2><ul class="small" style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px">${POLICY.sources.map((s) => `<li><a href="${h(s.url)}" target="_blank" rel="noopener noreferrer">${h(s.title)}</a></li>`).join('')}</ul></section>`;
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
    q('#demo').onclick = () => { if (data.courses.length && !(data.extra && data.extra.demo) && !confirm('Replace your grades with sample grades?')) return; data = normalize(demoData()); persist(); location.hash = '#/grades'; render(); };
    const man = q('#manual'); if (man) man.onclick = (e) => { e.preventDefault(); addCourse(); };
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
    const t = e.target.closest('[data-act]');
    const act = t && t.dataset.act;
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
  [...$app.querySelectorAll('[data-theme]')].forEach((b) => (b.onclick = () => { data.theme = b.dataset.theme; persist(); render(); }));
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
    if (act === 'addcat') { c.categories.push({ name: 'New category', weight: 0 }); commit(); }
    if (act === 'delcat') { c.categories.splice(Number(t.dataset.i), 1); commit(); }
    if (act === 'delcourse') { if (confirm(`Delete ${c.name}?`)) { data.courses.splice(data.courses.indexOf(c), 1); persist(); location.hash = '#/grades'; } }
  };
  const opt = () => {
    const out = q('#optOut');
    if (!out) return;
    const [kind, L] = q('#optGoal').value.split(':');
    const cat = q('#optCat').value, pts = Number(q('#optPts').value);
    let target = E.minPctFor(L);
    if (kind === 'sem') {
      const r = E.secondMPNeeds(c, semesterOf(mp)).find((x) => x.letter === L);
      if (!r || r.need === null) { out.innerHTML = `<span class="muted">Out of reach this semester.</span>`; return; }
      if (r.need === 0) { out.innerHTML = `<span class="muted">Already locked in.</span>`; return; }
      target = r.need - 0.5;
    }
    const res = E.needOnNext(c, m, cat, pts, target);
    if (!res) { out.textContent = ''; return; }
    if (res.need === 0) out.innerHTML = `<span class="muted">Locked in, even with a 0.</span>`;
    else if (res.need === Infinity || res.need > pts) out.innerHTML = `<span class="muted">Not reachable with one ${pts}-point assignment (max ${pct(res.best)}).</span>`;
    else { const n = Math.ceil(res.need * 100) / 100; out.innerHTML = `<b class="n num">${+n.toFixed(2)} / ${pts}</b> <span class="muted num">${pct((n / pts) * 100)}</span>`; }
  };
  ['#optGoal', '#optCat', '#optPts'].forEach((sel) => { const el = q(sel); if (el) el.oninput = el.onchange = opt; });
  opt();
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
