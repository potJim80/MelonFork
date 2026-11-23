// MelonFork relay — a Cloudflare Worker (free plan is plenty).
//
// Why it exists: browsers are not allowed to call the StudentVUE mobile API directly
// (the server sends no CORS headers), so a static GitHub Pages site needs a tiny relay,
// the same job GradeMelon's own server does. This one:
//   * forwards ONLY  POST /api/v1/mobile/PXPWebServices/<Method>  to MCPS StudentVUE,
//   * adds the app-version header the StudentVUE mobile API expects,
//   * answers only pages on the allowed origins below,
//   * stores and logs nothing (no KV, no D1, no console.log of requests).

const DISTRICT = 'https://md-mcps-psv.edupoint.com';
const ALLOWED_ORIGINS = [
  'https://potjim80.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
];
const METHOD_RE = /^\/api\/v1\/mobile\/PXPWebServices\/[A-Za-z]{3,60}$/;

// Same header value the StudentVUE Android app sends (and that GradeMelon's library builds):
// AES-256-CBC of "MMDDYY|9.0.0|MMDDYY|android" with the app's fixed key; IV = "AES" + zero bytes.
const APP_KEY = 'b2524efb438b4532b322e633d5aff252';
async function edupointKeyVersion(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: '2-digit', month: '2-digit', day: '2-digit',
  }).formatToParts(now).map((x) => [x.type, x.value]));
  const today = `${p.month}${p.day}${p.year}`;
  const enc = new TextEncoder();
  const iv = new Uint8Array(16);
  iv.set(enc.encode('AES'));
  const key = await crypto.subtle.importKey('raw', enc.encode(APP_KEY), { name: 'AES-CBC' }, false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, key, enc.encode(`${today}|9.0.0|${today}|android`)));
  let bin = '';
  for (const b of ct) bin += String.fromCharCode(b);
  return btoa(bin);
}

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';
    if (!ALLOWED_ORIGINS.includes(origin)) return new Response('Not allowed', { status: 403 });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });

    const url = new URL(request.url);
    if (url.pathname === '/ping') return new Response('ok', { headers: cors(origin) });
    if (request.method !== 'POST' || !METHOD_RE.test(url.pathname)) {
      return new Response('Not found', { status: 404, headers: cors(origin) });
    }

    const body = await request.text();
    if (body.length > 20000) return new Response('Too large', { status: 413, headers: cors(origin) });

    const headers = {
      Accept: '*/*',
      'Content-Type': 'application/json',
      'User-Agent': 'ksoap',
      edupointkeyversion: await edupointKeyVersion(),
    };
    const auth = request.headers.get('Authorization');
    if (auth) headers.Authorization = auth;

    const upstream = await fetch(DISTRICT + url.pathname, { method: 'POST', headers, body });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { ...cors(origin), 'Content-Type': upstream.headers.get('Content-Type') || 'application/json', 'Cache-Control': 'no-store' },
    });
  },
};

export { edupointKeyVersion };
