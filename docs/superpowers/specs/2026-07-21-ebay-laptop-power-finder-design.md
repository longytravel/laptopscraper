# eBay Laptop Power Finder Design

**Date:** 2026-07-21  
**Status:** Approved design awaiting written-spec review  
**Primary job:** Help the owner replace an unstable ASUS ROG Strix G16 with the safest, best-value eBay UK laptop that is at least as powerful, without exceeding £3,000 delivered.

## 1. Baseline and success criteria

The current machine is the comparison baseline:

- ASUS ROG Strix G16 G614JVR
- Intel Core i9-14900HX, 24 cores / 32 threads
- NVIDIA GeForce RTX 4060 Laptop GPU, 8 GB VRAM
- 64 GB system RAM
- Baseline CPU power: `100`
- Baseline GPU power: `100`
- Baseline combined power: `100`

The product succeeds when it can:

1. Retrieve currently available laptop listings from the official eBay Browse API for `EBAY_GB`.
2. Cover delivered prices from £0 to £3,000 and remove duplicate listings returned by overlapping searches.
3. Extract enough hardware information to compare CPU, GPU, RAM, storage, screen, condition, seller and returns.
4. Plot delivered price against an explainable power score, with the present laptop visibly anchored at power `100`.
5. Let the user change CPU-versus-GPU priority and immediately recompute the graph and rankings.
6. Make unknown specifications and risky listings obvious rather than assigning false precision.
7. Produce a shortlist with direct eBay links and enough seller/returns evidence to support a purchase decision.

## 2. Chosen approach

Use an API-first, single-purpose laptop pipeline alongside the existing lens pipeline. Reuse the working eBay OAuth helper and Browse API patterns, but do not mutate the lens datasets or force laptop concepts into lens-specific models.

Rejected alternatives:

- HTML page scraping is more fragile, more likely to break on markup or anti-bot changes, and unnecessary while valid Browse API credentials are available.
- A manual CSV workflow cannot answer what is currently available.
- AI-only specification extraction would be expensive, nondeterministic and unavailable because the local OpenAI key is empty. Deterministic parsing is the primary path.

## 3. Data acquisition

### 3.1 Search coverage

The collector will execute overlapping searches designed to cover powerful gaming and mobile-workstation laptops rather than specific brands only. Search families will include:

- RTX 4060, 4070, 4080 and 4090 laptops
- RTX 5060, 5070, 5070 Ti, 5080 and 5090 laptops
- Intel Core i9 / Core Ultra 9 performance laptops
- AMD Ryzen 9 / Ryzen AI 9 HX performance laptops
- Mobile workstations with equivalent NVIDIA RTX graphics

Every API request will use:

- marketplace `EBAY_GB`
- GBP currency
- a maximum item price of £3,000
- relevant laptop categories when the API provides them
- supported conditions: new, certified refurbished, seller refurbished, open-box-equivalent and used
- `EXTENDED` field groups
- pagination up to a configurable per-search cap

Overlapping results are deduplicated by eBay item ID. The collector records which search terms matched each listing so search coverage remains auditable.

### 3.2 Detail enrichment

The Browse search response is the first pass. The item detail endpoint enriches candidate listings with:

- localized item aspects
- condition description
- buying options
- return terms
- quantity/availability
- fuller description when available

Enrichment uses bounded concurrency, a request timeout, retries only for transient `429` and `5xx` responses, and a small backoff. A failed detail request does not discard the listing; it lowers its specification confidence and records the error.

### 3.3 Output and atomicity

The collector writes a laptop-specific dataset at `public/data/laptop-listings.json`. It first writes a temporary file and renames it only after JSON serialization completes, so a crash cannot leave the dashboard with a half-written dataset.

The dataset header records generation time, marketplace, search runs, raw count, deduplicated count, enriched count, scored count, unscored count and benchmark-catalog version.

## 4. Hardware extraction

Specification parsing combines, in priority order:

1. structured eBay localized aspects;
2. item title;
3. short description and condition description.

The parser normalizes:

- manufacturer and model family
- CPU manufacturer and exact CPU model
- GPU manufacturer and exact laptop GPU model
- GPU VRAM when stated or safely implied by an exact GPU catalog entry
- installed RAM
- storage capacity and storage type
- screen size, resolution and refresh rate
- operating system
- charger inclusion

Each extracted field has a provenance (`aspect`, `title`, `description`, `catalog` or `unknown`) and confidence. Conflicting values are retained as a warning; structured aspects win for filtering, but the conflict prevents a high-confidence score.

