// Read-only reliability assistant: config, guided fallback, model tool loop,
// JSON-protocol fallback for small models, citation verification, read-only
// guarantee, owner isolation and request guards. Model calls are mocked.
// Run: node tests/assistant.test.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import assert from 'node:assert/strict';

const dir = path.resolve('.sites-runtime/assistant-tests');
await fs.rm(dir, { recursive: true, force: true });
await fs.mkdir(dir, { recursive: true });

await fs.writeFile(`${dir}/next-stub.mjs`, `import {DatabaseSync} from 'node:sqlite';
export const sql=new DatabaseSync(':memory:');
sql.exec('CREATE TABLE accounts(id TEXT PRIMARY KEY,email TEXT,hash TEXT,salt TEXT);CREATE TABLE sessions(id TEXT PRIMARY KEY,owner TEXT,expires INTEGER);CREATE TABLE records(id TEXT PRIMARY KEY,owner TEXT,kind TEXT,body TEXT,updated INTEGER);CREATE TABLE attempts(id TEXT PRIMARY KEY,count INTEGER,until INTEGER)');
export let cookie='';export function context(c=''){cookie=c;}
export async function cookies(){return {get:()=>cookie?{value:cookie}:undefined};}
const db={prepare(q){let a=[];const stmt=sql.prepare(q);return {get sql(){return q},get args(){return a},bind(...v){a=v;return this;},async first(){return stmt.get(...a)||null;},async all(){return {results:stmt.all(...a)};},async run(){const m=stmt.run(...a);return {meta:{changes:m.changes},changes:m.changes};}};},async batch(s){return Promise.all(s.map(x=>x.run()));}};
export function getD1(){return db;}
export function runtime(){return {OPENAI_API_KEY:process.env.OPENAI_API_KEY,OPENAI_MODEL:process.env.OPENAI_MODEL};}
`);

