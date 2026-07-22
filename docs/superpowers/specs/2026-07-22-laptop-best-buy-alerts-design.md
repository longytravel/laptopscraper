# Laptop Best-Buy Alerts Design

**Date:** 2026-07-22

## 1. Mission

Find the owner a dependable, materially capable laptop at a good advertised price and keep them updated without requiring them to operate the dashboard manually.

The system will refresh eBay UK listings twice daily, reject machines that fail the replacement floor, rank the remaining listings for the owner's local backtesting workload, make every comparison explainable against the current ASUS ROG Strix G16, highlight newly discovered listings, and send a concise Telegram digest with working eBay links.

## 2. Decisions and scope

- Marketplace: eBay UK through the existing official Browse API collector.
- Schedule: approximately 08:00 and 20:00 in `Europe/London`, including daylight-saving changes.
- Maximum advertised item price: £3,000.
- Ranking price: advertised item price only. Postage is excluded from filtering, scoring, ranking and recommendation copy.
- Current-machine reference: ASUS ROG Strix G16, i9-14900HX, RTX 4060 Laptop GPU, 64 GB RAM, 1 TB storage floor, and £1,170 reference price.
- Primary workload: local Better Life backtesting and related Python/productivity work. Gaming performance does not contribute to ranking.
- Telegram and the dashboard are two views of the same ranking output; they must not independently implement ranking rules.

## 3. Eligibility gate

A listing can enter the best-buy ranking only when all of these are true:

1. It is a complete, working laptop rather than parts, repair, box-only, accessory or desktop hardware.
2. Its processor model is identified confidently enough to compare.
3. Its CPU multi-core and single-thread scores are each no worse than the G16 reference scores.
4. It advertises at least 64 GB RAM.
5. It advertises at least 1 TB of storage.
6. It has an RTX 4060 Laptop GPU or a graphics processor with an equal-or-higher audited benchmark score.
7. Its advertised item price is at most £3,000.
8. No unresolved specification conflict could cause it to fail one of the rules above.

The GPU is a replacement-quality floor only. A faster GPU does not increase the work-performance score or best-buy rank.

Listings with incomplete evidence remain available in a separate needs-checking view. They are not described as matches and are not sent as buying recommendations.

## 4. Benchmark evidence and freshness

The current permanent hard-coded benchmark snapshot is replaced by a versioned benchmark cache with one record per exact processor or GPU model. Each record stores:

- canonical model name;
- multi-core score when applicable;
- single-thread score when applicable;
- source URL and source name;
- source observation date;
- sample count or confidence evidence when available;
- retrieval timestamp;
- parser/provider version; and
- validation status.

During each listing refresh:

- known hardware with validated evidence no more than seven days old reuses the cache;
- a newly encountered model is researched immediately;
- evidence older than seven days is refreshed before the model can produce a high-confidence recommendation;
- failed research preserves the last validated value but marks it stale; and
- a material benchmark change recalculates all affected listings before any digest is sent.

Research is bounded to the distinct hardware models, never repeated for every listing. The source/retrieval layer is isolated behind a benchmark-provider interface so it can be tested with fixtures and replaced without changing ranking semantics.

No result may say that a processor is simply "X% better." CPU evidence is always shown separately as multi-core and single-thread improvement.

## 5. Work-performance and value ranking

All normalized comparisons use the G16 as `100`.

```text
multiCore = 100 × candidateMultiCore / g16MultiCore
singleThread = 100 × candidateSingleThread / g16SingleThread
workPerformance = 100 × (multiCore / 100)^0.70 × (singleThread / 100)^0.30
workValue = (workPerformance / advertisedPrice) / (100 / 1170)
```

Multi-core receives 70% of the work score because the Better Life optimizer launches parallel CPU workers. Single-thread receives 30% because individual trials and non-parallel phases still depend on per-thread speed.

RAM and storage are eligibility requirements, not artificial compute-power multipliers. Their capacity improvements are displayed separately. GPU performance is also displayed separately but has zero ranking weight.

Ranking proceeds in four steps:

1. Apply the eligibility gate.
2. Remove dominated listings: a listing is dominated when another eligible listing is no more expensive, has equal-or-better work performance, and has no worse RAM or storage.
3. Order the remaining value frontier by work value.
4. Use evidence confidence, condition, seller evidence and returns evidence as safety tie-breakers rather than allowing a suspicious listing to win on price alone.

The output explains the rank with concrete comparisons, for example:

