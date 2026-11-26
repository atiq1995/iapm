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
sources.push(['app/api/assistant/reports/route.ts', 'assistant-reports-route', false]);
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
// Calculated headline for the all-asset actual-loss ranking (seed data, 1990–2026).
const TOP_LOSS_HEADLINE = '**SC-E-101 leads actual loss with $253.6M, 8.2% of the $3.1B total across 128 assets.**';
const check = (name, fn) => Promise.resolve(fn()).then(() => passed.push(name));
const ORIGIN = 'https://test.invalid';
const post = (body, origin = ORIGIN) => route.POST(new Request(ORIGIN + '/api/assistant', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) }));
const json = async (r) => ({ status: r.status, body: await r.json() });
const usageRows = () => rt.sql.prepare("SELECT COUNT(*) n FROM records WHERE kind='ai_usage'").get().n;
// Plant/business data. Relia's own rows (chat history, usage ledger, saved reports) are excluded.
const businessRows = () => rt.sql.prepare("SELECT COUNT(*) n FROM records WHERE kind NOT IN ('assistant_chat','ai_usage','relia_report')").get().n;
const reportsRoute = await load('assistant-reports-route.mjs');
const reportsPost = (b) => reportsRoute.POST(new Request('https://test.invalid/api/assistant/reports', { method: 'POST', headers: { Origin: 'https://test.invalid', 'Content-Type': 'application/json' }, body: JSON.stringify(b) }));
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
process.env.AI_RATE_PER_MINUTE = '1000'; // this suite sends many questions in seconds; the limit itself is tested at the end

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
await check('No model attached: chart answers are fully calculated, cited, and use no AI', async () => {
  globalThis.fetch = async () => { throw new Error('no network expected'); };
  const { status, body } = await json(await post({ question: 'Which are the top 5 bad actors by actual loss?' }));
  assert.equal(status, 200, JSON.stringify(body));
  const answer = body.conversation.messages[1];
  assert.equal(answer.engine, 'calculated');
  assert.ok(answer.sources.length > 0);
  assert.match(answer.notice, /guided query engine/);
  assert.ok(answer.content.startsWith(TOP_LOSS_HEADLINE), answer.content);
  assert.equal(answer.charts[0].kind, 'ranking');
  assert.equal(answer.charts[0].rows.length, 5);
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
    { content: `SC-E-101 [AST-1] is the top loss asset.\n- Latest event [${assetOne}].\n- See also [RIR-99999].` },
  ]);
  const { status, body } = await json(await post({ question: 'Tell me about SC-E-101' }));
  assert.equal(status, 200, JSON.stringify(body));
  const m = body.conversation.messages[1];
  assert.equal(m.engine, 'model');
  assert.equal(m.model, 'Relia Core');
  assert.equal(requests.length, 3);
  assert.equal(requests[0].url, 'https://model.test/v1/chat/completions');
  assert.equal(requests[0].body.model, 'relia-core-8b');
  assert.deepEqual(requests[0].body.tools.map((t) => t.function.name), ['build_chart', 'rank_assets', 'trend_over_time', 'query_reliability', 'search_incidents', 'get_asset_profile']);
  assert.ok(!('Authorization' in requests[0].headers), 'no key configured, so no auth header');
  assert.match(requests[0].body.messages.find((x) => x.role === 'user').content, /SC-E-101 = AST-1/);
  assert.equal(requests[0].body.messages.at(-1).role, 'tool', 'data retrieved before the first model call');
  const toolMsg = requests[1].body.messages.filter((x) => x.role === 'tool').at(-1);
  assert.match(toolMsg.content, /"tag":"SC-E-101"/);
  const rejected = requests[2].body.messages.filter((x) => x.role === 'tool').at(-1);
  assert.match(rejected.content, /does not exist/);
  assert.deepEqual(m.steps.map((s) => s.ok), [true, true, false]);
  assert.match(m.steps[0].summary, /^auto · /);
  assert.ok(m.sources.some((s) => s.id === 'AST-1'));
  assert.ok(m.sources.some((s) => s.id === assetOne));
  // The line citing a record that does not exist is removed before the user sees it.
  assert.ok(m.content.includes(assetOne));
  assert.doesNotMatch(m.content, /RIR-99999/);
  assert.match(m.warnings.join(' '), /1 statement was removed because it could not be verified/);
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
  await post({ question: 'Tell me about SC-E-101' });
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
  const { status, body } = await json(await post({ question: 'Tell me about SC-E-101' }));
  assert.equal(status, 200, JSON.stringify(body));
  const m = body.conversation.messages[1];
  assert.equal(m.engine, 'model');
  assert.equal(m.content, 'The leading loss asset is SC-E-101 [AST-1].');
  assert.equal(m.steps.length, 2);
  assert.equal(m.steps[0].tool, 'query_reliability');
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
  assert.equal(m.steps[1].tool, 'search_incidents');
  assert.ok(m.sources.length > 0);
});

