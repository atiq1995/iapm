import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'production';
process.env.ALLOW_OWNER_SETUP = 'true';

const dir = path.resolve('.sites-runtime/api-tests');
await fs.mkdir(dir, { recursive: true });

await fs.writeFile(
  `${dir}/runtime.mjs`,
  `import {DatabaseSync} from 'node:sqlite';
export const sql=new DatabaseSync(':memory:');
sql.exec('CREATE TABLE accounts(id TEXT PRIMARY KEY,email TEXT,hash TEXT,salt TEXT); CREATE TABLE sessions(id TEXT PRIMARY KEY,owner TEXT,expires INTEGER); CREATE TABLE records(id TEXT PRIMARY KEY,owner TEXT,kind TEXT,body TEXT,updated INTEGER); CREATE TABLE attempts(id TEXT PRIMARY KEY,count INTEGER,until INTEGER)');
export let cookie='';
export function context(c=''){cookie=c;}
export async function cookies(){return {get:()=>cookie?{value:cookie}:undefined};}
const db={prepare(q){let a=[];const stmt=sql.prepare(q);return {get sql(){return q},get args(){return a},bind(...v){a=v;return this;},async first(){return stmt.get(...a)||null;},async all(){return {results:stmt.all(...a)};},async run(){const meta=stmt.run(...a);return {meta:{changes:meta.changes},changes:meta.changes};}};},async batch(statements){return Promise.all(statements.map(s=>s.run()));}};
export function getD1(){return db;}
`,
);

await fs.writeFile(
  `${dir}/d1-compat.mjs`,
  `export {getD1} from './runtime.mjs';`,
);

