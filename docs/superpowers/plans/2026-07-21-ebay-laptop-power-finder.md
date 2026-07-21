# eBay Laptop Power Finder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the lens-oriented UI with a live, official-eBay-API laptop finder that plots delivered price against normalized CPU/GPU power and supports a comprehensive, coordinated filter set up to £3,000.

**Architecture:** Pure TypeScript modules parse and score listings; a Node TypeScript collector calls eBay Browse API and writes an atomic static dataset; the React/Vite frontend filters the generated data locally and renders an accessible SVG scatter/Pareto graph. CPU and GPU scores are independently normalized to the current i9-14900HX/RTX 4060 Laptop baseline of 100.

**Tech Stack:** Node 24, TypeScript, `tsx`, Node test runner, React 19, Vite 8, official eBay Browse API, custom accessible SVG/CSS.

## Global Constraints

- Marketplace is `EBAY_GB`; currency is GBP; delivered-price ceiling is exactly £3,000.
- Use only official eBay OAuth and Browse API endpoints, never listing-page HTML scraping.
- Do not expose eBay credentials to browser code or commit `.env`.
- Unknown/conflicting CPU or GPU specifications never receive a precise combined score.
- Default combined-power weighting is 60% CPU and 40% GPU, adjustable from 20% to 90% CPU.
- Existing lens data remains untouched; laptop output is `public/data/laptop-listings.json`.
- All production behavior is introduced by a failing test first.

---

### Task 1: Source control and test harness

**Files:**
- Modify: `.gitignore`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `npm run test:laptops`, `npm run collect:laptops`, and a repository whose secret `.env` is ignored.

- [ ] **Step 1: Initialize the empty GitHub-targeted repository locally**

```powershell
git init -b main
git remote add origin https://github.com/longytravel/laptopscraper.git
git check-ignore .env
```

Expected: `.env` is ignored and the remote points to the user-specified empty repository.

- [ ] **Step 2: Add the TypeScript execution dependency and scripts**

```json
{
  "scripts": {
    "test:laptops": "tsx --test tests-js/*.test.ts",
    "collect:laptops": "tsx scripts/collect-laptops.ts"
  },
  "devDependencies": {
    "tsx": "^4.20.6"
  }
}
```

- [ ] **Step 3: Install and verify the empty test harness**

Run: `npm install`  
Expected: lockfile updated without audit errors that block installation.

- [ ] **Step 4: Commit the recoverable baseline**

```powershell
git add -A
git commit -m "chore: preserve scraper baseline"
```

Expected: all project files except ignored secrets/build artifacts are committed.

### Task 2: Laptop parser and power model

**Files:**
- Create: `src/laptop/types.ts`
- Create: `src/laptop/benchmarks.ts`
- Create: `src/laptop/engine.ts`
- Create: `tests-js/laptop-engine.test.ts`

**Interfaces:**
- Produces: `parseLaptopListing(raw)`, `combinedPower(cpuPower, gpuPower, cpuWeight)`, `enrichListing(raw)`, `paretoFrontier(listings)`, `applyFilters(listings, filters)`.

- [ ] **Step 1: Write failing parsing and exclusion tests**

```ts
test('parses CPU GPU RAM and storage from a laptop title', () => {
  const parsed = parseLaptopListing({
    title: 'ASUS ROG Strix G16 i9-14900HX RTX 4070 32GB RAM 1TB SSD',
    localizedAspects: [],
  })
  assert.equal(parsed.cpuModel, 'Intel Core i9-14900HX')
  assert.equal(parsed.gpuModel, 'NVIDIA GeForce RTX 4070 Laptop GPU')
  assert.equal(parsed.ramGb, 32)
  assert.equal(parsed.storageGb, 1024)
})

test('hard excludes accessories and faulty laptops', () => {
  assert.equal(parseLaptopListing({ title: 'ROG G16 box only' }).hardExcluded, true)
  assert.equal(parseLaptopListing({ title: 'RTX 4080 laptop spares or repair' }).hardExcluded, true)
})
```

- [ ] **Step 2: Run RED**

Run: `npm run test:laptops`  
Expected: FAIL because `src/laptop/engine.ts` does not exist.

- [ ] **Step 3: Implement exact-model normalization and risk classification**

Implement aspect-first extraction with title/description fallbacks, normalized CPU/GPU aliases, RAM/storage/screen extraction, hard exclusion reasons, warning flags, per-field provenance and confidence.

- [ ] **Step 4: Run GREEN for parsing**

Run: `npm run test:laptops`  
Expected: parsing/exclusion tests PASS.

- [ ] **Step 5: Write failing power, missing-data, filter and Pareto tests**

```ts
test('anchors the current laptop and adjusts CPU priority', () => {
  assert.equal(combinedPower(100, 100, 0.6), 100)
  assert.ok(combinedPower(120, 80, 0.9) > combinedPower(120, 80, 0.2))
})

test('does not score an unknown GPU', () => {
  assert.equal(enrichListing({ title: 'Gaming laptop i9-14900HX' }).combinedPower, null)
})

test('returns only non-dominated listings on the frontier', () => {
  assert.deepEqual(paretoFrontier([
    { id: 'a', deliveredPrice: 1000, combinedPower: 100 },
    { id: 'b', deliveredPrice: 1200, combinedPower: 90 },
    { id: 'c', deliveredPrice: 1400, combinedPower: 130 },
  ]).map(row => row.id), ['a', 'c'])
})
```