await check("Client case: potential-loss question is answered entirely from the database, with no AI call", async () => {
  const requests = mockModel([]);
  const { status, body } = await json(await post({ question: 'Identify the asset with the highest potential business loss' }));
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(requests.length, 0);
  const m = body.conversation.messages[1];
  assert.equal(m.engine, 'calculated');
  assert.equal(m.steps[0].tool, 'rank_assets');
  assert.match(m.content, /^\*\*QW-E-209 leads potential exposure with \$21\.6M/);
  const chart = m.charts[0];
  assert.equal(chart.kind, 'ranking');
  assert.ok(chart.rows.every((r, i, a) => i === 0 || a[i - 1].value >= r.value), 'sorted highest first');
  assert.equal(m.warnings.length, 0);
});

await check("Client case: lazy reply ('provide the asset tag') triggers a forced database query", async () => {
  const requests = mockModel([
    { content: 'Please provide the asset tag so I can look it up.' },
    { content: null, tool_calls: [{ id: 'g1', type: 'function', function: { name: 'rank_assets', arguments: '{"metric":"actual_loss","limit":3}' } }] },
    { content: 'The top loss driver across all assets is SC-E-101 [AST-1].' },
  ]);
  const { status, body } = await json(await post({ question: 'Give me a quick read on this workspace please' }));
  assert.equal(status, 200, JSON.stringify(body));
  const m = body.conversation.messages[1];
  // The forced query produced a chart, so the answer is calculated and the third model call is skipped.
  assert.equal(requests.length, 2);
  assert.equal(requests[0].body.tool_choice, 'auto');
  assert.equal(requests[1].body.tool_choice, 'required');
  assert.match(requests[1].body.messages.at(-1).content, /full read access/);
  assert.equal(m.engine, 'calculated');
  assert.equal(m.designedBy, 'model');
  assert.ok(m.content.startsWith(TOP_LOSS_HEADLINE), m.content);
  assert.deepEqual(m.steps.map((s) => s.tool), ['rank_assets']);
  assert.equal(m.warnings.length, 0);
});

await check('A named asset stays pinned when the model drops it from a query', async () => {
  const requests = mockModel([
    { content: null, tool_calls: [{ id: 'p1', type: 'function', function: { name: 'query_reliability', arguments: '{"intent":"modes"}' } }] },
    { content: 'SC-E-101 [AST-1] fails mostly from seal leakage.' },
  ]);
  const { body } = await json(await post({ question: 'Why does SC-E-101 keep failing?' }));
  const m = body.conversation.messages[1];
  assert.deepEqual(m.steps.map((s) => s.tool), ['query_reliability', 'query_reliability']);
  assert.match(m.steps[1].summary, /SC-E-101/, 'second query kept the asset');
  assert.match(requests[1].body.messages.at(-1).content, /SC-E-101/);
});

await check('Priority questions are answered from the top loss drivers; offers like "If you want, I can…" are retried', async () => {
  const none = mockModel([]);
  const focus = (await json(await post({ question: 'What should I focus on first?' }))).body.conversation.messages[1];
  assert.equal(none.length, 0);
  assert.equal(focus.steps[0].tool, 'rank_assets');
  assert.ok(focus.content.startsWith(TOP_LOSS_HEADLINE), focus.content);
  const requests = mockModel([
    { content: 'Focus on SC-E-101 [AST-1]. If you want, I can fetch more details.' },
    { content: 'Focus on SC-E-101 [AST-1], the largest actual-loss asset.' },
  ]);
  const m = (await json(await post({ question: 'Tell me about Safa Coast' }))).body.conversation.messages[1];
  assert.equal(requests.length, 2);
  assert.match(requests[1].body.messages.at(-1).content, /Do not ask the user/);
  assert.equal(m.content, 'Focus on SC-E-101 [AST-1], the largest actual-loss asset.');
});

await check('Write requests get a fixed read-only reply naming the right screen, with no model call', async () => {
  const requests = mockModel([]);
  const incidents = (await json(await post({ question: 'Please delete all draft incidents now' }))).body.conversation.messages[1];
  assert.equal(requests.length, 0);
  assert.match(incidents.content, /read-only/);
  assert.match(incidents.content, /Incidents & MEDFI/);
  const asset = (await json(await post({ question: 'Delete asset SC-E-101' }))).body.conversation.messages[1];
  assert.match(asset.content, /Asset register/);
  assert.equal(requests.length, 0);
});