The parser must distinguish laptop GPUs from similarly named desktop GPUs and must not infer a dedicated GPU from vague phrases such as “gaming graphics.”

## 5. Power model

### 5.1 Benchmark catalog

A versioned local catalog maps recognized laptop CPUs and GPUs to representative benchmark indices plus source metadata. The catalog contains the current i9-14900HX and RTX 4060 Laptop GPU anchors and every additional model observed during the live collection run.

Raw benchmark values are never presented as if they came from eBay. The normalized scores are:

```text
cpuPower = 100 × candidateCpuBenchmark / i9_14900HXBenchmark
gpuPower = 100 × candidateGpuBenchmark / rtx_4060_laptopBenchmark
```

The default combined power uses a geometric weighted mean so a very strong GPU cannot completely conceal a severely weaker CPU, or vice versa:

```text
cpuWeight = 0.60
gpuWeight = 0.40
combinedPower = 100 × (cpuPower / 100) ^ cpuWeight × (gpuPower / 100) ^ gpuWeight
```

The dashboard exposes one “CPU ↔ GPU priority” slider. Moving it changes `cpuWeight` from `0.20` to `0.90`; `gpuWeight` is always `1 - cpuWeight`. The default is CPU-oriented because the owner’s development, Python test and backtesting workloads are CPU-heavy.

RAM and storage do not inflate compute power. They are separate readiness constraints. A machine below 64 GB is allowed only when the listing or model evidence says it is upgradeable; it receives a visible upgrade-required warning and an estimated post-upgrade cost only when a configured estimate exists.

### 5.2 Missing and uncertain specifications

- Both CPU and GPU recognized: full combined power score.
- Only one recognized: show the known component score, but no combined score.
- Generic CPU/GPU family only: show an estimated range, never a precise point.
- Conflicting or absent critical specifications: place in the “Needs checking” results list, not on the main power scatter plot.

### 5.3 Value and recommendation scores

Delivered price is `item price + shipping`. “Power per £1,000” is:

```text
valueIndex = combinedPower / (deliveredPrice / 1000)
```

The recommendation score is not disguised as power. It separately combines:

- value index
- CPU/GPU fit against the current slider weighting
- RAM readiness
- specification confidence
- seller feedback quality and volume
- returns availability
- condition and textual risk penalties

The graph also draws a Pareto frontier: listings for which no cheaper listing has equal-or-greater power. Frontier membership is factual and independent of the recommendation score.

## 6. Safety and risk classification

Hard exclusions default to hidden but can be revealed:

- parts only, spares or repair, faulty or untested
- laptop shell, screen, motherboard, box, manual, charger or other accessory only
- BIOS/firmware/password locked
- account, activation or MDM locked
- liquid damage or no power
- explicitly missing CPU/GPU/motherboard

Warnings remain visible and filterable:

- overheating, crashing, blue screen, instability or intermittent faults
- screen defects, damaged hinge, keyboard faults or battery faults
- no charger or non-original charger
- stock photos or insufficient specification evidence
- seller feedback below threshold
- no returns
- collection only
- RAM below the selected minimum

The collector never labels a listing “safe.” It reports observed signals and confidence.

## 7. Coordinated dashboard controls

All controls update the graph, summary strip and results table together.

### Core sliders

- delivered price range: £0–£3,000
- minimum combined power
- minimum CPU power
- minimum GPU power
- CPU ↔ GPU priority
- minimum RAM: 16–128 GB
- minimum GPU VRAM: 4–24 GB
- minimum storage: 256 GB–4 TB
- minimum seller feedback percentage
- minimum seller feedback count

### Categorical filters

- “At least as powerful as mine” toggle, enabled by default
- condition
- brand
- CPU manufacturer/family
- GPU family
- screen-size range
- resolution
- buying option: Buy It Now / auction
- returns accepted
- UK item location
- upgrade-required allowed
- specification confidence
- include/exclude risk flags
- show hard exclusions

### Actions

- reset to recommended defaults
- refresh timestamp and command guidance
- shortlist/unshortlist a listing in local storage
- compare shortlisted machines
- open the original eBay listing

## 8. Information architecture and visual design

The page’s single job is to answer: “Which currently available laptop gives me at least this machine’s power at a defensible price and seller risk?”

Desktop layout:

