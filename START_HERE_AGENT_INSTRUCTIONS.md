# iAPM deployment handover — preserve the existing product

Prepared 4 October 2026. Source commit: 8bc07bea046bcab7236ee76c4891b29d17e56b4c.
Reference application: https://reliability-intelligence.zaryab-hyder14.chatgpt.site

## What this package contains

The complete tracked source of the latest application, public branding, background imagery, sample PDFs, promotional video assets, styles, components, calculation engines, tests, documentation, database schema and exact dependency lockfile. The original source is unmodified. No Git credentials, API secrets, passwords or active sessions are included.

IMPORTANT: THIS ZIP IS NOT YET A COMPLETE LIVE-DATA BACKUP. Persisted production data and uploaded R2 files live outside Git. The available database inspection interface truncated three record bodies, so its results were deliberately not supplied as a restorable backup. Do not describe a deployment made from this ZIP alone as a lossless clone. Complete the snapshot steps below before migration sign-off. The deterministic demonstration dataset is included in lib/domain.ts and can be regenerated exactly by the unchanged seed function.

## Scope of work for the external agent

Preserve every existing screen, chart, form, navigation item, typography, color, visual, dataset, calculation and interaction. Do not redesign or replace the project with a static HTML approximation. Preserve the welcome/login screen's appearance; replace its underlying authentication dependency. Do not delete the existing deployment. Build and validate an independent staging installation first.

This is React/Vinext on Cloudflare Workers, not a static site. D1 binding is DB; R2 binding is FILES. Node >=22.13.0, pnpm 11.25.0; exact versions in package.json and pnpm-lock.yaml. Keep the lockfile and use frozen-lockfile installation. Database schema: source/drizzle/0000_far_eternals.sql. Schema has accounts, attempts, sessions, records. Business records are owner-scoped and JSON-based.

## 1. Obtain a complete snapshot before cutover

Owner signs into the current iAPM /workbench in a desktop browser. Open developer console and run migration/export-from-signed-in-browser.js after reviewing it. Allow multiple downloads. It reads the application's authenticated APIs, downloads complete API JSON and all archived PDF source files, checks each PDF SHA256, and makes no writes. Provide iapm-snapshot.json and every downloaded PDF to the agent privately. An EXPORT INCOMPLETE message means migration must stop and the missing item must be resolved.