await check('Wrong tag/ID pairs written by the model are corrected; tool names are replaced', async () => {
  const { polishAnswer } = await load('assistant-engine.mjs');
  const data = JSON.parse(baseline);
  const tag2 = data.assets.find((a) => a.id === 'AST-2').tag;
  const out = polishAnswer('SC-E-101 [AST-7] and AST-9 (SC-E-101) and ' + tag2 + ' [AST-2]. Source: rank_assets.', data);
  assert.equal(out, `SC-E-101 [AST-1] and AST-1 (SC-E-101) and ${tag2} [AST-2]. Source: the asset ranking.`);
  const echo = polishAnswer('Key figures (from display):\n- Peak: 104 in 2023 [trend_over_time result]\n- 2026: 95 [latest] [RIR-04609]\nNotes:\n- Values copied exactly from display; no reformatting.', data);
  assert.equal(echo, 'Key figures:\n- Peak: 104 in 2023\n- 2026: 95 [RIR-04609]\nNotes:');
});

await check('rank_assets matches the Bad actors calculation and rejects bad input', () => {
  const data = deepFreeze(JSON.parse(baseline));
  const r = runTool('rank_assets', { metric: 'potential_loss', site: 'safa coast', limit: 5 }, data, defaultAssumptions);
  assert.equal(r.ok, true, r.content);
  const j = JSON.parse(r.content);
  assert.equal(j.ranking.length, 5);
  assert.ok(j.ranking.every((x) => x.site === 'Safa Coast'));
  assert.equal(r.sources.length, 5);
  assert.equal(runTool('rank_assets', { metric: 'profit' }, data, defaultAssumptions).ok, false);
});

await check('Trend tool: same numbers as the Executive overview chart engine; monthly for short spans; history clamp', async () => {
  const { factsFor, groupFacts } = await load('visual-analytics.mjs');
  const data = deepFreeze(JSON.parse(baseline));
  const t = runTool('trend_over_time', { metric: 'failures', site: 'Safa Coast', from: 2000, to: 2026 }, data, defaultAssumptions);
  assert.equal(t.ok, true, t.content);
  const rows = data.incidents.filter((e) => data.assets.find((a) => a.id === e.assetId).site === 'Safa Coast' && +e.date.slice(0, 4) >= 2000);
  const expected = Object.fromEntries(groupFacts(factsFor(data, rows), 'year').map((g) => [g.name, g.events]));
  assert.equal(t.chart.points.length, 27);
  for (const p of t.chart.points) assert.equal(p.value, expected[p.period] || 0, `year ${p.period}`);
  assert.ok(!t.content.includes('"points"'), 'model gets a summary, not the full series');
  assert.ok(t.content.length < 1500);
  const monthly = runTool('trend_over_time', { metric: 'actual_loss', asset: 'SC-E-101', from: 2024, to: 2025 }, data, defaultAssumptions);
  assert.equal(monthly.chart.interval, 'month');
  assert.equal(monthly.chart.points.length, 24);
  assert.equal(monthly.chart.filters.asset, 'AST-1');
  const clamped = runTool('trend_over_time', { metric: 'downtime', from: 2020, to: 2040 }, data, defaultAssumptions);
  assert.equal(clamped.chart.points.at(-1).period, '2026');
  assert.equal(runTool('trend_over_time', { metric: 'failures', from: 2030, to: 2040 }, data, defaultAssumptions).ok, false);
});

await check('"Plot the failure trend for SC-E-101 since 2010": calculated chart and text, no AI call, saved with the answer', async () => {
  const requests = mockModel([]);
  const { status, body } = await json(await post({ question: 'Plot the failure trend for SC-E-101 since 2010' }));
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(requests.length, 0);
  const m = body.conversation.messages[1];
  assert.equal(m.engine, 'calculated');
  assert.match(m.content, /^\*\*Downtime events for SC-E-101 .* over 2010–2026/);
  assert.equal(m.steps[0].tool, 'trend_over_time');
  assert.equal(m.charts.length, 1);
  assert.equal(m.charts[0].points[0].period, '2010');
  assert.equal(m.charts[0].points.at(-1).period, '2026');
  assert.equal(m.charts[0].filters.asset, 'AST-1');
});

await check('Figure check: a garbled total (real case: 97,395,033,600 for 973,950,336) is flagged; correct figures pass', async () => {
  const { unmatchedFigures } = await load('assistant-engine.mjs');
  const known = [973950336, 26322982, 35596618, 3846.3, 21554713];
  assert.deepEqual(unmatchedFigures('Total actual loss: 97,395,033,600 USD.', known), ['97,395,033,600']);
  assert.deepEqual(unmatchedFigures('Total 973,950,336 USD (≈ $974M); peak 35,596,618 in 1990; MTBF 3,846.3 h; $21.6M exposure. SC-E-101 [RIR-04609] 2010–2026, 95 events.', known), []);
  assert.deepEqual(unmatchedFigures('About $3.2B lost.', known), ['3.2B']);
  // In a written answer, the line with the garbled figure is removed; the verified line stays.
  mockModel([{ content: 'Safa Coast is a major contributor to loss [AST-1].\n- Actual loss totals 97,395,033,600 USD since 1990.' }]);
  const { body } = await json(await post({ question: 'Tell me about Safa Coast' }));
  const m = body.conversation.messages[1];
  assert.equal(m.content, 'Safa Coast is a major contributor to loss [AST-1].');
  assert.doesNotMatch(m.content, /97/);
  assert.match(m.warnings.join(' '), /1 statement was removed because it could not be verified/);
  // If nothing verifiable is left, the user gets the calculated guided answer instead.
  mockModel([{ content: 'Total loss was 12,345,678,901 USD.' }]);
  const all = (await json(await post({ question: 'Tell me about Safa Coast' }))).body.conversation.messages[1];
  assert.equal(all.engine, 'guided');
  assert.doesNotMatch(all.content, /12,345|12\.3B/);
  assert.match(all.notice, /could not be verified/);
});

