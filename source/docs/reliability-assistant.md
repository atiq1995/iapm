# Reliability assistant

The assistant reads the authenticated owner’s current data through the same ownerData loader as /api/data. No model-generated SQL, code, answers or numerical facts are executed or displayed. Every answer is rendered from a validated plan and the shared calculation engine. Incident/source text is escaped by React. Chat stays in component memory and is cleared by a new conversation or navigation. The API is authenticated, same-origin for writes, read-only with respect to asset data, input-bounded and no-store.

## Supported queries
Asset overview; actual F1 loss/downtime rankings; verified-exposure MTBF; criticality; latest RIR evidence and recorded causes; MEDFI counts; site/category actual-loss comparisons; recorded actions; one-asset current DCBF economics and forecasts. Unsupported questions abstain. Query scope and exceptions are visible in each answer. This is not a general engineering-advice or automatic action agent.

## AI interpretation activation
Current deployment runs guided query interpretation without a paid AI service. For broader language interpretation, configure OPENAI_API_KEY as a server-side secret and OPENAI_MODEL as a model supporting Responses structured outputs, using the authorized OpenAI Developers plugin/API-key workflow. Never paste a key in chat or commit it. Deploy to apply environment changes. GET /api/reliability-agent exposes only an availability boolean. When configured, users explicitly enable AI interpretation: only the question, scope and owner asset catalog (ID, tag, site, category) are sent to https://api.openai.com/v1/responses with store:false. Incident narratives and complete historical records are not sent. Model outputs are strictly schema-checked and checked against the owner catalog. Provider errors fall back to the guided engine with a visible notice. A 20-second timeout and 600-token cap bound each request. Configure provider spend limits before activation.

Provider interpretation cannot be live-tested until a credential and chosen model are configured. Guided mode and malformed-provider fallback are tested locally.

## Validation
Run node tests/reliability-agent.test.mjs and node node_modules/typescript/bin/tsc --noEmit. The test uses actual auth, owner loader, query and domain code with in-memory SQLite and mocked platform identity. Covers deterministic financial/MTBF agreement, scope and unsupported query handling, authentication, same-origin checks, owner isolation, and malformed model response fallback. It is not hosted end-to-end or live-provider verification.