The current inspection showed eight business rows: two asset overrides, four incidents (including an approved historical import), and two historical-import metadata records. This is a dated observation, not a guaranteed current inventory. The exporter obtains effective seed-plus-overrides data, so the SQL conversion imports the full effective dataset intentionally. Current usage/chat APIs are bounded (20 conversations, current month's latest 100 usage records). If older or additional records exist, obtain a complete D1 export through the source platform's supported database export workflow and reconcile it. Do not scrape truncated inspection results into SQL. Compare inventory immediately before cutover and freeze new writes or perform a final delta migration.

## 2. Configure independent hosting

Use an account and domain owned by Zaryab, with delegated agent access. Cloudflare Workers/D1/R2 is the closest architectural match. **Vercel adaptation is included in `source/`** (Next.js + Turso + Vercel Blob + email/password auth); see `source/DEPLOY_VERCEL.md`. Other platforms need compatible replacements for cloudflare:workers, D1 SQL, and R2; preserve API contracts and numerical results.

Original vite.config.ts uses build/sites-vite-plugin and .openai/hosting.json, which are Sites-specific. For external hosting, adapt a COPY of the configuration to a standard Vinext + Cloudflare Vite deployment, providing real D1 database ID, R2 bucket name, Worker name and deployment configuration. Keep application source and calculations unchanged. Inspect scripts/run-framework.mjs, scripts/sites-env.mjs and build/ for Sites build assumptions; replace only hosting/auth adapters. Do not blindly deploy the placeholder database ID. Consult current official Vinext and Cloudflare documentation before choosing build/deploy commands. The supplied original npm/pnpm build entry is a baseline, not a claim that external deployment is already turnkey.

Create DB and FILES, apply schema to an empty database, and configure the custom HTTPS domain. Preserve all public paths including /demo/, refinery imagery, logo and MP4s. Check asset-size limits and support video byte ranges; if needed move videos to object storage with equivalent application URLs. CSS uses Arial/Helvetica/system sans-serif fallbacks; preserve that stack and compare on the same OS/browser. Browser-dependent font rendering cannot be guaranteed pixel-identical across devices.

## 3. Replace authentication securely without changing the login design

Existing app/chatgpt-auth.ts trusts platform-injected identity headers. This trust exists only behind the source platform. Never trust visitor-supplied oai-authenticated-* headers on an external server and never enable mockAuth in production.

Replace identity resolution with verified independent authentication. Adapt app/page.tsx, lib/auth.ts, app/api/auth/route.ts, sign-in/sign-out links and any chatGPTSignInPath usage. Preserve app/welcome.tsx layout, logo, colors, form controls and welcome text where appropriate. Use verified email/password sessions or a trusted identity provider. Keep HttpOnly/Secure cookies, same-origin protections, expiry, login throttling and owner isolation. Create a new owner account and map all imported records to its stable ID. Do not import old active sessions. Reset/setup the owner's password securely outside this package.

## 4. Restore business data and source PDFs

Run: python3 migration/snapshot-to-sql.py iapm-snapshot.json NEW_OWNER_ID restore.sql
Review and import restore.sql into the empty destination records table after schema creation. Account provisioning is separate. This converter fails on missing IDs and uses ordinary INSERT to avoid silently overwriting data. It imports effective assets/incidents/actions/scenarios/settings, historical archive metadata, exposed chat/usage and budget preferences. For an authoritative full raw D1 export, preserve original updated timestamps and migrate any extra kinds instead of relying only on this converter.

Upload each PDF to FILES under its ORIGINAL snapshot.files key. Metadata keys contain the old owner path; retaining the exact key preserves references even though record owner IDs are remapped. Do not rename keys without rewriting metadata consistently. Verify every object hash/size and archive download. Imported historical records already contain source provenance; do not approve/import them a second time. Approval state and historical year/money basis must remain unchanged.

## 5. Activate AI separately

Live OpenAI extraction and full AI chat were implemented but the source deployment has no configured OpenAI API key. Their activation must not be advertised as already working. Configure OPENAI_API_KEY as a server-side secret only, optionally OPENAI_MODEL. Verify model IDs against the actual provider account: picker labels do not establish model availability. Preserve explicit zero-token reference demonstration labeling, human extraction review, missing-value handling, strict schema and actual provider-reported usage. Never fabricate token balances. Remaining percentage is a local monitoring budget, not provider credit balance. Subscription cards are illustrative; no payment checkout is activated. Source integrations are simulations/demo concepts unless actual connectors have been implemented and verified.

## 6. Required acceptance checks

Install exact locked dependencies. Run TypeScript checks and the supplied tests in their documented order; tests/domain.test.mjs generates prerequisites used by tests/mtbf.test.mjs. Read source/docs for existing verification notes. Validate original fixtures first, then run identical inputs on the external deployment.

Compare reference and staging at identical viewport, browser, dataset and filters:
- Welcome/login page, integrated iAPM logo, white centered sidebar branding, icon ribbon, hierarchy and global filters.
- Executive overview, year selection 1990–2026, site/category bubbles, chart-axis options, category statistics, chart studio and clustered interval selections.
- Asset register/criticality, sort direction, exposure-backed MTBF and ranking, MEDFI lifecycle logging/transitions, bad actors/Pareto and cross-site comparisons.
- Simulation booth sliders and animation/video playback; live input responsiveness remains demonstrative until real integrations exist.
- F1 actual versus F2 potential distinction; no missing-value-to-zero conversion, duplicate counting or fabricated MTBF.
- Reliability models, RIR before/after impact, cash flows, NPV/IRR/PB/PI curves, replacement optimum and historical lifecycle scan. Preserve lib/domain.ts, lib/models.ts and associated modules exactly unless a defect is separately approved. Match financial assumptions, time/money basis and filters when comparing.
- Save/edit/reload persistence, historical PDF archive download, extraction review/approval and shared dashboard updates.
- AI grounding, model availability, usage ledger, authorization boundaries and error recovery.

Use a numeric comparison report with exact matching counts and stated floating-point tolerances; screenshot comparisons should cover all principal screens. Test private client login and logout, expired sessions, unauthorized access and object download access. Provide deployment URL, repository, backup/export process, rollback instructions and known limitations. Do not sign off '100% ditto' until data completeness and all acceptance checks are demonstrated.

## Deliverables and ownership

Provide the finished custom-domain deployment, owner-admin credentials through a secure channel, source repository under owner control, destination configuration, migration log, inventory/hash report and acceptance evidence. Keep the current site intact until the owner accepts the external installation. This package does not itself deploy or change the current site.