```text
┌──────────────────────────────────────────────────────────────────────┐
│ LAPTOP POWER FINDER       live-data time       reset / refresh      │
├────────────────┬─────────────────────────────────────────────────────┤
│ FILTER RAIL    │ PRICE (£ delivered) × POWER (this laptop = 100)    │
│ price          │                                                     │
│ power          │ scatter + current-machine line + Pareto frontier   │
│ CPU/GPU weight │ hover/focus detail; click selects                  │
│ hardware       │                                                     │
│ seller/safety  │                                                     │
├────────────────┴─────────────────────────────────────────────────────┤
│ ranked results / needs checking / shortlist                         │
└──────────────────────────────────────────────────────────────────────┘
```

On tablet the filter rail becomes a collapsible control region above the graph. On mobile the graph remains horizontally legible, essential filters come first, and results use compact stacked rows rather than an unreadable wide table.

### Visual system

The direction is a precise hardware test bench, not a generic neon gaming dashboard.

- `Bench`: `#E9EEF2` page background
- `Paper`: `#F7F9FB` controlled surfaces
- `Carbon`: `#10151A` primary text and axes
- `Cobalt trace`: `#2251D1` normal scored listings
- `Thermal orange`: `#F15A35` current baseline, selection and important warnings
- `Verified green`: `#15705B` Pareto/frontier evidence

Typography uses a condensed technical display face for the title, a highly readable sans-serif for controls/results, and a mono face for prices, benchmark values and specifications. The memorable element is the graph’s current-machine crosshair and live Pareto trace, which makes the replacement decision visible at a glance.

The graph is the dominant surface. Summary metrics are limited to useful counts: matching listings, Pareto listings and listings needing specification checks. Decorative cards, excessive gradients and unrelated animation are excluded.

Interactions use visible keyboard focus, native controls, accessible labels, SVG title/description, non-colour point encodings, reduced-motion support and tooltips mirrored by a keyboard-accessible selected-listing summary.

## 9. Component boundaries

Implementation will keep responsibilities separate:

- eBay collection and OAuth
- detail enrichment and retry policy
- laptop text/aspect parsing
- benchmark lookup and power calculation
- risk classification
- dataset serialization
- filter state and derived results
- power scatter/Pareto calculation
- result list and shortlist comparison

Pure parsing, scoring, filtering and Pareto functions will be testable without network access. API functions accept injected `fetch` implementations so authentication, pagination, retries and response mapping can be tested deterministically.

## 10. Error and empty states

- Missing credentials: collector exits with the exact missing variable names and does not overwrite prior data.
- Authentication failure: show HTTP status and eBay request error without printing secrets.
- Partial search/detail failure: preserve successful results, record failed searches/items and exit non-zero only when no useful dataset can be produced.
- Rate limiting: honor `Retry-After` where present, then bounded exponential backoff.
- Stale data: dashboard visibly reports generated time and age.
- No matches: say which active constraints removed all scored listings and offer a one-click reset.
- Unknown specs: keep the listing in “Needs checking” with the missing fields named.

## 11. Testing and verification

Test-first coverage will include:

- CPU/GPU/RAM/storage parsing from representative eBay titles and aspects
- rejection of desktop parts and accessories
- risk phrases relevant to unstable laptops
- deduplication across searches
- normalization against the current laptop
- adjustable geometric power weighting
- missing/conflicting hardware behavior
- delivered price and value index
- Pareto frontier correctness
- every coordinated dashboard filter
- URL and local-storage shortlist behavior
- API authentication, pagination, retry and partial-failure handling with deterministic fake responses

Completion requires fresh evidence from:

1. focused unit tests with observed red/green cycles;
2. the full Python and JavaScript/TypeScript test suites that apply;
3. ESLint;
4. the production TypeScript/Vite build;
5. a live eBay GB collection using the configured credentials;
6. schema/data sanity checks on the generated live dataset;
7. browser inspection at desktop and narrow mobile widths, including graph interactions and empty/error states.

## 12. Scope boundaries

This version does not:

- purchase, bid, message sellers or change anything on eBay;
- claim a listing is reliable beyond observable evidence;
- fabricate missing specifications;
- scrape HTML while official API coverage is available;
- estimate resale profit from sold comparables;
- delete or rewrite the existing lens-arbitrage datasets.

## 13. Acceptance checklist

- Live eBay API data generated successfully and timestamped.
- No listing above £3,000 delivered appears under default settings.
- Current laptop is anchored at CPU/GPU/combined power `100`.
- Graph, table and counts react to every filter without a page reload.
- Default view requires combined power at least `100`.
- Unknown-spec listings never receive a precise combined power score.
- Seller, returns, condition, delivery and risk evidence is visible before opening eBay.
- Pareto frontier and power-per-price ranking are independently test-covered.
- Shortlist comparison survives a page refresh.
- Desktop and mobile layouts are usable and keyboard accessible.

