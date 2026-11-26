# Relia: read-only reliability AI

Relia is the conversational assistant on **Overview → Reliability assistant → Chat with Relia**.
It answers plain-English questions about the owner's reliability data and cannot change anything.

## Accuracy rule

**Every number the user sees comes from the database.**

* **Charts and reports** (any type: pie, donut, bar, horizontal bar, line, area, stacked, clustered, bubble, table, side-by-side comparison) are built by code from a small *recipe* (type, measure, grouping, filters) using the Executive overview chart engine. The headline, key facts, chart and table are all calculated; the AI writes none of it. When the AI is involved, it only chooses the recipe, and anything the question states explicitly (measure, grouping, site, years, chart type) overrides the AI's choice.
* **Explanations** ("why…", "what happened…") are written by the AI from read-only tool results. Before the user sees them, every line with a figure that does not match the retrieved data, or a record ID that does not exist, is removed; if nothing verifiable remains, the guided engine answers instead.
* **Data iAPM does not record** (energy, sensor readings, inventory, workforce…) gets a clear "not recorded" answer and the list of what can be shown. Nothing is estimated.

## Order of answering

1. Change request → fixed read-only reply.
2. Unrecorded data → "not recorded" reply.
3. Saved report clicked, named in the question, or matching the requested chart → shown directly (no AI).
4. Chart request in plain English ("donut of downtime by failure mode at Wadi North since 2015", "compare Safa Coast vs Wadi North", "make it a pie") → calculated chart (no AI).
5. Common questions (losses, potential, MTBF, trends, priorities) → calculated chart (no AI).
6. Everything else → AI with read-only tools (including `build_chart`), verified as above.

## Saved reports

Any chart can be saved with **Save report** (stored as a recipe, never as numbers, so it always shows current data). Saved reports appear in Relia's sidebar to run, rename or delete. Asking for a chart that a saved report already covers shows that report directly. API: `GET/POST /api/assistant/reports` (`save`, `rename`, `delete`); running a report is `POST /api/assistant` with `{ reportId }`. Reports are per account and stored in Relia's own library (kind `relia_report`); plant data stays read-only.

## How it works

```
User question
   │
   ▼
/api/assistant  (signed-in owner, same-origin, size + rate limits)
   │  loads the owner's dataset once and deep-freezes it
   ▼
Language model  ◄──── tool results (JSON) ────┐
   │  asks for a tool                          │
   ▼                                           │
Read-only tools (lib/assistant/tools.ts) ──────┘
   build_chart        → any chart type for any measure × grouping × filters (lib/assistant/charts.ts)
   rank_assets        → portfolio ranking: actual loss, potential (F2) exposure, downtime, maintenance, events
                        (same calculation as the Bad actors screen)
   trend_over_time    → per-year (or per-month) trend with a chart in the answer; same metric definitions
                        as the Executive overview chart studio. Chart data goes straight to the browser;
                        the model only receives a short summary with pre-formatted figures.
   query_reliability  → shared iAPM engine (loss, MTBF, criticality, MEDFI, sites, economics, forecast)
   search_incidents   → keyword search over RIR narratives, causes, actions
   get_asset_profile  → one asset: register, MTBF, loss, stages, failure modes, open actions
   │
   ▼
Answer → citation check (every RIR/AST/ACT ID must exist) → saved conversation
```

* **Retrieval first.** Common questions (losses, potential exposure, MTBF, incidents, priorities, one named asset) are answered from data fetched *before* the model is called, so even a small model starts from database facts.
* **No lazy answers.** If the model answers without data, asks the user for an asset tag, or offers "If you want, I can…", it is sent back once and required to query.
* **Named asset stays pinned.** When the question names one asset, queries the model sends without an asset keep that asset.
* **Change requests** ("delete…", "approve…") get a fixed read-only reply naming the right iAPM screen, without calling the model.
* **ID correction.** Every "TAG [AST-n]" pair in an answer is checked against the register and corrected if the model mismatched them.
* **Figure check.** Every number above 100 in an answer must match a number in the data retrieved for it; otherwise the answer shows an amber warning naming the figure.
* **Trend charts.** Questions with "trend", "plot", "chart", "per year", "over time" and similar get a chart (bars for event counts, a line for money and days) with an **Open in Executive overview** button that applies the same filters. Charts also work with no model attached.
* **Executive answers.** Rankings and comparisons (bad actors, sites, categories, MTBF) show a bar chart plus a table; trends show a chart with an optional data table. The **headline is calculated** from the data (e.g. "Safa Coast leads actual loss with $271.1M, about a third (32.6%) of the $832.2M total"), replacing the model's own; when no item exceeds 50% of the total, words such as "dominates", "majority" and "the bulk of" are toned down. Money is shown as $271.1M and percentages with one decimal.
* **Follow-ups.** Short presentation requests ("Create a tabulated summary", "chart it") re-use the previous question's data.
* **Reasoning effort.** With `gpt-5-nano`, `AI_REASONING_EFFORT=low` gives noticeably more accurate commentary than `minimal` (about 5–8 s per answer instead of 3–5 s; still a fraction of a cent).
* **Rate limit.** `AI_RATE_PER_MINUTE` (default 15) questions per minute per account, per server instance.
* **Numbers come from the iAPM engine**, never from the model. The model only chooses tools and writes the explanation.
* **Read-only by construction.** Tools receive a frozen in-memory copy of the data and no database handle. Unknown tool names (for example `delete_asset`) are rejected. The route writes only the owner's conversation history (`assistant_chat`) and the usage ledger (`ai_usage`).
* **Hallucination check.** Any cited record ID that does not exist is shown in amber as *unverified*, with a warning under the answer. Real IDs become clickable and open the record.
* **Prompt-injection defence.** Narratives and tool output are declared untrusted data in the system prompt, and tool arguments are re-validated on the server.
* **Always available.** With no model attached, or if the model fails, Relia answers with the guided query engine and says so in a visible notice.