- [ ] **Step 6: Run RED, then implement benchmark normalization, geometric weighting, value index, recommendation evidence, all coordinated filters and Pareto calculation**

Run before implementation: `npm run test:laptops`  
Expected: new tests FAIL for missing behavior.

- [ ] **Step 7: Run GREEN and commit**

Run: `npm run test:laptops`  
Expected: all laptop engine tests PASS.

```powershell
git add src/laptop tests-js package.json package-lock.json
git commit -m "feat: add laptop power engine"
```

### Task 3: Official eBay API collector

**Files:**
- Create: `scripts/ebay-laptop-api.ts`
- Create: `scripts/collect-laptops.ts`
- Create: `tests-js/ebay-laptop-api.test.ts`
- Modify: `.env.example`
- Create/Modify: `public/data/laptop-listings.json`

**Interfaces:**
- Consumes: `enrichListing(raw)` from Task 2 and `getEbayToken()` semantics from `scripts/ebay-auth.mjs`.
- Produces: `buildSearchParams`, `fetchSearchPage`, `collectSearches`, `writeDatasetAtomic` and the static dashboard dataset.

- [ ] **Step 1: Write failing API contract tests**

Tests cover GBP/GB/£3,000/FIXED_PRICE filters, pagination, deduplication, transient retry, permanent failure recording and secret-safe errors using an injected fake `fetch`.

- [ ] **Step 2: Run RED**

Run: `npm run test:laptops`  
Expected: FAIL because the API module does not exist.

- [ ] **Step 3: Implement the minimal API client and collector**

Use client-credentials OAuth, `X-EBAY-C-MARKETPLACE-ID`, `fieldgroups=EXTENDED`, category `177`, bounded search pagination, overlapping high-performance search families, item-ID deduplication and atomic output.

- [ ] **Step 4: Run GREEN**

Run: `npm run test:laptops`  
Expected: all API and engine tests PASS.

- [ ] **Step 5: Run live collection and validate the dataset**

Run: `npm run collect:laptops`  
Expected: non-zero live listing count, generated timestamp, no delivered price above £3,000, duplicates removed, and both scored and needs-checking groups represented.

- [ ] **Step 6: Commit**

```powershell
git add scripts tests-js .env.example public/data/laptop-listings.json
git commit -m "feat: collect live ebay laptops"
```

### Task 4: Price-versus-power dashboard

**Files:**
- Replace: `src/App.tsx`
- Replace: `src/App.css`
- Modify: `src/index.css`
- Modify: `src/main.tsx`
- Create: `src/laptop/dashboard.ts`
- Create: `tests-js/dashboard.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `LaptopDataset`, `applyFilters`, `combinedPower`, `paretoFrontier`.
- Produces: URL-addressable/local-storage-backed dashboard controls, accessible scatter plot, ranked results, needs-checking view and shortlist comparison.

- [ ] **Step 1: Write failing derived-dashboard tests**

Test default filter values, delivered-price range, CPU-weight recomputation, brand/condition/seller/returns/risk/RAM/VRAM/storage filters, shortlist serialization and selected listing derivation.

- [ ] **Step 2: Run RED**

Run: `npm run test:laptops`  
Expected: dashboard tests FAIL because the derived-state module is missing.

- [ ] **Step 3: Implement pure dashboard state and run GREEN**

Run: `npm run test:laptops`  
Expected: all tests PASS before UI wiring.

- [ ] **Step 4: Implement the UI from the approved design**

Build the technical-bench layout, dominant SVG scatter plot, current-machine crosshair, Pareto trace, keyboard/focus detail, sliders, categorical filters, counts, ranked results, needs-checking list and persistent shortlist. Use no new chart dependency.

- [ ] **Step 5: Implement responsive/accessibility states**

Add tablet/mobile reflow, native controls, visible focus, reduced motion, screen-reader SVG title/description, non-colour encodings, loading, stale, no-match and data-load error states.

- [ ] **Step 6: Update documentation and commit**

Document local setup, data refresh, power formula, uncertainty, eBay API usage and deployment environment variables.

```powershell
git add src README.md tests-js
git commit -m "feat: build laptop power dashboard"
```

### Task 5: Verification, GitHub and Vercel release

**Files:**
- Create: `vercel.json` only if Vercel auto-detection needs an explicit build/output contract.

**Interfaces:**
- Produces: verified GitHub repository and public production deployment.

- [ ] **Step 1: Run fresh complete verification**

```powershell
npm run test:laptops
python -m pytest -q
npm run lint
npm run build
```

Expected: zero test failures, zero lint errors and production build exit code `0`.

- [ ] **Step 2: Inspect the production dashboard in a browser**

Verify desktop and mobile graph layout, filter coordination, point selection, direct eBay links, shortlist persistence, empty state and no console errors.

- [ ] **Step 3: Commit any release-only configuration after rerunning affected checks**

```powershell
git status -sb
git diff --check
git add <explicit verified files>
git commit -m "chore: prepare production deployment"
```

- [ ] **Step 4: Push the finished branch/repository**

Push the verified history to `https://github.com/longytravel/laptopscraper` and confirm the remote commit.

- [ ] **Step 5: Configure Vercel without exposing secrets**

Link the project, set `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET` and `EBAY_MARKETPLACE_ID` as Vercel environment variables from the ignored local `.env`, and ensure logs never echo their values.

- [ ] **Step 6: Deploy and verify production**

Run a production deployment, open the public URL, verify HTTP success and dashboard content, then report the GitHub and Vercel URLs plus the live dataset timestamp/listing counts.

