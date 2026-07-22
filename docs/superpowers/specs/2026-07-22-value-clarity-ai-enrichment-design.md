# Value Clarity and AI Enrichment Design

## 1. Problem and measured baseline

The current dataset contains 319 listings. Every listing has an item price, but 213 have unknown postage, 158 lack a complete CPU/GPU power score, and only 51 have both an exact delivered price and a complete power score. The dashboard currently collapses those separate limitations into “Needs checking” and omits all incomplete-price rows from the graph, which makes valid item prices look absent and hides 110 otherwise chartable laptops.

The improved product must make uncertainty visible without discarding useful evidence or fabricating precision.

## 2. Goals and success criteria

1. Plot every listing with a known power score and item price, increasing the current chart population from 51 to 161 on the committed dataset.
2. Distinguish exact delivered-price points from lower-bound item-price points at a glance.
3. Make “better value than the current G16” visually obvious without replacing the factual power and price axes with an opaque score.
4. Replace the single “Needs checking” bucket with actionable reasons: postage unknown, specifications incomplete, or both.
5. Use GPT-5.6 Luna at medium reasoning effort to read every changed listing and improve structured specification/risk extraction.
6. Keep prices, benchmark indices, exclusions, value calculations, and final ranking deterministic and auditable.
7. Cache AI results by listing-content fingerprint so an unchanged listing is never paid for twice.
8. Deploy the verified static dashboard and enriched dataset to the existing Vercel target.

## 3. Chosen approach

### 3.1 Honest lower-bound charting

For a scored listing, the plotted x-coordinate is:

- `deliveredPrice` when item price and postage are known;
- `price` when postage is unknown.

Exact delivered-price listings use filled dots. Item-price-only listings use hollow dots and are labelled “from £X + postage.” Lower-bound points never participate in the exact Pareto frontier because unknown postage could change their ordering. They may still be selected, filtered, and inspected.

The chart model exposes `plottedPrice` and `priceCertainty: "exact" | "lower-bound"`; it does not overload `deliveredPrice` or pretend unknown postage is free.

### 3.2 Value map

The current G16 anchors an equal-value line at £1,170 and power 100. A point above that line has more estimated power per pound than the current machine; a point below has less. The chart uses restrained background regions and direct labels:

- “Better value than your G16” above the line;
- “More expensive per unit of power” below it;
- an upper-left callout for the strongest “more power, lower price” quadrant.

Dot colour communicates value relative to the baseline:

- strong: at least 20% better power per pound;
- competitive: from 5% below to 20% above;
- weak: more than 5% below.

For lower-bound points these labels are prefixed with “possible,” because postage can only make the final value worse. The exact Pareto frontier remains a separate green outline and line.

### 3.3 Actionable readiness states

Each listing receives one derived readiness state:

- `ready`: complete power and delivered price;
- `postage-unknown`: complete power, known item price, unknown postage;
- `specs-incomplete`: exact delivered price, incomplete CPU/GPU power;
- `postage-and-specs`: both limitations.

Cards always show the known item price. When postage is unknown they say “£X + postage unknown,” not “Price unavailable.” Missing CPU, GPU, RAM, storage, or postage is listed explicitly. Summary chips show counts for all four states and filter the results.

### 3.4 Recommendation explanation

Rankings continue to use the deterministic `recommendationScore`. The dashboard adds a short evidence-based explanation generated from computed facts, for example:

> 34% more estimated power per £1,000 than your G16, with 64 GB RAM and returns accepted. Postage is still unknown.

The explanation is assembled locally from structured fields. AI-provided prose is not used as an unverified purchasing claim.

## 4. GPT-5.6 Luna enrichment

### 4.1 Scope

Every listing is offered to the AI enrichment stage, not only parser failures. The request contains the title, description, condition description, structured eBay aspects, and already-derived deterministic fields. It does not ask the model to browse the web, estimate postage, invent benchmark scores, or decide whether to buy.

