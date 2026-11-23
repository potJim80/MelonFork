// Local-only storage. Nothing ever leaves the browser.
const KEY = 'melonfork.v1';

export const uid = () => Math.random().toString(36).slice(2, 10);

export function emptyData() {
  return { version: 1, courses: [], prior: { unweighted: '', weighted: '', credits: '' }, theme: 'auto' };
}

export function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d && Array.isArray(d.courses)) return normalize(d);
  } catch (_) { /* fall through */ }
  return emptyData();
}

export function save(d) {
  localStorage.setItem(KEY, JSON.stringify(d));
}

export function clearAll() {
  localStorage.removeItem(KEY);
}

export function normalize(d) {
  const out = { ...emptyData(), ...d };
  out.courses = (d.courses || []).map((c) => ({
    id: c.id || uid(),
    name: c.name || 'Untitled course',
    period: c.period ?? '',
    teacher: c.teacher || '',
    room: c.room || '',
    level: c.level || 'regular',
    term: c.term || 'year',
    credits: c.credits ?? 0.5,
    categories: (c.categories || []).map((k) => ({ name: String(k.name), weight: Number(k.weight) || 0 })),
    svKey: c.svKey || '',
    email: c.email || '',
    mps: Object.fromEntries(['MP1', 'MP2', 'MP3', 'MP4'].map((m) => {
      const src = (c.mps && c.mps[m]) || {};
      return [m, {
        override: src.override ?? '',
        reported: src.reported || null,
        synced: src.synced || '',
        assignments: (src.assignments || []).map((a) => ({ ...a, id: a.id || uid() })),
      }];
    })),
    exams: c.exams || {},
    eoc: !!c.eoc,
  }));
  out.extra = d.extra || {};
  return out;
}