await check('"Create a tabulated summary" is answered (not refused); creating records is still refused', async () => {
  const requests = mockModel([{ content: '| Site | Actual loss |\n|---|---|\n| Safa Coast | $271.1M |' }]);
  const table = (await json(await post({ question: 'Create a tabulated summary' }))).body.conversation.messages[1];
  assert.equal(requests.length, 1);
  assert.equal(table.engine, 'model');
  assert.doesNotMatch(table.content, /read-only/);
  for (const q of ['Make a chart of failures per year', 'Add a comparison table by site', 'Generate a report of top losses']) {
    mockModel([{ content: 'Done.' }]);
    assert.doesNotMatch((await json(await post({ question: q }))).body.conversation.messages[1].content, /read-only/, q);
  }
  const before = requests.length;
  const incident = (await json(await post({ question: 'Create a new incident for SC-E-101' }))).body.conversation.messages[1];
  assert.match(incident.content, /read-only.*Incidents & MEDFI/s);
  const action = (await json(await post({ question: 'Please add an action for the pump' }))).body.conversation.messages[1];
  assert.match(action.content, /read-only.*Recommendations & actions/s);
  assert.equal(requests.length, before, 'no model call for record changes');
});

await check('Site comparison (comparative analysis): totals equal the Bad actors aggregate; calculated, no AI call', async () => {
  const { aggregate } = await load('domain.mjs');
  const requests = mockModel([]);
  const { body } = await json(await post({ question: 'Compare actual loss across sites from 2016 to 2025.' }));
  const m = body.conversation.messages[1];
  assert.equal(requests.length, 0);
  assert.equal(m.engine, 'calculated');
  const chart = m.charts[0];
  assert.equal(chart.kind, 'chart');
  assert.equal(chart.type, 'compare');
  assert.equal(chart.categories.length, 4);
  const data = JSON.parse(baseline);
  const rows = data.incidents.filter((e) => +e.date.slice(0, 4) >= 2016 && +e.date.slice(0, 4) <= 2025);
  const perSite = {};
  for (const r of aggregate(data, rows)) perSite[r.site] = (perSite[r.site] || 0) + r.loss;
  chart.categories.forEach((site, i) => assert.equal(chart.series[0].values[i], Math.round(perSite[site]), site));
  assert.match(m.content, /^\*\*Safa Coast leads actual business loss among the 4 compared with \$271\.1M, about a third \(32\.6%\)/);
  assert.equal(chart.table.columns[0], 'Measure');
  assert.doesNotMatch(m.content, /RIR-/, 'no incident IDs for portfolio totals');
});

await check('Follow-up "Create a tabulated summary" re-uses the previous question\'s data (site comparison), not a generic overview', async () => {
  const requests = mockModel([]);
  const first = (await json(await post({ question: 'Compare actual loss across sites from 2016 to 2025.' }))).body.conversation;
  const second = (await json(await post({ question: 'Create a tabulated summary', conversationId: first.id }))).body.conversation.messages.at(-1);
  assert.equal(requests.length, 0);
  assert.equal(second.charts[0].type, 'table');
  assert.equal(second.charts[0].spec.dimension, 'site');
  assert.equal(second.charts[0].spec.filters.from, 2016);
  assert.equal(second.charts[0].table.rows.length, 4);
  // "make it a donut" changes only the chart type.
  const third = (await json(await post({ question: 'make it a donut', conversationId: first.id }))).body.conversation.messages.at(-1);
  assert.equal(third.charts[0].type, 'donut');
  assert.equal(third.charts[0].spec.metric, 'loss');
  assert.equal(third.charts[0].spec.filters.to, 2025);
  const { isReferentialFollowUp } = await load('assistant-engine.mjs');
  const data = JSON.parse(baseline);
  for (const q of ['Create a tabulated summary', 'chart it', 'Summarize that as bullets', 'Can you put this in a table?']) assert.ok(isReferentialFollowUp(q, data), q);
  for (const q of ['Plot the failure trend for SC-E-101', 'Summarize losses at Safa Coast', 'Table of MTBF by asset']) assert.ok(!isReferentialFollowUp(q, data), q);
});

