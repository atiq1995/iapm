# Asset reliability update

MTBF is evaluated against the asset's saved inclusive observation window and reviewed operating-hour evidence. Distinct approved/closed functional-failure lifecycles form the denominator. Leading observations are excluded. Linked F/I records count once at the first qualifying failure date, even if a later consequence falls in a different observation window. Unknown exposure and zero failures are not assigned infinity or zero MTBF.

Seed assets now include explicitly synthetic operating-hour records. Existing saved asset overrides retain their data; no real operating exposure is inferred or backfilled into those records. Asset 360 supports editing exposure and equipment taxonomy fields, persisted in existing owner-scoped records.

Criticality has ascending/descending display order while reviewed priority rank is unchanged. The data-model alignment statement refers to ISO 14224 equipment/failure/maintenance data concepts. ACA weights and thresholds remain organization-defined.

The MEDFI triangle logs asset-specific incidents with optional predecessor links, detection method, root-cause findings and corrective action. Chronology, asset identity and forward stage order are validated. A lifecycle is distinct from the full asset life. Linked actions reuse the existing owner/due/status/evidence and completion-verification workflow. Approved evidence remains immutable.

Brand asset: supplied iAPM logo integrated without frame into login and application header. No public access changes.