// Transpile into one flat folder; lib/assistant/x.ts becomes assistant-x.mjs.
const sources = [];
for (const f of await fs.readdir('lib')) if (f.endsWith('.ts') && !['runtime.ts', 'files.ts', 'd1-compat.ts'].includes(f)) sources.push(['lib/' + f, f.replace('.ts', ''), false]);
for (const f of await fs.readdir('lib/assistant')) if (f.endsWith('.ts')) sources.push(['lib/assistant/' + f, 'assistant-' + f.replace('.ts', ''), true]);
sources.push(['app/api/assistant/route.ts', 'assistant-route', false]);
for (const [src, out, inAssistant] of sources) {
  let s = await fs.readFile(src, 'utf8');
  s = s
    .replace(/(['"])@\/lib\/assistant\/([^'"]+)\1/g, "'./assistant-$2.mjs'")
    .replace(/(['"])@\/lib\/(runtime|d1-compat)\1/g, "'./next-stub.mjs'")
    .replace(/(['"])@\/lib\/([^'"]+)\1/g, "'./$2.mjs'")
    .replace(/(['"])\.\/(runtime|d1-compat|files)\1/g, "'./next-stub.mjs'")
    .replace(/(['"])\.\/([^'".]+)\1/g, inAssistant ? "'./assistant-$2.mjs'" : "'./$2.mjs'")
    .replace(/(['"])next\/headers\1/g, "'./next-stub.mjs'");
  await fs.writeFile(`${dir}/${out}.mjs`, ts.transpileModule(s, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
}
await fs.writeFile(`${dir}/demo-rir-hash.json.mjs`, 'export default {}');

const load = (n) => import(pathToFileURL(path.join(dir, n)).href);
const rt = await load('next-stub.mjs');
const route = await load('assistant-route.mjs');
const { assistantConfig, publicStatus } = await load('assistant-config.mjs');
const { runTool, deepFreeze } = await load('assistant-tools.mjs');
const { digest } = await load('auth.mjs');
const { ownerData } = await load('owner-data.mjs');
const { defaultAssumptions } = await load('domain.mjs');

const passed = [];
const check = (name, fn) => Promise.resolve(fn()).then(() => passed.push(name));
const ORIGIN = 'https://test.invalid';
const post = (body, origin = ORIGIN) => route.POST(new Request(ORIGIN + '/api/assistant', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) }));
const json = async (r) => ({ status: r.status, body: await r.json() });
const usageRows = () => rt.sql.prepare("SELECT COUNT(*) n FROM records WHERE kind='ai_usage'").get().n;
const businessRows = () => rt.sql.prepare("SELECT COUNT(*) n FROM records WHERE kind NOT IN ('assistant_chat','ai_usage')").get().n;
const clearModelEnv = () => { for (const k of ['AI_BASE_URL', 'AI_MODEL', 'AI_MODEL_LABEL', 'AI_API_KEY', 'AI_TOOL_MODE', 'AI_ASSISTANT_NAME', 'OPENAI_API_KEY', 'OPENAI_MODEL']) delete process.env[k]; };
const attachModel = (extra = {}) => Object.assign(process.env, { AI_BASE_URL: 'https://model.test/v1/', AI_MODEL: 'relia-core-8b', AI_MODEL_LABEL: 'Relia Core', ...extra });
// Mocked OpenAI-compatible server. `replies` are consumed in order.
function mockModel(replies) {
  const requests = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push({ url: String(url), headers: init.headers, body });
    const next = replies.shift();
    if (!next) throw new Error('unexpected model call');
    if (next.status) return new Response('{"error":"bad"}', { status: next.status });
    return Response.json({ model: 'relia-core-8b', usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }, choices: [{ message: next }] });
  };
  return requests;
}
clearModelEnv();

await check('Config: defaults to guided engine with the assistant name', () => {
  const c = assistantConfig({});
  assert.equal(c.connected, false);
  assert.equal(c.name, 'Relia');
  assert.equal(assistantConfig({ AI_ASSISTANT_NAME: '  Nova <b>  ' }).name, 'Nova b');
});
await check('Config: attaches any OpenAI-compatible endpoint; key never in public status', () => {
  const c = assistantConfig({ AI_BASE_URL: 'http://localhost:11434/v1/', AI_MODEL: 'qwen3:8b', AI_API_KEY: 'secret-key' });
  assert.equal(c.connected, true);
  assert.equal(c.baseUrl, 'http://localhost:11434/v1');
  const pub = JSON.stringify(publicStatus(c));
  assert.ok(!pub.includes('secret-key'));
  assert.ok(pub.includes('localhost:11434'));
  assert.equal(assistantConfig({ AI_BASE_URL: 'ftp://x', AI_MODEL: 'm' }).connected, false);
  assert.equal(assistantConfig({ AI_BASE_URL: 'https://user:pw@x.test/v1', AI_MODEL: 'm' }).connected, false);
  const legacy = assistantConfig({ OPENAI_API_KEY: 'k', OPENAI_MODEL: 'gpt-x' });
  assert.equal(legacy.connected, true);
  assert.equal(legacy.baseUrl, 'https://api.openai.com/v1');
});

await check('Unauthenticated requests are rejected', async () => {
  assert.equal((await route.GET()).status, 401);
  assert.equal((await post({ question: 'Hello there' })).status, 401);
});

rt.sql.prepare('INSERT INTO accounts VALUES(?,?,?,?)').run('owner', 'owner@example.invalid', 'h', 's');
rt.sql.prepare('INSERT INTO sessions VALUES(?,?,?)').run(await digest('owner-token'), 'owner', Date.now() + 1e7);
rt.context('owner-token');
const baseline = JSON.stringify(await ownerData('owner'));

await check('Cross-origin and malformed requests are rejected', async () => {
  assert.equal((await post({ question: 'Top bad actors?' }, 'https://evil.invalid')).status, 403);
  assert.equal((await post({ question: 'x' })).status, 400);
  assert.equal((await post({ question: 'Top bad actors?', role: 'admin' })).status, 400);
  assert.equal((await post('{not json')).status, 400);
  assert.equal((await post({ question: 'a'.repeat(25000) })).status, 413);
});

await check('GET reports guided mode when no model is attached', async () => {
  const { status, body } = await json(await route.GET());
  assert.equal(status, 200);
  assert.equal(body.assistant.connected, false);
  assert.equal(body.assistant.readOnly, true);
  assert.deepEqual(body.conversations, []);
});

let guidedConversation;
await check('Guided engine answers with cited records and no AI usage', async () => {
  globalThis.fetch = async () => { throw new Error('no network expected'); };
  const { status, body } = await json(await post({ question: 'Which are the top 5 bad actors by actual loss?' }));
  assert.equal(status, 200, JSON.stringify(body));
  const answer = body.conversation.messages[1];
  assert.equal(answer.engine, 'guided');
  assert.ok(answer.sources.length > 0);
  assert.match(answer.notice, /guided query engine/);
  assert.match(answer.content, /\| Asset \/ group \|/);
  assert.equal(usageRows(), 0);
  guidedConversation = body.conversation;
});

attachModel();
const assetOne = (await ownerData('owner')).incidents.filter((e) => e.assetId === 'AST-1').sort((a, b) => b.date.localeCompare(a.date))[0].id;
let modelConversation;
await check('Model tool loop: read-only tools, rejected write tool, verified citations, usage ledger', async () => {
  const before = usageRows();
  const requests = mockModel([
    { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_asset_profile', arguments: '{"asset":"sc-e-101"}' } }] },
    { content: null, tool_calls: [{ id: 'c2', type: 'function', function: { name: 'delete_asset', arguments: '{"asset":"AST-1"}' } }] },
    { content: `SC-E-101 [AST-1] is the top loss asset. Latest event [${assetOne}]. See also [RIR-99999].` },
  ]);
  const { status, body } = await json(await post({ question: 'Tell me about SC-E-101' }));
  assert.equal(status, 200, JSON.stringify(body));
  const m = body.conversation.messages[1];
  assert.equal(m.engine, 'model');
  assert.equal(m.model, 'Relia Core');
  assert.equal(requests.length, 3);
  assert.equal(requests[0].url, 'https://model.test/v1/chat/completions');
  assert.equal(requests[0].body.model, 'relia-core-8b');
  assert.deepEqual(requests[0].body.tools.map((t) => t.function.name), ['query_reliability', 'search_incidents', 'get_asset_profile']);
  assert.ok(!('Authorization' in requests[0].headers), 'no key configured, so no auth header');
  assert.match(requests[0].body.messages.at(-1).content, /SC-E-101 = AST-1/);
  const toolMsg = requests[1].body.messages.find((x) => x.role === 'tool');
  assert.match(toolMsg.content, /"tag":"SC-E-101"/);
  const rejected = requests[2].body.messages.filter((x) => x.role === 'tool').at(-1);
  assert.match(rejected.content, /does not exist/);
  assert.deepEqual(m.steps.map((s) => s.ok), [true, false]);
  assert.ok(m.sources.some((s) => s.id === 'AST-1'));
  assert.ok(m.sources.some((s) => s.id === assetOne));
  assert.match(m.warnings.join(' '), /RIR-99999/);
  assert.ok(!m.warnings.join(' ').includes(assetOne));
  assert.equal(usageRows() - before, 3);
  modelConversation = body.conversation;
});

await check('Follow-up questions carry the conversation history', async () => {
  const requests = mockModel([{ content: 'Following up: no further data needed.' }]);
  const { status, body } = await json(await post({ question: 'And in one sentence?', conversationId: modelConversation.id }));
  assert.equal(status, 200);
  assert.equal(body.conversation.messages.length, 4);
  const roles = requests[0].body.messages.map((x) => x.role);
  assert.deepEqual(roles, ['system', 'user', 'assistant', 'user']);
});

await check('OpenAI reasoning models: unsupported settings are adjusted and remembered; one key location; short, on-topic prompt', async () => {
  clearModelEnv();
  Object.assign(process.env, { AI_BASE_URL: 'https://api.openai.com/v1', AI_MODEL: 'gpt-nano-test', OPENAI_API_KEY: 'sk-test-openai', AI_REASONING_EFFORT: 'minimal', AI_ANSWER_WORDS: '90' });
  const requests = [];
  const queue = [
    { status: 400, error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.", param: 'max_tokens', code: 'unsupported_parameter' } },
    { status: 400, error: { message: "Unsupported value: 'temperature' does not support 0.1 with this model. Only the default (1) value is supported.", param: 'temperature', code: 'unsupported_value' } },
    { content: "I'm Relia, and I can only help with questions about your iAPM reliability data and how to use iAPM." },
    { content: 'Second answer.' },
  ];
  globalThis.fetch = async (url, init) => {
    requests.push({ headers: init.headers, body: JSON.parse(init.body) });
    const next = queue.shift();
    if (next.status) return Response.json({ error: next.error }, { status: next.status });
    return Response.json({ model: 'gpt-nano-test', usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }, choices: [{ message: next }] });
  };
  const { status, body } = await json(await post({ question: 'What is the capital of France?' }));
  assert.equal(status, 200, JSON.stringify(body));
  const m = body.conversation.messages[1];
  assert.equal(m.engine, 'model');
  assert.match(m.content, /can only help with questions about your iAPM/);
  assert.equal(m.warnings.length, 0);
  assert.equal(requests.length, 3);
  assert.equal(requests[0].headers.Authorization, 'Bearer sk-test-openai');
  assert.equal(requests[0].body.max_tokens, 1200);
  assert.equal(requests[1].body.max_completion_tokens, 1200);
  assert.ok(!('max_tokens' in requests[1].body));
  assert.ok(!('temperature' in requests[2].body));
  assert.equal(requests[2].body.reasoning_effort, 'minimal');
  const system = requests[2].body.messages[0].content;
  assert.match(system, /Answer ONLY questions about this iAPM workspace/);
  assert.match(system, /under 90 words/);
  await post({ question: 'Top bad actors please' });
  assert.equal(requests.length, 4, 'adjustments remembered: no retries on the next question');
  assert.ok('max_completion_tokens' in requests[3].body && !('temperature' in requests[3].body));
  clearModelEnv();
  delete process.env.AI_REASONING_EFFORT;
  delete process.env.AI_ANSWER_WORDS;
  attachModel();
});

await check('Small-model fallback: tools rejected (400) → JSON protocol, <think> stripped', async () => {
  attachModel({ AI_API_KEY: 'test-key' });
  const requests = mockModel([
    { status: 400 },
    { content: '```json\n{"tool":"query_reliability","arguments":{"intent":"loss","limit":3}}\n```' },
    { content: '<think>reasoning here</think>{"answer":"The leading loss asset is SC-E-101 [AST-1]."}' },
  ]);
  const { status, body } = await json(await post({ question: 'Top 3 bad actors?' }));
  assert.equal(status, 200, JSON.stringify(body));
  const m = body.conversation.messages[1];
  assert.equal(m.engine, 'model');
  assert.equal(m.content, 'The leading loss asset is SC-E-101 [AST-1].');
  assert.equal(m.steps.length, 1);
  assert.ok(requests[1].body.tools === undefined && requests[2].body.tools === undefined);
  assert.match(requests[1].body.messages[0].content, /TOOLS\. To call a tool/);
  assert.match(requests[2].body.messages.at(-1).content, /TOOL RESULT \(query_reliability\)/);
  assert.equal(requests[1].headers.Authorization, 'Bearer test-key');
});

await check('Tool call written as text (<tool_call>) is executed', async () => {
  delete process.env.AI_API_KEY;
  mockModel([
    { content: '<tool_call>{"name":"search_incidents","arguments":{"query":"seal leakage","limit":3}}</tool_call>' },
    { content: 'Seal leakage records found.' },
  ]);
  const { body } = await json(await post({ question: 'Show seal leakage history' }));
  const m = body.conversation.messages[1];
  assert.equal(m.steps[0].tool, 'search_incidents');
  assert.ok(m.sources.length > 0 && m.sources.length <= 3);
});

await check('Model unreachable → guided answer with a visible notice', async () => {
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  const { status, body } = await json(await post({ question: 'Compare actual loss by site' }));
  assert.equal(status, 200);
  const m = body.conversation.messages[1];
  assert.equal(m.engine, 'guided');
  assert.match(m.notice, /could not be reached/);
});

await check('Tools run on frozen data: calculations work, mutation is impossible', () => {
  const data = deepFreeze(JSON.parse(baseline));
  const econ = runTool('query_reliability', { intent: 'economics', asset: 'SC-E-101' }, data, defaultAssumptions);
  assert.equal(econ.ok, true, econ.content);
  assert.match(econ.content, /NPV/);
  assert.throws(() => { data.assets[0].tag = 'HACKED'; }, TypeError);
  const bad = runTool('query_reliability', { intent: 'loss', site: 'Atlantis' }, data, defaultAssumptions);
  assert.equal(bad.ok, false);
  assert.match(bad.content, /Unknown site/);
  assert.equal(runTool('search_incidents', '{broken', data, defaultAssumptions).ok, false);
});

await check('Read-only guarantee: no business records written by any assistant request', async () => {
  assert.equal(businessRows(), 0);
  assert.equal(JSON.stringify(await ownerData('owner')), baseline);
});

await check('Owner isolation: conversations are private to their owner', async () => {
  rt.sql.prepare('INSERT INTO accounts VALUES(?,?,?,?)').run('other', 'other@example.invalid', 'h', 's');
  rt.sql.prepare('INSERT INTO sessions VALUES(?,?,?)').run(await digest('other-token'), 'other', Date.now() + 1e7);
  rt.context('other-token');
  assert.equal((await json(await route.GET())).body.conversations.length, 0);
  assert.equal((await post({ question: 'Continue please', conversationId: guidedConversation.id })).status, 404);
  rt.context('owner-token');
  // 7 conversations: the follow-up question extended an existing one.
  assert.equal((await json(await route.GET())).body.conversations.length, 7);
});

clearModelEnv();
console.log(JSON.stringify({ passed: passed.length, checks: passed }, null, 2));
console.log('PASS: assistant read-only, grounded and model-agnostic. Model responses mocked; a live model endpoint is not exercised.');
