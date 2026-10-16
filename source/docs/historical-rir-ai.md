# Historical evidence and live AI

## Client walkthrough

1. Data & Administration → Historical RIR imports. Download the image-only 1990 archival PDF or use the top ribbon's + Upload historical RIR command.
2. With a connected API project, select GPT-6 Astra or another available model and upload the PDF (8 MB/file, up to five files selected). The model receives page images through Responses API PDF input and returns a strict structured extraction.
3. Before live activation, Review reference extraction uses an exact SHA-256-matched bundled sample and a clearly labeled pre-authored mapping. It never records fabricated AI token usage. It is not a general OCR fallback.
4. Review field values, asset identity, units/currency, page evidence and low-confidence notes. Unknown impact numbers block approval. Suspected causes stay qualified. Multiple incidents require separate review: extraction takes the first and must warn.
5. Approve & import atomically validates Draft → Submitted → Reviewed → Approved transitions. Original PDF remains private in R2, while source hash, model, quotes, reviewer and corrected values persist in D1. Same-source duplicate imports do not add a second event.
6. Shared ownerData makes the approved record available to dashboard totals, bad actors, categories, MEDFI, models, MTBF (only within verified exposure), and DCBF. The after-import card shows actual-loss/downtime increments and default-assumption before/after NPV and replacement year. A new event need not change the optimum year.
7. Reliability assistant → AI conversation uses read-only tools over saved owner data. Prior conversations are owner-scoped and persisted. Guided calculations remain separately available without AI.
8. AI Tokens Usage shows provider-reported input/output/total tokens, model and operation. Percentage remaining is a configurable soft monthly monitoring target, not a provider balance, ChatGPT entitlement, or hard spending cap. UTC calendar months. Failed/time-out requests may have unknown provider-billed usage. Billing must be reconciled at the provider.

## Activation boundary

Live extraction and generative chat require production OPENAI_API_KEY configured as a Site secret. No key is shipped or exposed in client code. Optional OPENAI_MODEL enables the older guided AI interpreter; all its requests are now included in the same ledger. Supported choices are verified against the connected /v1/models catalog and can still be denied by request-specific permissions. GPT-6 Astra uses API model id gpt-6-astra.

This session had no production AI secret and no installed secure Codex API-key setup skill. No live provider calls, purchases, credit grants or subscriptions were made. Reference-demo ingestion and real API integration paths were tested; API responses in tests were mocked. Do not describe the deployed application as live-AI activated until secure setup and a real end-to-end request pass.

The credits button links to OpenAI Platform billing. Evaluation/Team/Enterprise are explicitly illustrative commercial concepts: choosing one changes a local monitoring budget only. No payment processor, checkout, subscription contract or entitlement enforcement is connected.

## Reliability semantics

Extraction uses ISO 14224-aligned hierarchy/failure/maintenance concepts plus iAPM MEDFI and business-impact extensions. It is not an ISO certification or a claim that ISO 14224 existed in 1990. Source financial amounts must be event-year USD for the present economic engine. No automatic foreign-exchange conversion. Potential-loss values are retained in source provenance; future risk requires a separate explicit likelihood/horizon assessment in the RIR risk panel. Operating exposure is not fabricated from calendar time. Uploaded evidence can be sensitive; the UI explicitly discloses transfer to the connected OpenAI project.

## Verification

TypeScript and targeted integration tests cover authentication/CSRF boundaries, owner isolation, private source retrieval, reference-file hash enforcement, unknown-value rejection, atomic workflow transitions, duplicate import, live request schema, usage ledger, read-only tool grounding and saved conversations. The sample PDF was rendered and visually inspected; text extraction confirms it is a raster-only scan. Browser interaction QA and live OpenAI activation remain unverified.
