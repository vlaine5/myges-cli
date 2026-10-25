// MyGES / Kordis API probe — READ ONLY (GET uniquement).
// Lance: `node scripts/myges-api-probe.mjs` apres avoir mis a jour MYGES_PASSWORD dans .env.
// Aucune route d'ecriture (POST/PUT/DELETE) n'est appelee. Dump redacte dans data/exports/.
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env'), 'utf8')
    .split(/\r?\n/).filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const AUTH = 'https://authentication.kordis.fr/oauth/authorize?response_type=token&client_id=skolae-app';
const API = 'https://api.kordis.fr';

async function login(user, pass) {
  const creds = Buffer.from(`${user}:${pass}`, 'utf8').toString('base64');
  const r = await fetch(AUTH, { headers: { Authorization: `Basic ${creds}` }, redirect: 'manual' });
  const loc = r.headers.get('location');
  if (!loc) throw new Error(`Auth rejetee (HTTP ${r.status}) — verifie MYGES_PASSWORD`);
  const p = new URLSearchParams(loc.slice(loc.indexOf('#') + 1));
  return { token: p.get('access_token'), type: p.get('token_type'), uid: p.get('uid') };
}

async function get(pathname, auth) {
  const r = await fetch(`${API}${pathname}`, { headers: { Authorization: `${auth.type} ${auth.token}` } });
  let body = null;
  try { body = (await r.json()).result; } catch { /* non-json */ }
  return { status: r.status, body };
}

const redact = (v) => JSON.stringify(v, (k, val) =>
  /password|token|hash|email|mail|phone|tel/i.test(k) ? '«redacted»' : val);

(async () => {
  const auth = await login(env.MYGES_USERNAME, env.MYGES_PASSWORD);
  console.log(`[auth] OK type=${auth.type} uid=${auth.uid}`);

  const years = (await get('/me/years', auth)).body ?? [];
  console.log(`[years] ${JSON.stringify(years)}`);

  // Endpoints confirmes (lecture)
  const confirmed = ['/me/profile', '/me/nextProjectSteps'];
  const perYear = (y) => [`/me/${y}/absences`, `/me/${y}/grades`, `/me/${y}/courses`, `/me/${y}/projects`];
  // Candidats non confirmes (hypotheses — GET only)
  const candidates = (y) => [`/me/${y}/trombi`, '/me/classes', `/me/${y}/students`, '/me/news', '/me/actualites'];

  const targets = [...confirmed];
  for (const y of years) targets.push(...perYear(y), ...candidates(y));

  const out = {};
  for (const t of targets) {
    try {
      const { status, body } = await get(t, auth);
      const n = Array.isArray(body) ? body.length : body ? 1 : 0;
      console.log(`[${status}] ${t}  (${n} item${n > 1 ? 's' : ''})`);
      out[t] = { status, sample: Array.isArray(body) ? body.slice(0, 1) : body };
    } catch (e) {
      console.log(`[ERR] ${t} — ${e.message}`);
    }
  }

  const dir = path.join(ROOT, 'data', 'exports');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'myges-api-probe.json');
  fs.writeFileSync(file, redact(out));
  console.log(`\nDump redacte -> ${file}`);
})().catch((e) => { console.error('ECHEC:', e.message); process.exit(1); });
