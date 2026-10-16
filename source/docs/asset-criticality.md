# Asset criticality assessment

## Book basis
Consulted the user-supplied Orange REM / Reliability Engineering for Maintenance, criticality-analysis chapter, printed pages 3–18 (PDF pages 9–17). The text calls for a cross-functional team, an asset hierarchy, organizational criteria and weights, and a numerical or Low/Medium/High ranking. Its example rates eight criteria on a 1–5 scale, totals the ratings and expresses a score out of 100. It describes financial risk as failure frequency per period multiplied by cost consequence, including wider business effects.

## MVP adaptation
The eight factors are health/safety, environment/compliance, operations/mission, quality/customer, failure propensity, early warning, redundancy/recovery, and maintenance/supply exposure. These are original, user-facing rubrics based on the chapter's concepts, not an exact reproduction of its table. Ratings are ordinal. Higher always means greater criticality.

Default equal weights yield `score = 20 × sum(rating × weight) / sum(weight)`, spanning 20–100. Low <40, Medium 40–<70, High ≥70. The optional severe safety/environment rating-5 override assigns High priority without changing the numerical score. It remains active independently of a criterion's weight. These thresholds and policy choices are configurable MVP defaults that require organizational agreement. The financial exposure calculation is independent and is not added to DCBF benefits.

## Workflow
Assets → Asset criticality → choose an asset → rate factors → record scope, assessor, cross-functional team, evidence, reviewer and review due → Save draft or Mark reviewed. The same input fields are embedded in Asset 360; initial scoring is available when creating an asset. Missing assessments remain Unassessed. Reviewed rankings persist while a revision is drafted. Every save retains the previous revision.

Rankings show score, band, driver, due date, evidence confidence and draft state. They filter by site, unit, category, search and criticality band, independent of incident date filters. Severe-consequence overrides rank first. Rank numbers remain tied to priority even if the view is sorted by tag or due date. A warning identifies differing scoring configurations. CSV export matches the filtered rows.

## Integration and controls
Publishing a reviewed assessment derives the normalized legacy 1–5 criticality input as ceiling(score/20), with 5 for a severe-consequence override. Existing portfolio and screening calculations continue to use this input. Assets without a reviewed assessment retain their legacy provisional input, clearly distinguished from assessed criticality. Current condition and historical bad actors remain separate.

Server-side validation rejects incomplete reviewed assessments, invalid rating/weight ranges and invalid economics. Updates are owner-scoped, validate expected revision, and use a conditional database update to prevent overwriting a newer assessment. Asset updates cannot inject a criticality assessment or score. No database schema migration or access change is required.

The owner records the review team and reviewer. This is not an independent multi-role approval workflow. Demo assessments are synthetic and labelled low confidence.

## Validation
Ten additional numerical/API checks cover scoring boundaries, weights, override behaviour, missing ratings, draft preservation, reviewed persistence, audit history, stale/concurrent revisions and direct-score injection. The existing 23 checks remain in the regression suite. Full authenticated browser testing remains outside the verified test scope.