for (const [src, out] of [
  ['lib/criticality.ts', 'criticality'],
  ['lib/risk-feedback.ts', 'risk-feedback'],
  ['lib/mtbf.ts', 'mtbf'],
  ['lib/domain.ts', 'domain'],
  ['lib/validation.ts', 'validation'],
  ['lib/auth.ts', 'auth'],
  ['lib/owner-data.ts', 'owner-data'],
  ['app/api/auth/route.ts', 'auth-route'],
  ['app/api/data/route.ts', 'data-route'],
]) {
  let s = await fs.readFile(src, 'utf8');
  s = s
    .replace(/['"]@\/lib\/criticality['"]/g, "'./criticality.mjs'")
    .replace(/['"]\.\/criticality['"]/g, "'./criticality.mjs'")
    .replace(/['"]@\/lib\/d1-compat['"]/g, "'./d1-compat.mjs'")
    .replace(/['"]next\/headers['"]/g, "'./runtime.mjs'")
    .replace(/['"]@\/lib\/auth['"]/g, "'./auth.mjs'")
    .replace(/['"]@\/lib\/domain['"]/g, "'./domain.mjs'")
    .replace(/['"]\.\/domain['"]/g, "'./domain.mjs'")
    .replace(/['"]@\/lib\/validation['"]/g, "'./validation.mjs'")
    .replace(/['"]@\/lib\/owner-data['"]/g, "'./owner-data.mjs'")
    .replace(/['"]\.\/auth['"]/g, "'./auth.mjs'")
    .replace(/from ['"]\.\/risk-feedback['"]/g, "from './risk-feedback.mjs'")
    .replace(/from ['"]\.\/mtbf['"]/g, "from './mtbf.mjs'")
    .replace(/from ['"]\.\/domain['"]/g, "from './domain.mjs'")
    .replace(/from ['"]\.\/criticality['"]/g, "from './criticality.mjs'");
  await fs.writeFile(
    `${dir}/${out}.mjs`,
    ts.transpile(s, {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    }),
  );
}

const load = (name) => import(pathToFileURL(path.join(dir, name)).href);
const rt = await load('runtime.mjs');
const auth = await load('auth-route.mjs');
const api = await load('data-route.mjs');
const lib = await load('auth.mjs');
const results = [];
const user = { userId: 'test-owner', email: 'owner@example.invalid' };
const request = (body, cookie = '') =>
  new Request('https://test.invalid/api/auth', {
    method: 'POST',
    headers: {
      Origin: 'https://test.invalid',
      'Content-Type': 'application/json',
      Cookie: cookie ? 'ri_session=' + cookie : '',
    },
    body: JSON.stringify(body),
  });

assert.equal((await api.GET()).status, 401);
results.push('Anonymous API denied');

assert.equal(
  (
    await auth.POST(
      request({ action: 'setup', password: 'short', email: user.email }),
    )
  ).status,
  400,
);
let r = await auth.POST(
  request({
    action: 'setup',
    password: 'Synthetic-Test-Only-8274',
    email: user.email,
  }),
);
assert.equal(r.status, 200);
const header = r.headers.get('set-cookie');
assert.ok(
  header.includes('HttpOnly') &&
    header.includes('Secure') &&
    header.includes('SameSite=Strict'),
);
const token = header.match(/ri_session=([^;]+)/)[1];
rt.context(token);
assert.ok(await lib.identity());
results.push('Password setup, salted hash and secure session cookie');

assert.equal(
  (
    await auth.POST(
      request({ action: 'login', password: 'wrong', email: user.email }),
    )
  ).status,
  401,
);
results.push('Incorrect password rejected');

let data = await (await api.GET()).json();
assert.equal(data.assets.length, 128);
results.push('Authenticated seed read');

const asset = { ...data.assets[0], id: 'TEST-ASSET', tag: 'TEST-PUMP' };
r = await api.POST(request({ kind: 'assets', record: asset }));
assert.equal(r.status, 200);
data = await (await api.GET()).json();
assert.ok(data.assets.some((a) => a.id === asset.id));
results.push('Asset persists across independent API reads');

let e = {
  ...data.incidents[0],
  id: 'TEST-RIR',
  status: 'Draft',
  date: '2026-09-12T08:00',
  history: [],
};
for (const status of [
  'Draft',
  'Submitted',
  'Reviewed',
  'Approved',
  'Closed',
]) {
  e = { ...e, status };
  r = await api.POST(request({ kind: 'incidents', record: e }));
  assert.equal(r.status, 200, await r.clone().text());
  e = (await r.json()).record;
}
assert.equal(e.history.length, 5);
results.push('Five-state RIR lifecycle, audit history and storage');

assert.equal(
  (await api.POST(request({ kind: 'incidents', record: { ...e, loss: 0 } })))
    .status,
  400,
);
results.push('Approved evidence is immutable');

const aca = await load('criticality.mjs');
const assessment = aca.newAssessment(user.email);
assessment.ratings = Object.fromEntries(
  aca.ACA_CRITERIA.map((c) => [c.id, 3]),
);
Object.assign(assessment, {
  team: 'Engineering; operations; EHS',
  evidence: 'Synthetic ACA test evidence',
  reviewer: 'Demo reviewer',
});
r = await api.POST(
  request({
    kind: 'criticality',
    record: {
      id: 'TEST-ASSET',
      assessment,
      intent: 'draft',
      expectedRevision: 0,
    },
  }),
);
assert.equal(r.status, 200, await r.clone().text());
let saved = (await r.json()).record;
assert.equal(saved.aca.current, undefined);
assert.equal(saved.aca.draft.score, 60);
results.push('ACA draft persists without changing reviewed criticality');

r = await api.POST(
  request({
    kind: 'criticality',
    record: {
      id: 'TEST-ASSET',
      assessment,
      intent: 'publish',
      expectedRevision: 1,
    },
  }),
);
assert.equal(r.status, 200, await r.clone().text());
saved = (await r.json()).record;
assert.equal(saved.aca.current.score, 60);
assert.equal(saved.criticality, 3);
assert.equal(saved.aca.history.length, 2);
results.push('ACA reviewed score and normalized portfolio input persisted');

r = await api.POST(
  request({
    kind: 'criticality',
    record: {
      id: 'TEST-ASSET',
      assessment,
      intent: 'publish',
      expectedRevision: 1,
    },
  }),
);
assert.equal(r.status, 409);
results.push('Stale ACA revision rejected');

const missing = aca.newAssessment(user.email);
r = await api.POST(
  request({
    kind: 'criticality',
    record: {
      id: 'TEST-ASSET',
      assessment: missing,
      intent: 'publish',
      expectedRevision: 2,
    },
  }),
);
assert.equal(r.status, 400);
results.push('Incomplete ACA cannot be marked reviewed');

r = await api.POST(
  request({
    kind: 'assets',
    record: { ...saved, criticality: 1, aca: { current: { score: 1 } } },
  }),
);
assert.equal(r.status, 200);
assert.equal((await r.json()).record.aca.current.score, 60);
results.push('Ordinary asset update cannot inject an ACA score');

const race = await Promise.all([
  api.POST(
    request({
      kind: 'criticality',
      record: {
        id: 'TEST-ASSET',
        assessment,
        intent: 'draft',
        expectedRevision: 2,
      },
    }),
  ),
  api.POST(
    request({
      kind: 'criticality',
      record: {
        id: 'TEST-ASSET',
        assessment,
        intent: 'draft',
        expectedRevision: 2,
      },
    }),
  ),
]);
assert.deepEqual(
  race.map((x) => x.status).sort(),
  [200, 409],
);
results.push('Concurrent ACA saves preserve the winning revision');

rt.sql.prepare('UPDATE sessions SET expires=0').run();
assert.equal((await api.GET()).status, 401);
results.push('Expired session denied');

r = await auth.POST(
  request({
    action: 'login',
    password: 'Synthetic-Test-Only-8274',
    email: user.email,
  }),
);
const token2 = r.headers.get('set-cookie').match(/ri_session=([^;]+)/)[1];
rt.context(token2);
assert.equal((await auth.POST(request({ action: 'logout' }, token2))).status, 200);
rt.context(token2);
assert.equal((await api.GET()).status, 401);
results.push('Logout invalidates server-side session');

for (let i = 0; i < 5; i++)
  await auth.POST(
    request({ action: 'login', password: 'wrong', email: user.email }),
  );
assert.equal(
  (
    await auth.POST(
      request({ action: 'login', password: 'wrong', email: user.email }),
    )
  ).status,
  429,
);
results.push('Repeated failures rate-limited');

const output = {
  date: '2026-10-16',
  passed: results.length,
  scope:
    'Production route code with in-memory SQLite and email/password sessions; not hosted end-to-end',
  checks: results,
};
await fs.writeFile('docs/api-validation.json', JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 2));