## Attaching a model

Relia works with any server that implements the OpenAI-compatible Chat Completions API. Set these server-side environment variables (Vercel → Settings → Environment Variables, or `.env.local`), then redeploy or restart.

| Variable | Required | Example | Purpose |
|---|---|---|---|
| `AI_BASE_URL` | yes | `http://localhost:11434/v1` | Endpoint base URL (without `/chat/completions`) |
| `AI_MODEL` | yes | `qwen3:8b` | Model ID on that endpoint |
| `AI_API_KEY` | if the endpoint needs one | | Sent as `Authorization: Bearer …`, never to the browser |
| `AI_MODEL_LABEL` | no | `Relia Core` | Name shown in the UI instead of the raw model ID |
| `AI_ASSISTANT_NAME` | no | `Relia` | Assistant's brand name everywhere in the UI and prompt |
| `AI_TOOL_MODE` | no | `auto` | `native` (API tool calls), `json` (text protocol for models without tool support), `auto` (native, falls back to json if the endpoint rejects tools) |
| `AI_TEMPERATURE` | no | `0.1` | 0–1. Keep low for factual answers |
| `AI_MAX_TOKENS` | no | `1200` | Per response, 200–4000 |
| `AI_TIMEOUT_MS` | no | `30000` | Per model call, 5000–55000. The whole request is capped at 60 s |

If `AI_MODEL` is not set but `OPENAI_API_KEY` and `OPENAI_MODEL` are, Relia uses OpenAI automatically.

### Examples

```bash
# Self-hosted, data stays on your network (Ollama)
AI_BASE_URL=http://gpu-server:11434/v1
AI_MODEL=qwen3:8b
AI_MODEL_LABEL=Relia Core

# Self-hosted production (vLLM, started with --enable-auto-tool-choice and a tool-call parser)
AI_BASE_URL=http://vllm.internal:8000/v1
AI_MODEL=Qwen/Qwen3-8B
AI_API_KEY=<vllm --api-key value>

# Hosted
AI_BASE_URL=https://api.openai.com/v1                                  # OpenAI
AI_BASE_URL=https://api.groq.com/openai/v1                             # Groq
AI_BASE_URL=https://openrouter.ai/api/v1                               # OpenRouter
AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai    # Google Gemini
AI_BASE_URL=https://api.anthropic.com/v1                               # Anthropic (OpenAI-compatible endpoint)
```

Check each provider's current documentation for exact model IDs before going live.

### Choosing a small model

* Prefer models with **reliable tool calling**: recent Qwen, Llama, Mistral and similar instruct models in the 7–14B range work well.
* **Ollama:** raise the context window (`num_ctx` 8192 or more). The default is small, and tool results are silently truncated without it.
* **Reasoning models** that emit `<think>…</think>` are supported; the thinking text is removed from answers.
* Models without tool support: set `AI_TOOL_MODE=json`.
* **Vercel cannot reach `localhost`.** A self-hosted model must be reachable from the deployment over HTTPS (for example behind a gateway or VPN), or iAPM must be hosted on the same network.

## Verifying a connection

1. Open **Reliability assistant**. The sidebar shows **AI model attached** and the model label.
2. Ask *"Give me a full profile of SC-E-101."* Expand **How Relia answered** to see the read-only tool calls.
3. **AI Tokens Usage** lists each call as *Assistant chat* with provider-reported tokens.

## Tests

```bash
node tests/assistant.test.mjs
```

42 checks, including every chart type with numbers cross-checked against the Executive overview engine, saved reports (save, show directly, run, rename, delete, privacy), the guard on the AI's chart choice, verified-text stripping, unrecorded-data replies, calculated headlines, the "create a table" fix, site comparisons matching Bad actors, follow-ups, trend numbers matching the Executive overview engine, the figure check, charts without a model, and the rate limit. Also covered: configuration, authentication and same-origin rules, guided fallback, the model tool loop, rejection of write tools, citation verification, OpenAI parameter adaptation, retrieval-first answers, the lazy-answer guard, asset pinning, fixed read-only replies, tag/ID correction, the JSON-protocol fallback for small models, text-written tool calls, unreachable-model fallback, frozen data, no business-record writes, and owner isolation. Model responses are mocked. Run one real question against your chosen model before a demonstration.

## Production notes

* The burst limiter (15 questions per minute per owner, one at a time) is per server instance. Add a shared rate limit at the gateway or WAF for production.
* Questions and retrieved records are sent to the configured endpoint. For confidential plant data, use a self-hosted model or a provider agreement with zero data retention.
* The earlier OpenAI-only chat endpoint (`/api/ai-chat`) is unchanged and still works; the UI now uses `/api/assistant`.