The model is `gpt-5.6-luna` with `reasoning.effort: "medium"`, the Responses API, Structured Outputs, and `store: false`. The response schema contains:

- normalized brand, CPU model, GPU model, RAM, storage, screen size, resolution, and VRAM;
- upgradeability claims;
- risk flags;
- an evidence substring for every non-null claim;
- per-field confidence (`high`, `medium`, or `low`);
- a short extraction note for audit/debugging.

### 4.2 Merge rules

1. Deterministic high-confidence values remain authoritative.
2. AI may fill a null field only when it supplies a literal evidence substring present in the listing input.
3. AI may replace a deterministic medium/low-confidence field only when its evidence is present and its normalized value maps to the local catalog.
4. A conflict with a deterministic high-confidence field creates a warning and remains unresolved; it does not silently overwrite.
5. AI model names that do not map to the versioned local benchmark catalog remain visible as extracted text but do not receive a power score.
6. Hard exclusions and price calculations are never AI-controlled.
7. Final recommendation scores are recalculated by the existing deterministic engine after the merge.

### 4.3 Cache and reliability

The cache key is a SHA-256 fingerprint of the prompt version plus all listing text/aspects supplied to the model. Cache entries record the model ID, prompt version, response ID, token usage, timestamp, structured output, and validation/merge result. Writes are atomic and checkpoint after every successful listing.

The command retries transient API failures with bounded exponential backoff and a concurrency limit of four. A refusal, invalid evidence substring, or unmapped model is recorded without corrupting the listing. Reruns process only new or changed fingerprints.

`npm run enrich:laptops:ai` requires a non-empty `OPENAI_API_KEY` and exits before changing files if it is absent. The ordinary `npm run build` remains offline and deterministic. Deployment serves the already-generated JSON; it does not spend API money on page loads.

## 5. Data and provenance

The dataset schema is incremented and records:

- AI model and prompt version;
- counts requested, cached, succeeded, refused, failed, and merged;
- per-listing AI provenance and evidence;
- whether each displayed field came from eBay aspects, listing text, deterministic catalog normalization, or AI-assisted extraction.

No API key, raw authorization header, or hidden reasoning content is written to the dataset or cache.

## 6. UI design

The existing dark technical visual language remains, but the chart becomes the primary decision surface:

- a larger plot at desktop widths;
- a visible point-count summary: “161 plotted: 51 exact, 110 + postage” for the current dataset;
- a two-row legend separating value colour from price certainty;
- a selected-point panel showing exact/lower-bound price, power, value comparison, missing facts, and a direct eBay link;
- larger hit targets than visual dots for keyboard and pointer accessibility;
- result cards ordered by deterministic recommendation score, with readiness and AI-assisted provenance badges.

On mobile the chart keeps a minimum internal width and scrolls horizontally, while the selected-point summary remains readable without scrolling.

## 7. Testing and evaluation

Test-first coverage must include:

- lower-bound points appear in the chart but never enter the exact frontier;
- exact and lower-bound point counts;
- readiness classification for all four states;
- baseline-relative value bands and “possible” wording;
- known item-price display when postage is absent;
- Structured Output schema parsing, evidence-substring validation, merge precedence, conflict warnings, cache hits, retries, refusals, and atomic writes using a fake OpenAI client;
- a fixed evaluation fixture containing clear, ambiguous, misleading, accessory, parts-only, and missing-spec listings;
- full unit tests, ESLint, production build, dataset sanity checks, and desktop/mobile browser inspection.

The AI stage is considered an improvement only if the evaluation fixture increases correct field recovery without increasing false CPU/GPU assignments or weakening existing exclusions.

## 8. Deployment boundary

Deployment occurs only after local tests, lint, build, dataset sanity checks, and a successful live enrichment run. Because the local `OPENAI_API_KEY` is currently empty, implementation and mocked verification may proceed, but the live enrichment and final redeployment remain blocked until the key is configured locally.

