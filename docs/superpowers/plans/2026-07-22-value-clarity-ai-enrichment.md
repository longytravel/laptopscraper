# Value Clarity and AI Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make laptop value obvious by charting honest lower-bound prices, explaining readiness, and enriching every changed listing with cached GPT-5.6 Luna structured extraction.

**Architecture:** Extend the pure dashboard model first, then reshape the React chart/cards around the new model. Add a separate offline AI enrichment command that validates evidence and merges into the deterministic engine; deployment continues to serve static generated JSON.

**Tech Stack:** TypeScript 6, React 19, Vite 8, Node test runner, OpenAI JavaScript SDK, Zod, GPT-5.6 Luna Responses API, Vercel.

## Global Constraints

- Use `gpt-5.6-luna` with `reasoning.effort: "medium"`, Structured Outputs, and `store: false`.
- Never estimate or fabricate postage, benchmark scores, seller facts, or hardware specifications.
- Deterministic high-confidence fields, hard exclusions, price arithmetic, and final ranking remain authoritative.
- AI-derived non-null claims require an exact evidence substring from the supplied listing content.
- Lower-bound price points never participate in the exact Pareto frontier.
- Unchanged listing fingerprints must be served from cache without an API call.
- `npm run build` must remain offline and must not require `OPENAI_API_KEY`.
- Do not deploy until live AI enrichment and all verification gates pass.

---

### Task 1: Add chart price certainty and readiness models

**Files:**
- Modify: `src/laptop/dashboard.ts`
- Modify: `tests-js/dashboard.test.ts`

- [ ] **Step 1: Write failing tests** for a scored listing with unknown postage, exact/lower-bound point counts, exclusion of lower-bound points from `frontierIds`, and all four readiness states.
- [ ] **Step 2: Run `npm test -- --test-name-pattern="chart|readiness"`** and confirm the new assertions fail because the model still drops unknown-postage listings.
- [ ] **Step 3: Add `ListingReadiness`, `PriceCertainty`, `classifyReadiness`, and `chartPrice`**, then change `ChartListing` to expose `plottedPrice` and `priceCertainty`.
- [ ] **Step 4: Build the frontier from exact points only** while returning both exact and lower-bound points for rendering.
- [ ] **Step 5: Re-run the focused tests** and confirm they pass without changing existing filter behavior.

### Task 2: Add auditable value comparisons and recommendation reasons

**Files:**
- Modify: `src/laptop/dashboard.ts`
- Modify: `tests-js/dashboard.test.ts`

- [ ] **Step 1: Write failing tests** for baseline-relative value ratio, strong/competitive/weak bands, lower-bound “possible” qualification, and deterministic recommendation copy.
- [ ] **Step 2: Run the focused dashboard tests** and observe failure before implementation.
- [ ] **Step 3: Add constants for the G16 baseline** (`price = 1170`, `power = 100`) and pure helpers `baselineValueRatio`, `valueBand`, and `buildRecommendationReason`.
- [ ] **Step 4: Ensure lower-bound copy includes postage uncertainty** and never claims exact savings.
- [ ] **Step 5: Re-run the focused tests** and confirm all value helpers pass.

### Task 3: Redesign the chart and result states

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.css`
- Modify: `src/index.css`
- Modify: `tests-js/dashboard.test.ts`

- [ ] **Step 1: Add rendering-oriented assertions** for readiness counts and point summaries to the dashboard tests.
- [ ] **Step 2: Replace the single needs-checking presentation** with filterable readiness chips and always show item price plus postage status.
- [ ] **Step 3: Render the G16 equal-value line and labelled value regions**; colour points by value band and use fill/stroke to distinguish exact from lower-bound price.
- [ ] **Step 4: Add a two-row legend and selected-point decision panel** with power, price certainty, value comparison, missing facts, recommendation reason, provenance, and eBay link.
- [ ] **Step 5: Increase the chart’s usable desktop area and pointer/focus hit targets**, retaining horizontal mobile scrolling and accessible SVG labels.
- [ ] **Step 6: Run `npm test`, `npm run lint`, and `npm run build`**; fix implementation defects without weakening tests.

### Task 4: Implement the Luna Structured Output client and validation

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/laptop/ai-enrichment.ts`
- Create: `tests-js/ai-enrichment.test.ts`

