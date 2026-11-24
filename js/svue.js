// StudentVUE (MCPS) connection through the MelonFork relay.
// Same mobile-API calls GradeMelon uses (AttemptLogin, Gradebook, StudentClassList,
// GetStudentAttendanceList, GetStudentDocuments, GetStudentDocumentContent) but nothing
// is sent anywhere except the relay you configure, which forwards to MCPS and forgets.
import { uid } from './store.js';

const API = '/api/v1/mobile/PXPWebServices/';

const b64 = (s) => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};
const txt = (v) => (v == null ? '' : String(v)).trim();
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
// Decode HTML entities without ever parsing HTML (StudentVUE text is untrusted).
const decode = (s) => txt(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENT[e.toLowerCase()] ?? m;
});

export class StudentVue {
  constructor(relay, username, password) {
    this.relay = String(relay || '').replace(/\/+$/, '');
    this.username = username;
    this.password = password;
    this.access = null;
    this.refresh = null;
  }

  async call(method, params = {}, isLogin = false) {
    if (!this.relay) throw new Error('No relay address set (Settings).');
    if (!isLogin && !this.access) await this.login();
    const body = { ...params };
    const headers = { 'Content-Type': 'application/json' };
    if (isLogin) headers.Authorization = 'Basic ' + b64(`${this.username}:${this.password}`);
    else headers.Authorization = 'Bearer ' + this.access;
    const send = () => fetch(this.relay + API + method, {
      method: 'POST', headers, body: JSON.stringify({ arguments: { request: JSON.stringify(body) } }),
    });
    let res;
    try { res = await send(); } catch (_) {
      throw new Error('Could not reach the relay. Check the relay address in Settings, or your network.');
    }
    if (res.status === 401 && !isLogin) {
      this.access = null;
      await this.login();
      headers.Authorization = 'Bearer ' + this.access;
      res = await send();
    }
    let json = null;
    try { json = await res.json(); } catch (_) { /* not JSON */ }
    if (json && json.access_token) this.access = json.access_token;
    if (json && json.refresh_token) this.refresh = json.refresh_token;
    if (json && json.error) {
      const msg = json.error.message || 'StudentVUE error';
      throw new Error(/invalid user/i.test(msg) ? 'Wrong username or password.' : msg);
    }
    if (!res.ok) throw new Error(`StudentVUE answered ${res.status}.`);
    return json ? json.data : null;
  }

  async login() {
    await this.call('AttemptLogin', { userID: this.username, password: this.password, userType: 'Student' }, true);
    if (!this.access) throw new Error('Login did not return a session. StudentVUE may have changed.');
  }

  async gradebook(reportPeriod) {
    const p = { childIntId: 0 };
    if (reportPeriod != null) p.ReportPeriod = reportPeriod;
    const d = await this.call('Gradebook', p);
    const gb = d && d.traditionalGradebook;
    if (!gb || !Array.isArray(gb.courses)) throw new Error('Unexpected gradebook format from StudentVUE.');
    return gb;
  }

  async schedule(termIndex) {
    const p = { childIntId: 0 };
    if (termIndex != null) p.TermIndex = termIndex;
    const d = await this.call('StudentClassList', p);
    return d && d.studentClassSchedule;
  }

  async attendance() {
    const d = await this.call('GetStudentAttendanceList', { childIntID: 0, orgYearGU: '' });
    return d && d.periodAttendance;
  }

  async documents() {
    const d = await this.call('GetStudentDocuments', { childIntID: 0, languageCode: 'ENG' });
    return (d && d.studentDocuments && d.studentDocuments.studentDocumentDatas) || [];
  }

  async documentContent(documentGU) {
    const d = await this.call('GetStudentDocumentContent', { childIntID: 0, documentGU });
    const list = (d && d.studentAttachedDocumentData && d.studentAttachedDocumentData.documentDatas) || [];
    return list.map((x) => ({ name: x.fileName, type: x.docType, base64: x.base64Code }));
  }
}

// ---------- converting StudentVUE data into MelonFork's model ----------

// Which MelonFork marking period ("MP1".."MP4") a StudentVUE reporting period is, or null
// for progress/interim periods.
export function mpKeyFor(name, orderIndex) {
  const n = txt(name).toLowerCase();
  if (/progress|interim|mid/.test(n)) return null;
  const d = n.match(/([1-4])/);
  if (d) return 'MP' + d[1];
  return orderIndex >= 0 && orderIndex < 4 ? 'MP' + (orderIndex + 1) : null;
}

export function guessLevel(title) {
  const t = ' ' + txt(title).toUpperCase() + ' ';
  if (/\bAP\b/.test(t)) return 'ap';
  if (/\bIB\b/.test(t)) return 'ib';
  if (/\bHON\b|\bHONORS\b|\bH\b/.test(t)) return 'honors';
  return 'regular';
}