await check('Key facts use accurate proportion words (32.6% → "about a third", never "majority")', async () => {
  const { shareWords } = await load('assistant-tools.mjs');
  assert.equal(shareWords(32.6), 'about a third (32.6%)');
  assert.equal(shareWords(8.2), '8.2%');
  assert.equal(shareWords(55), 'the majority (55%)');
  const data = deepFreeze(JSON.parse(baseline));
  const r = runTool('rank_assets', { metric: 'actual_loss', group_by: 'site', from: 2016, to: 2025 }, data, defaultAssumptions);
  const facts = JSON.parse(r.content).keyFacts;
  assert.match(facts[0], /^Safa Coast leads actual loss with \$271\.1M, about a third \(32\.6%\) of the \$832\.\dM total across 4 sites\.$/);
  assert.doesNotMatch(facts.join(' '), /majority/);
  const t = JSON.parse(runTool('trend_over_time', { metric: 'failures' }, data, defaultAssumptions).content);
  assert.match(t.direction, /^(broadly flat|rose|fell)/);
});

await check('Calculated headline replaces the model\'s; overstated words are toned down (real model phrases)', async () => {
  const { applyHeadline } = await load('assistant-engine.mjs');
  const H = 'Safa Coast leads actual loss with $271.1M, about a third (32.6%) of the $832.2M total across 4 sites.';
  const out = applyHeadline('**Safa Coast dominates actual loss across sites.**\n\n- Safa Coast is the dominant site.\n- Top five account for the bulk of losses; one asset drives most loss.', H, 32.6);
  assert.equal(out, `**${H}**\n\n- Safa Coast is the leading site.\n- Top five account for a large share of losses; one asset drives the largest share of loss.`);
  assert.equal(applyHeadline('No headline here.', H, 32.6), `**${H}**\n\nNo headline here.`);
  assert.match(applyHeadline('**X dominates.**', 'X leads.', 62), /\*\*X leads\.\*\*/);
  assert.equal(applyHeadline('Ann dominates', '', 62), 'Ann dominates', 'no toning down when the share really is a majority');
  const data = deepFreeze(JSON.parse(baseline));
  const t = JSON.parse(runTool('trend_over_time', { metric: 'failures' }, data, defaultAssumptions).content);
  assert.equal(t.headline, 'Downtime events across all sites were broadly flat over 1990–2026, peaking at 104 events in 2023.');
  const s = JSON.parse(runTool('trend_over_time', { metric: 'actual_loss', site: 'Safa Coast' }, data, defaultAssumptions).content);
  assert.match(s.headline, /^Actual business loss at Safa Coast (was broadly flat|rose \d+%|fell \d+%) over 1990–2026, peaking at \$35\.6M in 1990\.$/);
});

await check('MTBF ranking chart uses verified MTBF hours, lowest first', async () => {
  const data = deepFreeze(JSON.parse(baseline));
  const r = runTool('query_reliability', { intent: 'mtbf', ascending: true, limit: 5 }, data, defaultAssumptions);
  assert.equal(r.chart.kind, 'ranking');
  assert.equal(r.chart.unit, 'hours');
  assert.equal(r.chart.rows[0].label, 'SC-E-101');
  assert.equal(r.chart.rows[0].value, 3846);
  assert.ok(r.chart.rows.every((x, i, a) => i === 0 || a[i - 1].value <= x.value));
});

await check('Executive number formatting: cents and long USD figures become $271.1M; percentages one decimal', async () => {
  const { polishAnswer } = await load('assistant-engine.mjs');
  const data = JSON.parse(baseline);
  assert.equal(polishAnswer('Safa Coast: $271,145,173.33 (32.58% of total); total 973,950,336 USD; repair $18,500.75.', data), 'Safa Coast: $271.1M (32.6% of total); total $974M; repair $18,501.');
  // Real model table: money column shortened; share and event columns untouched.
  const table = polishAnswer('| Site | Actual Loss USD | Share of Total % | F1 events |\n|---|---|---|---|\n| Safa Coast | 271,145,173 | 32.6 | 1,257 |\n| Mizan Bay | 190,090,589 | 22.8 | 1,240 |', data);
  assert.equal(table, '| Site | Actual Loss USD | Share of Total % | F1 events |\n|---|---|---|---|\n| Safa Coast | $271.1M | 32.6 | 1,257 |\n| Mizan Bay | $190.1M | 22.8 | 1,240 |');
  const { applyHeadline } = await load('assistant-engine.mjs');
  assert.equal(applyHeadline('- 32.6% of total, a clear majority among top contributors.', '', 32.6), '- 32.6% of total, the largest share among top contributors.');
});