- [ ] **Step 1: Install `openai` and `zod`** with npm so the official SDK and `zodTextFormat` are version-locked.
- [ ] **Step 2: Write failing tests** around a fake `responses.parse` client for request configuration, structured parsing, evidence validation, deterministic precedence, fill-only merge behavior, conflict warnings, refusals, and transient retries.
- [ ] **Step 3: Define the Zod schema** for normalized fields, per-field evidence/confidence, upgradeability, risk flags, and extraction note.
- [ ] **Step 4: Implement `requestListingEnrichment`** with model `gpt-5.6-luna`, medium effort, `store: false`, bounded output, and a concise extraction prompt that forbids inference beyond supplied evidence.
- [ ] **Step 5: Implement `validateAiEvidence` and `mergeAiEnrichment`** so every accepted claim is evidenced and catalog-compatible before the deterministic engine recalculates scores.
- [ ] **Step 6: Run `npm test -- ai-enrichment`** and confirm the new suite passes with no network calls.

### Task 5: Add fingerprint cache and offline enrichment command

**Files:**
- Create: `scripts/enrich-laptops-ai.ts`
- Modify: `scripts/collect-laptops.ts`
- Modify: `src/laptop/types.ts`
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `.gitignore`
- Create: `tests-js/ai-enrichment-command.test.ts`

- [ ] **Step 1: Write failing command-level tests** for a missing key, content fingerprint stability, cache hit/no-call, changed-listing miss, atomic checkpoint, partial failure accounting, and schema metadata.
- [ ] **Step 2: Add schema fields** for AI provenance, evidence, model/prompt versions, usage totals, and run counts.
- [ ] **Step 3: Implement SHA-256 fingerprints and an atomic JSON cache** under `.cache/`, checkpointing after every successful response.
- [ ] **Step 4: Implement the CLI** with concurrency four, bounded exponential retry, clear progress/cost usage reporting, and no output-file mutation when the key is absent.
- [ ] **Step 5: Add scripts** `enrich:laptops:ai` and `refresh:laptops` while leaving `build` offline.
- [ ] **Step 6: Run the command-level tests and full `npm test`**.

### Task 6: Evaluate extraction quality and document operation

**Files:**
- Create: `tests-js/fixtures/laptop-ai-eval.json`
- Create: `scripts/evaluate-laptop-ai.ts`
- Modify: `README.md`
- Modify: `.env.example`

- [ ] **Step 1: Create a labelled fixture** covering clear specs, ambiguous generations, misleading desktop/accessory titles, parts-only listings, missing CPU/GPU, and conflicting aspects/title evidence.
- [ ] **Step 2: Implement an offline evaluator** that reports deterministic-only versus hybrid exact matches, false assignments, unresolved fields, and exclusion regressions.
- [ ] **Step 3: Add `npm run evaluate:laptops:ai`** and require zero new false CPU/GPU assignments and zero hard-exclusion regressions before accepting increased recovery.
- [ ] **Step 4: Document key setup, explicit enrichment, cache behavior, expected cost controls, merge rules, and offline deployment behavior** in `README.md` and `.env.example`.
- [ ] **Step 5: Run the evaluator with fakes/fixtures** and retain its concise result as verification evidence.

### Task 7: Live enrichment, visual verification, and deployment

**Files:**
- Modify when generated: `public/data/laptop-listings.json`

- [ ] **Step 1: Confirm `OPENAI_API_KEY` is configured locally without printing it.** If absent, stop this task without modifying the dataset.
- [ ] **Step 2: Run `npm run enrich:laptops:ai`** and record requested/cached/succeeded/failed/merged counts plus token usage.
- [ ] **Step 3: Run dataset sanity checks** proving all 319 item prices remain intact, no hard exclusions regress, chartable counts increase or stay stable, and provenance contains no secrets.
- [ ] **Step 4: Run fresh full verification:** `npm test`, `npm run lint`, and `npm run build`.
- [ ] **Step 5: Inspect desktop and narrow-mobile layouts** and exercise point selection, readiness filters, exact/lower-bound legend semantics, empty states, keyboard focus, and direct eBay links.
- [ ] **Step 6: Deploy to the existing Vercel project**, verify the production URL returns the new build and dataset, and perform a final production smoke test.