function parsePoints(points, displayScore) {
  const s = txt(points);
  const m = s.match(/(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  if (m) return { earned: Number(m[1]), possible: Number(m[2]) };
  const p = s.match(/(\d+(?:\.\d+)?)/);
  return { earned: '', possible: p ? Number(p[1]) : '' };
}

function parseWeight(w) {
  const m = txt(w).match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : 0;
}

export const courseKey = (c) => (txt(c.courseID) || txt(c.title).toLowerCase()) + '|' + txt(c.period);

// Merge one marking period's gradebook into the course list. Keeps the user's own
// settings (level, credits, term) for courses it already knows.
export function mergeGradebook(courses, gb, mpKey) {
  for (const c of gb.courses) {
    const key = courseKey(c);
    let course = courses.find((x) => x.svKey === key);
    const title = decode(c.title);
    if (!course) {
      course = {
        id: uid(), svKey: key, name: title.replace(/\s*\([^)]*\)\s*$/, '').trim() || title, period: txt(c.period),
        teacher: txt(c.staff), email: txt(c.staffEMail), room: txt(c.room), level: guessLevel(title),
        term: 'year', credits: 0.5, categories: [], mps: {}, exams: {},
      };
      courses.push(course);
    }
    const mark = (c.marks || [])[0];
    if (!mark) continue;
    const cats = (mark.gradeCalculationSummary || [])
      .map((k) => ({ name: decode(k.type), weight: parseWeight(k.weight) }))
      .filter((k) => k.name && !/^total$/i.test(k.name));
    if (cats.length) course.categories = mergeCats(course.categories, cats);
    const assignments = (mark.assignments || []).map((a) => {
      const pts = parsePoints(a.points, a.displayScore);
      const shown = decode(a.displayScore);
      const notes = decode(a.notes);
      return {
        id: uid(), name: decode(a.measure) || 'Assignment', category: decode(a.type),
        earned: pts.earned, possible: pts.possible, date: txt(a.dueDate || a.date),
        missing: /missing/i.test(shown + ' ' + notes) && pts.earned === '',
        excused: /excused|exempt/i.test(shown + ' ' + notes),
        notes, from: 'svue',
      };
    });
    const raw = Number(mark.calculatedScoreRaw);
    course.mps[mpKey] = {
      override: (course.mps[mpKey] && course.mps[mpKey].override) || '',
      assignments,
      reported: { letter: txt(mark.calculatedScoreString), pct: Number.isFinite(raw) ? raw : null },
      synced: new Date().toISOString(),
    };
  }
  return courses;
}

function mergeCats(old, fresh) {
  const out = [...fresh];
  for (const o of old || []) if (!out.some((f) => f.name.toLowerCase() === o.name.toLowerCase())) out.push(o);
  return out;
}

export function scheduleRows(sched) {
  if (!sched) return { termName: '', terms: [], classes: [] };
  const toRow = (c) => ({ period: txt(c.period), name: decode(c.courseTitle), teacher: txt(c.teacher), room: txt(c.roomName) });
  return {
    termName: txt(sched.termIndexName),
    terms: (sched.termLists || []).map((t) => ({ index: t.termIndex, name: txt(t.termName), start: txt(t.beginDate), end: txt(t.endDate) })),
    classes: (sched.classLists || []).map(toRow),
  };
}

export function attendanceSummary(att) {
  if (!att) return null;
  const count = Number(att.periodCount || 0);
  const tot = (k, i) => Number((att[k] && att[k][i] && att[k][i].total) || 0);
  return {
    absences: (att.absences || []).map((a) => ({
      date: txt(a.absenceDate), reason: txt(a.reason), note: txt(a.note), description: txt(a.codeAllDayDescription),
      periods: (a.periods || []).map((p) => ({ period: txt(p.number), name: txt(p.name), reason: txt(p.reason), course: txt(p.course) })),
    })),
    periods: Array.from({ length: count }, (_, i) => ({
      period: (att.totalActivities && att.totalActivities[i] && att.totalActivities[i].number) ?? i,
      excused: tot('totalExcused', i), tardies: tot('totalTardies', i), unexcused: tot('totalUnexcused', i),
      activities: tot('totalActivities', i), unexcusedTardies: tot('totalUnexcusedTardies', i),
    })),
  };
}

// Pull every marking period's gradebook (+ schedule, attendance, document list).
export async function syncAll(client, courses, onStep = () => {}) {
  onStep('Signing in…');
  await client.login();
  onStep('Reading gradebook…');
  const first = await client.gradebook();
  const periods = (first.reportingPeriods || []).map((p, i) => ({ index: Number(p.index), name: txt(p.gradePeriod), start: txt(p.startDate), end: txt(p.endDate), i }));
  const current = txt(first.reportingPeriod && first.reportingPeriod.gradePeriod);
  const real = periods.filter((p) => !/progress|interim|mid/i.test(p.name));
  const mpPeriods = real.map((p, i) => ({ ...p, key: mpKeyFor(p.name, i) })).filter((p) => p.key);
  const today = new Date();
  // Keep StudentVUE's own pages (current one, often an interim, plus each marking period)
  // so differences between them can be checked.
  const raw = { [current || 'current']: first.courses };
  for (const p of mpPeriods) {
    const start = new Date(p.start);
    if (Number.isFinite(start.getTime()) && start > today) continue; // future period: nothing yet
    onStep(`Reading ${p.name}…`);
    const gb = p.name === current ? first : await client.gradebook(p.index);
    raw[p.name] = gb.courses;
    mergeGradebook(courses, gb, p.key);
  }
  if (!mpPeriods.length) mergeGradebook(courses, first, 'MP1');
  const extra = { periods: mpPeriods.map(({ key, name, start, end }) => ({ key, name, start, end })), current,
    allPeriods: periods.map(({ index, name, start, end }) => ({ index, name, start, end })), raw };
  try { onStep('Reading schedule…'); extra.schedule = scheduleRows(await client.schedule()); } catch (e) { extra.scheduleError = e.message; }
  try { onStep('Reading attendance…'); extra.attendance = attendanceSummary(await client.attendance()); } catch (e) { extra.attendanceError = e.message; }
  try {
    onStep('Reading documents…');
    extra.documents = (await client.documents()).map((d) => ({ gu: d.documentGU, name: txt(d.documentFileName), type: txt(d.documentType), date: txt(d.documentDate), comment: txt(d.documentComment) }));
  } catch (e) { extra.documentsError = e.message; }
  return extra;
}
