# Functional parity register

This is a controlled demonstration milestone, not full source parity. No confidential source records are included.

| Origin | Feature | Source reference | New location | Status | Evidence / limitation |
|---|---|---|---|---|---|
| Source | Annual loss trajectory and board | annual render / board sorting | Executive overview / Bad actors | Implemented | Approved-only aggregates; shared year filters |
| Source | Scatter X/Y and minimum-loss controls | scatter settings | Bad actors | Implemented | Independent axes, asset drill-down, top-N and minimum actual loss |
| Source | 16 site/category lists | generateBadActorListsCore; category minVdt | Bad actors | Partial | 4 × 4 groups; 1 / 0.5 / 0.25 / 0.25 day thresholds; active filters; CSV instead of source XLSX + Word bundle |
| Source | Actual/potential virtual downtime | secondary impact estimation; max product downtime | Bad actors / Incidents | Implemented with correction | F1 owns actual loss; prior matching F1 evidence for F2; no future leakage |
| Source | Product intersection selection | Venn loss zones | Bad actors | Implemented | Exact product-channel combinations via accessible buttons |
| Source | Global and advanced filtering | getFilters | Application context bar | Partial | Site, unit, category, years, impact, nature, mode, activity, reference, search, exclusions; separate downtime/low-load plant dimensions not yet modelled |
| Source | Primary/secondary event evidence and pivots | drill-down workspace | Incidents / Asset 360 | Partial | Record-level evidence and export; arbitrary pivot dimensions not yet exposed |
| Source | Comparative analysis | comparison workspace | Comparative analysis | Partial | Site/category comparisons and site top 20; radar and metric-distribution parity outstanding |
| Source | Replacement screening | future replacement workspace | Replacement screening | Implemented with limits | Seven enable/disable triggers; horizon/count/limit; most numeric trigger defaults fixed |
| Source | Tube-bundle integrity | renderHXChronology | Exchanger integrity | Partial | Plugging, minimum wall and NDE chronology; raw scan files, fitted bundle life and acceptance limits not implemented |
| Source | Weibull life analysis | wbFitWeibull; runWeibullAnalysis | Reliability models | Partial | Manual life-distribution curves/B10/B50; original probability-plot fitting and maintenance interval outputs outstanding |
| Source | Model validation | _dcbfValFitCrowAmsaa; _dcbfValFitBayesian; _dcbfValFitLogLinear; _dcbfValFitWeibull; _dcbfValFitLognormal | Reliability models | Implemented with corrections | Six families; same temporal holdout; log-linear MLE; censored renewal simulation; deterministic Bayesian quadrature with different declared priors; no interval claims |
| Source | DCBF A1/A2/B/C scenarios | DCBF calculation workspace | DCBF workbench | Implemented with corrections | Common baseline/horizon; incremental NPV reconciles with baseline PV less scenario PV |
| Source | Replacement timing | DCBF timing calculations | DCBF workbench | Implemented with corrections | Delayed capex; no pre-intervention benefits; consistent terminal value; payback from intervention |
| Source | Calibration and forecast controls | estimateCrowAmsaa; forecastFailuresCrowAmsaaAt | DCBF workbench | Implemented | History window, Crow/HPP/manual, recurrence rate and exponent, horizon, economics inputs |
| Source | Maturity and elimination factors | DCBF scenario assumptions | DCBF workbench | Partial | Scalar starting maturity, linear ramp and FEF; arbitrary user maturity tables outstanding |
| Source | Saved cases and exports | DCBF saved analyses | DCBF workbench | Implemented | Server persistence; load and recalculate; per-scenario cash-flow CSV |
| Source | CAPEX allocation and mandatory overrides | DCBF fleet prioritization | Capital portfolio | Partial | Weighted heuristic, mandatory-first allocation and explicit budget conflict; mandatory rationale persistence and detailed multi-year scheduling outstanding |
| Source | Lifecycle history, sensitivity and manual cases | lifecycle workspace | Lifecycle cost / DCBF | Partial | Historical maintenance/production loss; forward cost assumptions and scenario CSV; sensitivity chart and cumulative history outstanding |
| Project brief | Real password and private access | Private access requirement | Welcome / server API | Implemented; hosted verification pending | Owner platform identity plus PBKDF2 password; HttpOnly session; expiry/rate limit/logout tests |
| Project brief | MEDFI MRT four-level framework | M Delta E / D / F / I | Incidents & MEDFI | Implemented | Stage separate from F1/F2; approved leading evidence can spawn linked progression |
| Project brief | Asset register four categories | Register requirement | Assets | Partial | Hierarchy, category constraints, self-service and export; bulk import outstanding |
| Project brief | RIR lifecycle and audit | Draft to Closed | Incidents | Implemented | Server-side transitions, immutable approval, duplicate and parent checks |
| Project brief | Recommendations and actions | Execution requirement | Recommendations & actions | Implemented | Owner/due/horizon/category/status/evidence; completion verification |
| Project brief | Data refinery walkthrough | Four-phase illustrative workflow | Data refinery | Implemented | Clearly illustrative; four provisional export schemas |
| Project brief | Executive presentation | Eight-stop five-minute journey | Start Executive Demo | Implemented | Guided navigation through working screens |
| Project brief | Persistence, settings and reset | Data administration | Settings & methodology | Partial | D1 records, scenarios and saved views; deterministic initial seed; reset/restore UI outstanding |
| Project brief | Configurable product/currency calculations | Product modelling requirement | DCBF / incident evidence | Partial | USD and three fixed seed products; enterprise product configuration outstanding |
| Enhancement | Numerical and API regression evidence | tests/domain.test.mjs; tests/api.test.mjs | Repository documentation | Implemented | 23 deterministic checks; mocked identity and in-memory SQLite, not hosted browser tests |

| User request | Asset criticality assessment | Orange REM, printed pp. 3–18 | Assets / Asset criticality / Asset 360 | Implemented | Guided 8-factor scoring, draft/review history, rankings and CSV; configurable MVP thresholds |
