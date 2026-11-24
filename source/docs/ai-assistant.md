# Relia: read-only reliability AI

Relia is the conversational assistant on **Overview → Reliability assistant → Chat with Relia**.
It answers plain-English questions about the owner's reliability data and cannot change anything.

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
   rank_assets        → portfolio ranking: actual loss, potential (F2) exposure, downtime, maintenance, events
                        (same calculation as the Bad actors screen)
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

22 checks: configuration, authentication and same-origin rules, guided fallback, the model tool loop, rejection of write tools, citation verification, OpenAI parameter adaptation, retrieval-first answers, the lazy-answer guard, asset pinning, fixed read-only replies, tag/ID correction, the JSON-protocol fallback for small models, text-written tool calls, unreachable-model fallback, frozen data, no business-record writes, and owner isolation. Model responses are mocked. Run one real question against your chosen model before a demonstration.

## Production notes

* The burst limiter (15 questions per minute per owner, one at a time) is per server instance. Add a shared rate limit at the gateway or WAF for production.
* Questions and retrieved records are sent to the configured endpoint. For confidential plant data, use a self-hosted model or a provider agreement with zero data retention.
* The earlier OpenAI-only chat endpoint (`/api/ai-chat`) is unchanged and still works; the UI now uses `/api/assistant`.