> Multi-core +28% · single-thread +5% · work performance +21% · RAM equal · storage 2× · advertised price £930 higher · work value 29% below your G16.

## 6. New-listing detection

The dataset records `firstSeenAt`, `lastSeenAt` and the source eBay item ID for every listing. The previous successful snapshot is the comparison boundary.

- A Telegram listing is **new** only when its item ID was absent from the previous successful snapshot.
- A dashboard listing receives a **NEW** badge for 24 hours after `firstSeenAt`.
- The dashboard places qualified new listings in a dedicated section above the existing market results.
- Relisted items with the same eBay item ID are not new. A genuinely new item ID is new even when the title resembles an older listing.

## 7. Telegram digest

Telegram credentials are server-side secrets: `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`. They never enter browser code, generated datasets, logs or commits.

Each successful run sends one compact message:

1. refresh time and total eligible count;
2. newly eligible listings, sorted by best-buy rank;
3. the current top three overall when different from the new set;
4. concise CPU, RAM, storage, price, value, condition and confidence evidence; and
5. a direct canonical eBay link for each listing.

If there are no new eligible listings, the digest says so and shows only the current leading candidate. Long result sets are capped and link back to the dashboard rather than producing an unreadable message.

Example:

```text
🆕 Lenovo Legion Pro 7 — £2,100
Work performance: +21% vs your G16
Multi-core +28% · single-thread +5%
64 GB RAM (=) · 2 TB storage (2×) · RTX 5070 Ti (passes floor)
Work value: 29% below your G16
Used · evidence high · #1 current best buy
View on eBay: <canonical link>
```

## 8. Scheduled pipeline and publication

A scheduled GitHub Actions workflow owns the twice-daily operation:

1. Check out the latest successful state.
2. Install locked dependencies.
3. Refresh the official eBay dataset.
4. Refresh new or stale benchmark evidence.
5. Apply cached AI listing enrichment where configured.
6. Recalculate eligibility, work scores, value and the frontier.
7. Diff against the previous successful snapshot.
8. Run focused data-integrity tests and build the dashboard.
9. Publish the updated dataset/state and allow the existing Vercel project to deploy it.
10. Send Telegram only after the dataset has passed validation and the publication step has succeeded.

The scheduler uses a Europe/London-aware guard so morning and evening remain local-time concepts across daylight-saving changes. Runs are idempotent: the same successful snapshot cannot send the same new-listing digest twice.

## 9. Failure handling

- eBay throttling or temporary failure preserves the last successful dataset, following the existing cache fallback. It does not invent a zero-results market.
- Benchmark-provider failure uses the last validated evidence with a stale marker; unknown hardware cannot enter recommendations.
- AI enrichment failure leaves deterministic evidence intact and cannot weaken hard exclusions.
- Telegram failure records an unsent digest for a bounded retry without marking it delivered.
- Publication failure prevents the digest, ensuring Telegram never links to a dashboard state that was not successfully published.
- Secret values are redacted from all errors.
- Repeated operational failures produce one short Telegram health notice when delivery remains available, avoiding notification spam.

## 10. Verification

Automated tests cover:

- advertised-price-only ranking regardless of postage values;
- 64 GB, 1 TB, CPU and RTX 4060-equivalent eligibility boundaries;
- separate multi-core and single-thread normalization;
- the 70/30 geometric work-performance formula;
- zero GPU contribution to rank;
- benchmark freshness, cache reuse, stale fallback and material-change recalculation;
- dominated-listing removal and deterministic tie-breaking;
- first-seen/new detection across successive snapshots;
- Telegram formatting, escaping, length limits, canonical links and idempotency;
- failure paths for eBay, benchmark research, enrichment, publication and Telegram; and
- secret redaction.

Release verification requires the complete test suite, lint, production build, a dry-run digest generated from fixtures, and one controlled Telegram smoke test before the schedule is enabled.

## 11. Success criteria

The feature succeeds when:

- morning and evening refreshes run without manual intervention;
- the owner receives concise Telegram updates with direct working links;
- new qualifying listings are unmistakable in Telegram and the dashboard;
- every recommended laptop meets the replacement floor;
- every CPU comparison is current, sourced and split into multi-core and single-thread evidence;
- ranking ignores postage and gaming performance exactly as requested;
- the best-buy explanation can be understood without knowing the formula; and
- temporary data-source failure never masquerades as a trustworthy recommendation.