await check('Trend questions are answered from data even when the model is down (it is never called)', async () => {
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  const { body } = await json(await post({ question: 'Show downtime per year at Wadi North for the last 10 years' }));
  const m = body.conversation.messages[1];
  assert.equal(m.engine, 'calculated');
  assert.equal(m.notice, undefined);
  assert.equal(m.charts.length, 1);
  assert.equal(m.charts[0].points.length, 10);
  assert.equal(m.charts[0].filters.site, 'Wadi North');
  assert.match(m.content, /^\*\*Virtual downtime at Wadi North .* over 2017–2026/);
});

await check('Model unreachable → guided answer with a visible notice', async () => {
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  const { status, body } = await json(await post({ question: 'Tell me about SC-E-101' }));
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

await check('Client chart list: pie, donut, bar, line, stacked, clustered, bubble, comparison: all calculated, no AI call', async () => {
  const requests = mockModel([]);
  const cases = [
    ['Show a pie chart of actual loss by site', 'pie', 'loss', 'site'],
    ['Donut chart of downtime by failure mode at Wadi North since 2015', 'donut', 'days', 'mode'],
    ['Bar graph of downtime by category', 'bar', 'days', 'category'],
    ['Line chart of loss per year by site', 'line', 'loss', 'year'],
    ['Stacked bar of failures per year by site', 'stacked', 'events', 'year'],
    ['Clustered bar of actual loss by site and category', 'clustered', 'loss', 'site'],
    ['Bubble chart of downtime vs loss by site', 'bubble', 'loss', 'site'],
    ['Compare Safa Coast vs Wadi North', 'compare', 'loss', 'site'],
    ['Compare 2010-2015 vs 2020-2025', 'compare', 'loss', 'year'],
  ];
  for (const [q, type, metric, dim] of cases) {
    const m = (await json(await post({ question: q }))).body.conversation.messages[1];
    const c = m.charts[0];
    assert.equal(m.engine, 'calculated', q);
    assert.equal(c.kind, 'chart', q);
    assert.equal(c.type, type, q);
    assert.equal(c.spec.metric, metric, q);
    assert.equal(c.spec.dimension, dim, q);
    assert.ok(c.table.rows.length > 0, q);
    assert.ok(m.content.startsWith('**') && !m.content.includes('undefined') && !m.content.includes('NaN'), `${q}: ${m.content}`);
  }
  assert.equal(requests.length, 0);
});

await check('Chart numbers match the Executive overview engine exactly (pie shares, stacked totals, bubble axes, filters)', async () => {
  const { factsFor, groupFacts } = await load('visual-analytics.mjs');
  const { buildChart } = await load('assistant-charts.mjs');
  const data = deepFreeze(JSON.parse(baseline));
  const facts = factsFor(data, data.incidents);
  const pie = buildChart(data, { type: 'pie', metric: 'loss', dimension: 'site' });
  const bySite = Object.fromEntries(groupFacts(facts, 'site').map((g) => [g.name, Math.round(g.loss)]));
  pie.categories.forEach((s, i) => assert.equal(pie.series[0].values[i], bySite[s], s));
  const stacked = buildChart(data, { type: 'stacked', metric: 'events', dimension: 'year', series: 'site' });
  const byYear = Object.fromEntries(groupFacts(facts, 'year').map((g) => [g.name, g.events]));
  stacked.categories.forEach((y, i) => assert.equal(stacked.series.reduce((s, x) => s + x.values[i], 0), byYear[y] || 0, y));
  const bubble = buildChart(data, { type: 'bubble', metric: 'loss', dimension: 'site', x: 'days', y: 'loss', size: 'exposure' });
  const bySiteG = Object.fromEntries(groupFacts(facts, 'site').map((g) => [g.name, g]));
  for (const p of bubble.points) {
    assert.equal(p.y, Math.round(bySiteG[p.label].loss));
    assert.equal(p.x, Math.round(bySiteG[p.label].days * 10) / 10);
  }
  const wn = buildChart(data, { type: 'donut', metric: 'days', dimension: 'mode', filters: { site: 'wadi north', from: 2015 } });
  const wnFacts = factsFor(data, data.incidents.filter((e) => data.assets.find((a) => a.id === e.assetId).site === 'Wadi North' && +e.date.slice(0, 4) >= 2015));
  const wnTotal = wnFacts.reduce((s, f) => s + f.days, 0);
  assert.ok(Math.abs(wn.series[0].values.reduce((s, v) => s + v, 0) - wnTotal) < 0.5);
  assert.equal(wn.spec.filters.site, 'Wadi North', 'names normalised');
  assert.throws(() => buildChart(data, { type: 'pie', metric: 'loss', dimension: 'site', filters: { site: 'Atlantis' } }), /Unknown site/);
});

await check('Requests the parser does not recognise: the AI chooses build_chart, the answer is calculated (one model call)', async () => {
  const requests = mockModel([{ content: null, tool_calls: [{ id: 'b1', type: 'function', function: { name: 'build_chart', arguments: JSON.stringify({ type: 'hbar', metric: 'repair', dimension: 'mode', series: '', filters: { site: 'Mizan Bay' } }) } }] }]);
  const m = (await json(await post({ question: 'Visualise the repair effort across failure modes at Mizan Bay' }))).body.conversation.messages[1];
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.tools[0].function.name, 'build_chart');
  assert.equal(m.engine, 'calculated');
  assert.equal(m.designedBy, 'model');
  assert.equal(m.charts[0].type, 'hbar');
  assert.equal(m.charts[0].spec.filters.site, 'Mizan Bay');
  assert.match(m.content, /^\*\*.+ leads repair effort with .+ hours/);
  // Invalid choices are rejected, never charted.
  const bad = runTool('build_chart', { type: 'pie', metric: 'loss', dimension: 'site', filters: { site: 'Atlantis' } }, deepFreeze(JSON.parse(baseline)), defaultAssumptions);
  assert.equal(bad.ok, false);
  assert.match(bad.content, /Unknown site/);
});

await check('Guard on the AI\'s chart choice: the question\'s own words win (real case: "repair effort" charted as maintenance cost by asset)', async () => {
  const requests = mockModel([{ content: null, tool_calls: [{ id: 'g2', type: 'function', function: { name: 'build_chart', arguments: JSON.stringify({ type: 'clustered', metric: 'maintenance', dimension: 'mode', series: 'asset', filters: { site: 'Mizan Bay' } }) } }] }]);
  // (The original wording is now understood without the AI; this phrasing still goes to the AI.)
  const m = (await json(await post({ question: 'Visualise repair effort for each failure mode at Mizan Bay' }))).body.conversation.messages[1];
  assert.equal(requests.length, 1);
  const c = m.charts[0];
  assert.equal(c.spec.metric, 'repair', 'measure named in the question');
  assert.equal(c.spec.dimension, 'mode');
  assert.equal(c.spec.series, null, 'no second grouping the user did not ask for');
  assert.equal(c.type, 'bar');
  assert.equal(c.spec.filters.site, 'Mizan Bay');
  const { reconcileWithQuestion } = await load('assistant-charts.mjs');
  const data = JSON.parse(baseline);
  const r = reconcileWithQuestion({ type: 'bar', metric: 'loss', dimension: 'site', filters: {} }, 'Donut of downtime by category for SC-E-101 since 2015', data);
  assert.deepEqual([r.type, r.metric, r.dimension, r.filters.asset, r.filters.from, r.filters.to], ['donut', 'days', 'category', 'SC-E-101', 2015, 2026]);
});

await check('Live-test gaps fixed: "break down by", ranking-tool misuse corrected, unrecorded data explained, clean headline grammar', async () => {
  const none = mockModel([]);
  const breakdown = (await json(await post({ question: 'How does production loss break down by unit?' }))).body.conversation.messages[1];
  assert.equal(none.length, 0, 'understood without the AI');
  assert.equal(breakdown.charts[0].type, 'bar');
  assert.equal(breakdown.charts[0].spec.metric, 'production');
  assert.equal(breakdown.charts[0].spec.dimension, 'unit');
  // The AI picks the ranking tool (actual loss) for a production question → switched to the builder.
  const requests = mockModel([{ content: null, tool_calls: [{ id: 'r9', type: 'function', function: { name: 'rank_assets', arguments: '{"metric":"actual_loss"}' } }] }]);
  const fixed = (await json(await post({ question: 'Which units lose the most production?' }))).body.conversation.messages[1];
  assert.equal(requests.length, 1);
  assert.equal(fixed.steps.at(-1).tool, 'build_chart');
  assert.equal(fixed.charts[0].spec.metric, 'production');
  // Data iAPM does not record: a clear answer, never the off-topic reply, never a guess.
  const energy = (await json(await post({ question: 'Show me energy consumption per pump' }))).body.conversation.messages[1];
  assert.match(energy.content, /^\*\*iAPM doesn't record energy consumption/);
  assert.doesNotMatch(energy.content, /can only help with questions/);
  assert.equal(energy.charts, undefined);
  const area = (await json(await post({ question: 'Give me an area chart of potential exposure per year for Instrumentation' }))).body.conversation.messages[1];
  assert.match(area.content, /^\*\*Potential business exposure in Instrumentation totalled \$344\.7M over 1990–2026 and (remained broadly flat|rose \d+%|fell \d+%), peaking at \$16\.5M in 2011\.\*\*/);
});

let savedId = '';
await check('Saved reports: save a chart; asking again shows it directly (no prompt); by name; by click; duplicates reuse', async () => {
  const requests = mockModel([]);
  const first = (await json(await post({ question: 'Stacked bar of failures per year by site' }))).body.conversation.messages[1];
  const save = await json(await reportsPost({ action: 'save', name: 'Failures by site per year', spec: first.charts[0].spec, question: 'Stacked bar of failures per year by site' }));
  assert.equal(save.status, 200, JSON.stringify(save.body));
  savedId = save.body.report.id;
  assert.equal(save.body.existing, false);
  // Same chart asked differently → the saved report is shown straight away.
  const again = (await json(await post({ question: 'stacked chart of downtime events per year by site' }))).body.conversation.messages[1];
  assert.equal(again.report.id, savedId);
  assert.equal(again.designedBy, 'saved');
  assert.equal(again.charts[0].type, 'stacked');
  // By name.
  const byName = (await json(await post({ question: 'Show my failures by site per year report' }))).body.conversation.messages[1];
  assert.equal(byName.report.id, savedId);
  // By click (reportId), and listed for the sidebar.
  const click = (await json(await post({ reportId: savedId }))).body.conversation;
  assert.equal(click.messages[0].content, 'Failures by site per year');
  assert.equal(click.messages[1].report.name, 'Failures by site per year');
  const listed = (await json(await route.GET())).body.reports;
  assert.deepEqual(listed.map((r) => r.name), ['Failures by site per year']);
  // Saving the same recipe again reuses the existing report.
  const dup = await json(await reportsPost({ action: 'save', name: 'Copy', spec: first.charts[0].spec }));
  assert.equal(dup.body.existing, true);
  assert.equal(dup.body.report.id, savedId);
  assert.equal(requests.length, 0, 'saved reports never call the AI');
});

await check('Saved reports: rename, delete, validation, and privacy between accounts', async () => {
  const renamed = await json(await reportsPost({ action: 'rename', id: savedId, name: 'Yearly failures by site' }));
  assert.equal(renamed.body.report.name, 'Yearly failures by site');
  assert.equal((await reportsPost({ action: 'save', name: 'Bad', spec: { type: 'pie', metric: 'loss', dimension: 'site', filters: { site: 'Atlantis' } } })).status, 400);
  assert.equal((await reportsPost({ action: 'save', name: '   ', spec: { type: 'pie' } })).status, 400);
  assert.equal((await reportsRoute.POST(new Request('https://test.invalid/api/assistant/reports', { method: 'POST', headers: { Origin: 'https://evil.invalid' }, body: '{}' }))).status, 403);
  rt.sql.prepare('INSERT OR IGNORE INTO accounts VALUES(?,?,?,?)').run('stranger', 'stranger@example.invalid', 'h', 's');
  rt.sql.prepare('INSERT INTO sessions VALUES(?,?,?)').run(await digest('stranger-token'), 'stranger', Date.now() + 1e7);
  rt.context('stranger-token');
  assert.equal((await json(await reportsRoute.GET())).body.reports.length, 0);
  assert.equal((await post({ reportId: savedId })).status, 404);
  assert.equal((await reportsPost({ action: 'delete', id: savedId })).status, 404);
  rt.context('owner-token');
  assert.equal((await reportsPost({ action: 'delete', id: savedId })).status, 200);
  assert.equal((await json(await reportsRoute.GET())).body.reports.length, 0);
});

await check('Verified text: stripUnverified removes only the lines that fail verification', async () => {
  const { stripUnverified } = await load('assistant-engine.mjs');
  assert.deepEqual(stripUnverified('**Headline**\n- good line\n- bad $97.4B line\n- also good', ['97.4B']), { text: '**Headline**\n- good line\n- also good', removed: 1 });
  assert.deepEqual(stripUnverified('nothing to remove', []), { text: 'nothing to remove', removed: 0 });
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
  // The owner sees exactly their own saved conversations (up to the 30 listed).
  const saved = rt.sql.prepare("SELECT COUNT(*) n FROM records WHERE owner='owner' AND kind='assistant_chat'").get().n;
  assert.ok(saved > 10);
  assert.equal((await json(await route.GET())).body.conversations.length, Math.min(saved, 30));
});

await check('Rate limit: questions beyond the per-minute limit are refused with 429', async () => {
  clearModelEnv();
  process.env.AI_RATE_PER_MINUTE = '1';
  rt.sql.prepare('INSERT INTO accounts VALUES(?,?,?,?)').run('limited', 'limited@example.invalid', 'h', 's');
  rt.sql.prepare('INSERT INTO sessions VALUES(?,?,?)').run(await digest('limited-token'), 'limited', Date.now() + 1e7);
  rt.context('limited-token');
  assert.equal((await post({ question: 'Compare actual loss by site' })).status, 200);
  const blocked = await json(await post({ question: 'Compare actual loss by site' }));
  assert.equal(blocked.status, 429);
  assert.match(blocked.body.error, /Too many questions/);
  delete process.env.AI_RATE_PER_MINUTE;
});

clearModelEnv();
console.log(JSON.stringify({ passed: passed.length, checks: passed }, null, 2));
console.log('PASS: assistant read-only, grounded and model-agnostic. Model responses mocked; a live model endpoint is not exercised.');
