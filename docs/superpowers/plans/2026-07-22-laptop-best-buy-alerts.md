# Laptop Best-Buy Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh eBay UK twice daily, rank dependable replacement laptops for local backtesting work, make new candidates obvious, publish the dashboard, and send evidence-backed Telegram digests.

**Architecture:** Keep the existing eBay collection and deterministic parsing pipeline, then add a post-collection benchmark-evidence and best-buy ranking layer. Pure TypeScript modules own scoring, eligibility, new-item detection and Telegram formatting; thin Node scripts own network/file effects; GitHub Actions owns the Europe/London schedule, Vercel publication and notification sequence.

**Tech Stack:** Node.js 24, TypeScript, `tsx`, Node test runner, React 19, Vite 8, eBay Browse API, PassMark evidence pages, Telegram Bot API, GitHub Actions and Vercel CLI.

## Global Constraints

- Use advertised item price only; postage must not affect filtering, ranking, charts or recommendation copy.
- Reference machine: ASUS ROG Strix G16, i9-14900HX, RTX 4060 Laptop GPU, 64 GB RAM, 1 TB storage and £1,170.
- Eligibility requires CPU multi-core and single-thread scores at least equal to the G16, at least 64 GB RAM, at least 1 TB storage, RTX 4060-equivalent or better, working-laptop evidence and price at most £3,000.
- Work performance is `100 × (multiCore / 100)^0.70 × (singleThread / 100)^0.30`.
- GPU performance is an eligibility floor with zero ranking weight.
- Benchmark evidence is refreshed for unseen hardware immediately and for known hardware after seven days.
- Telegram secrets stay server-side and never enter browser assets, datasets, commits or logs.
- Scheduled runs occur at 08:00 and 20:00 in `Europe/London`.
- Existing eBay throttling fallback and AI deterministic-precedence guarantees remain intact.
- Every production behavior is introduced by a failing test first.

---

## File structure

**Create**

- `src/laptop/best-buy.ts` — pure work-score, eligibility, frontier, ranking and explanation rules.
- `src/laptop/benchmark-evidence.ts` — benchmark evidence schema, validation, freshness and dataset rescoring.
- `src/laptop/snapshot.ts` — first/last-seen merging and eligible-ID diffing.
- `src/laptop/telegram.ts` — pure digest construction and HTML escaping.
- `scripts/passmark-benchmark-provider.ts` — bounded fetch and parsing for current CPU/GPU evidence.
- `scripts/refresh-benchmark-evidence.ts` — cache refresh plus atomic dataset rescoring.
- `scripts/send-laptop-alerts.ts` — Telegram Bot API transport and durable alert state.
- `scripts/verify-laptop-dataset.ts` — production-data invariant verifier.
- `data/laptop-benchmark-evidence.json` — tracked, auditable benchmark cache.
- `data/laptop-alert-state.json` — tracked digest idempotency and previously seen eligible IDs.
- `.github/workflows/laptop-alerts.yml` — twice-daily refresh, verification, deployment and notification.
- `tests-js/best-buy.test.ts`, `tests-js/benchmark-evidence.test.ts`, `tests-js/snapshot.test.ts`, `tests-js/telegram.test.ts`.
- `tests-js/fixtures/passmark-cpu.html`, `tests-js/fixtures/passmark-gpu.html` — deterministic provider fixtures.

**Modify**

- `src/laptop/types.ts` — best-buy and evidence fields on listings/datasets.
- `src/laptop/dashboard.ts` — advertised-price charting and best-buy rank adapters.
- `src/App.tsx`, `src/App.css`, `src/index.css` — new-results section and explainable work comparisons.
- `scripts/collect-laptops.ts` — retain prior snapshot timestamps and refresh status.
- `scripts/enrich-laptops-ai.ts`, `src/laptop/ai-pipeline.ts` — preserve/rescore new fields after AI merge.
- `package.json`, `.env.example`, `.gitignore`, `README.md` — commands, secrets and operations.

---

### Task 1: Add the pure CPU-focused best-buy model

**Files:**
- Create: `src/laptop/best-buy.ts`
- Modify: `src/laptop/types.ts`
- Test: `tests-js/best-buy.test.ts`

**Interfaces:**
- Produces: `workPerformance(multiPower, singlePower): number | null`.
- Produces: `workValueRatio(workPower, advertisedPrice): number | null`.
- Produces: `assessBestBuy(listing): BestBuyAssessment`.
- Produces: `bestBuyFrontier(listings): LaptopListing[]` and `rankBestBuys(listings): LaptopListing[]`.
- Adds to `LaptopListing`: `cpuMultiPower`, `cpuSinglePower`, `workPerformance`, `workValue`, `bestBuyEligible`, `bestBuyFailures`, `benchmarkEvidenceAt`, `firstSeenAt`, `lastSeenAt`.

- [ ] **Step 1: Add failing formula and eligibility tests**

```ts
test('scores work power with 70 percent multi-core and 30 percent single-thread', () => {
  assert.equal(workPerformance(100, 100), 100)
  assert.equal(workPerformance(128, 105), 120.616)
  assert.equal(workPerformance(null, 105), null)
})

test('ignores postage and GPU uplift while enforcing every replacement floor', () => {
  const row = makeListing({
    price: 2100, shippingPrice: 500, deliveredPrice: 2600,
    cpuMultiPower: 128, cpuSinglePower: 105, gpuPower: 129,
    ramGb: 64, storageGb: 2048, hardExcluded: false,
  })
  const result = assessBestBuy(row)
  assert.equal(result.eligible, true)
  assert.equal(result.workValue, workValueRatio(121.1, 2100))
})

test('rejects a downgrade in either CPU dimension', () => {
  assert.deepEqual(assessBestBuy(makeListing({ cpuMultiPower: 130, cpuSinglePower: 99 })).failures, ['single-thread below G16'])
})
```

- [ ] **Step 2: Run the focused test and observe RED**

Run: `npx tsx --test tests-js/best-buy.test.ts`

Expected: FAIL because `src/laptop/best-buy.ts` and the new fields do not exist.

- [ ] **Step 3: Add exact types and pure scoring functions**

```ts
export interface BestBuyAssessment {
  eligible: boolean
  failures: string[]
  workPerformance: number | null
  workValue: number | null
}

export const G16_REFERENCE = {
  advertisedPrice: 1170,
  cpuMultiScore: 43856,
  cpuSingleScore: 4177,
  gpuScore: 17359,
  ramGb: 64,
  storageGb: 1024,
} as const

export function workPerformance(multiPower: number | null, singlePower: number | null): number | null {
  if (multiPower == null || singlePower == null) return null
  return Math.round(1000 * 100 * (multiPower / 100) ** 0.70 * (singlePower / 100) ** 0.30) / 1000
}

export function workValueRatio(power: number | null, advertisedPrice: number): number | null {
  if (power == null || advertisedPrice <= 0) return null
  return Math.round(1000 * (power / advertisedPrice) / (100 / G16_REFERENCE.advertisedPrice)) / 1000
}
```

Implement `assessBestBuy` with ordered failure labels for hard exclusion, CPU evidence, both CPU floors, RAM, storage, GPU floor, unresolved conflicts and £3,000 price. Implement a dominance comparison using advertised price, work performance, RAM and storage; sort the surviving frontier by work value, evidence freshness, seller feedback, condition and price.

- [ ] **Step 4: Run focused and existing engine tests**

Run: `npx tsx --test tests-js/best-buy.test.ts tests-js/laptop-engine.test.ts`

Expected: PASS with no changes to deterministic parsing behavior.

- [ ] **Step 5: Commit the model**

```powershell
git add src/laptop/best-buy.ts src/laptop/types.ts tests-js/best-buy.test.ts
git commit -m "feat: add CPU-focused best-buy model"
```

---

### Task 2: Add auditable, refreshable benchmark evidence

**Files:**
- Create: `src/laptop/benchmark-evidence.ts`
- Create: `scripts/passmark-benchmark-provider.ts`
- Create: `scripts/refresh-benchmark-evidence.ts`
- Create: `data/laptop-benchmark-evidence.json`
- Create: `tests-js/benchmark-evidence.test.ts`
- Create: `tests-js/fixtures/passmark-cpu.html`
- Create: `tests-js/fixtures/passmark-gpu.html`
- Modify: `package.json`

**Interfaces:**
- Produces: `BenchmarkEvidenceRecord`, `BenchmarkEvidenceStore`, `isFresh(record, now, maxAgeDays)`.
- Produces: `benchmarkKey(kind, canonical): string` using the stable `cpu:<canonical>` / `gpu:<canonical>` key convention.
- Produces: `parsePassmarkCpuPage(html)` and `parsePassmarkGpuPage(html)`.
- Produces: `refreshBenchmarkEvidence(models, store, options)` with injected `fetchImpl` and clock.
- Produces: `applyBenchmarkEvidence(listing, store): LaptopListing`.

- [ ] **Step 1: Add failing parser, freshness and rescoring tests**

```ts
test('parses current CPU evidence and sample count', () => {
  assert.deepEqual(parsePassmarkCpuPage(cpuHtml), {
    multiCoreScore: 56100,
    singleThreadScore: 4391,
    sampleCount: 628,
  })
})

test('treats evidence as fresh for seven days inclusive', () => {
  const now = new Date('2026-07-22T12:00:00Z')
  assert.equal(isFresh(makeCpuRecord({ retrievedAt: '2026-07-15T12:00:00Z' }), now, 7), true)
  assert.equal(isFresh(makeCpuRecord({ retrievedAt: '2026-07-15T11:59:59Z' }), now, 7), false)
})

test('replaces the stale 149 percent CPU claim with current evidence', () => {
  const row = applyBenchmarkEvidence(makeListing({ cpuModel: 'AMD Ryzen 9 9955HX' }), store)
  assert.equal(row.cpuMultiPower, 127.9)
  assert.equal(row.cpuSinglePower, 105.1)
  assert.equal(row.workPerformance, 120.584)
})
```

- [ ] **Step 2: Run the focused test and observe RED**

Run: `npx tsx --test tests-js/benchmark-evidence.test.ts`

Expected: FAIL because the evidence modules and fixtures do not exist.

- [ ] **Step 3: Define the evidence schema and initial audited baseline**

```ts
export interface BenchmarkEvidenceRecord {
  kind: 'cpu' | 'gpu'
  canonical: string
  multiCoreScore?: number
  singleThreadScore?: number
  graphicsScore?: number
  sourceName: 'PassMark'
  sourceUrl: string
  observedAt: string
  retrievedAt: string
  sampleCount: number | null
  status: 'validated' | 'stale' | 'failed'
  providerVersion: 'passmark-html-v1'
  lastError?: string
}

export interface BenchmarkEvidenceStore {
  schemaVersion: 1
  refreshedAt: string
  records: Record<string, BenchmarkEvidenceRecord>
}
```

Seed the tracked JSON with the G16 CPU record (`43856` multi-core, `4177` single-thread) and GPU record (`17359` G3D), using their existing PassMark source URLs and `2026-07-22T00:00:00Z` as the initial retrieval time. The first refresh discovers and adds every distinct current-dataset model. CPU lookup URLs use `https://www.cpubenchmark.net/cpu.php?cpu=<encoded canonical name>`; GPU refresh uses the audited source URL already attached to the matching static benchmark entry. A model without a source URL remains in needs-checking rather than receiving an inferred score.

- [ ] **Step 4: Implement bounded PassMark parsing and refresh**

```ts
export function visibleText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
}

export function parsePassmarkCpuPage(html: string) {
  const text = visibleText(html)
  const match = text.match(/Average CPU Mark.*?Multithread Rating\s*([\d,]+).*?Single Thread Rating\s*([\d,]+).*?Samples:\s*([\d,]+)/i)
  if (!match) throw new Error('PassMark CPU metrics were not found')
  return {
    multiCoreScore: Number(match[1].replaceAll(',', '')),
    singleThreadScore: Number(match[2].replaceAll(',', '')),
    sampleCount: Number(match[3].replaceAll(',', '')),
  }
}
```

Implement the equivalent `G3D Rating` parser, a 15-second `AbortSignal.timeout` fetch, non-2xx rejection, positive-number validation, atomic writes, distinct-model batching and retention of the last validated record as `stale` when refresh fails. Never write response bodies or secret-bearing request data to errors.

- [ ] **Step 5: Add the refresh command**

```json
{
  "scripts": {
    "refresh:laptop-benchmarks": "tsx scripts/refresh-benchmark-evidence.ts"
  }
}
```

The command reads `public/data/laptop-listings.json`, refreshes distinct unseen/stale models, rescales every listing, updates dataset counts and `benchmarkVersion`, then atomically writes the evidence store and dataset.

- [ ] **Step 6: Run parser, engine and AI pipeline tests**

Run: `npx tsx --test tests-js/benchmark-evidence.test.ts tests-js/laptop-engine.test.ts tests-js/ai-enrichment-pipeline.test.ts`

Expected: PASS; network access is replaced by injected fixture responses.

- [ ] **Step 7: Commit benchmark evidence**

```powershell
git add src/laptop/benchmark-evidence.ts scripts/passmark-benchmark-provider.ts scripts/refresh-benchmark-evidence.ts data/laptop-benchmark-evidence.json tests-js/benchmark-evidence.test.ts tests-js/fixtures/passmark-cpu.html tests-js/fixtures/passmark-gpu.html package.json package-lock.json
git commit -m "feat: refresh auditable laptop benchmarks"
```

---

### Task 3: Preserve snapshot history and identify genuinely new matches

**Files:**
- Create: `src/laptop/snapshot.ts`
- Modify: `scripts/collect-laptops.ts`
- Modify: `src/laptop/types.ts`
- Modify: `src/laptop/ai-pipeline.ts`
- Test: `tests-js/snapshot.test.ts`
- Test: `tests-js/ai-enrichment-pipeline.test.ts`

**Interfaces:**
- Produces: `mergeSeenTimestamps(previous, current, now): LaptopListing[]`.
- Produces: `newEligibleIds(previousIds, currentListings): Set<string>`.
- Adds `refreshStatus: 'fresh' | 'cached-fallback'` to `LaptopDataset`.

- [ ] **Step 1: Add failing snapshot lifecycle tests**

```ts
test('preserves first seen time and advances last seen time', () => {
  const rows = mergeSeenTimestamps(
    [makeListing({ id: 'same', firstSeenAt: '2026-07-21T08:00:00Z', lastSeenAt: '2026-07-21T08:00:00Z' })],
    [makeListing({ id: 'same' }), makeListing({ id: 'new' })],
    '2026-07-22T08:00:00Z',
  )
  assert.equal(rows[0].firstSeenAt, '2026-07-21T08:00:00Z')
  assert.equal(rows[0].lastSeenAt, '2026-07-22T08:00:00Z')
  assert.equal(rows[1].firstSeenAt, '2026-07-22T08:00:00Z')
})

test('reports only newly eligible item IDs', () => {
  assert.deepEqual([...newEligibleIds(new Set(['old']), [eligible('old'), eligible('new'), ineligible('rejected')])], ['new'])
})
```

- [ ] **Step 2: Run tests and observe RED**

Run: `npx tsx --test tests-js/snapshot.test.ts tests-js/ai-enrichment-pipeline.test.ts`

Expected: FAIL because snapshot fields and merge functions do not exist.

- [ ] **Step 3: Implement timestamp merging and collector status**

```ts
export function mergeSeenTimestamps(previous: LaptopListing[], current: LaptopListing[], now: string): LaptopListing[] {
  const prior = new Map(previous.map((row) => [row.id, row]))
  return current.map((row) => ({
    ...row,
    firstSeenAt: prior.get(row.id)?.firstSeenAt ?? now,
    lastSeenAt: now,
  }))
}
```

Read the previous dataset before collection, merge timestamps immediately before the atomic write, set `refreshStatus: 'fresh'`, and set `cached-fallback` without changing `generatedAt` when eBay fallback is used. Preserve the fields through legacy-cache upgrades and AI merges.

- [ ] **Step 4: Run focused tests**

Run: `npx tsx --test tests-js/snapshot.test.ts tests-js/ebay-laptop-api.test.ts tests-js/ai-enrichment-pipeline.test.ts`

Expected: PASS, including cached fallback retaining the previous successful timestamp.

- [ ] **Step 5: Commit snapshot tracking**

```powershell
git add src/laptop/snapshot.ts src/laptop/types.ts scripts/collect-laptops.ts src/laptop/ai-pipeline.ts tests-js/snapshot.test.ts tests-js/ai-enrichment-pipeline.test.ts
git commit -m "feat: track new laptop listings across refreshes"
```

---

### Task 4: Build idempotent Telegram digests

**Files:**
- Create: `src/laptop/telegram.ts`
- Create: `scripts/send-laptop-alerts.ts`
- Create: `data/laptop-alert-state.json`
- Create: `tests-js/telegram.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `buildTelegramDigest(dataset, state, dashboardUrl): TelegramDigest`.
- Produces: `sendTelegramMessage(options): Promise<{ messageId: number }>`.
- Produces: `AlertState` containing `seenEligibleIds`, `lastSnapshotHash`, `lastSentAt`, `lastMessageId`.

- [ ] **Step 1: Add failing digest, escaping, length and idempotency tests**

```ts
test('puts new best buys first and links to eBay', () => {
  const digest = buildTelegramDigest(dataset([eligible('new', 1), eligible('old', 2)]), state(['old']), DASHBOARD_URL)
  assert.match(digest.html, /🆕.*new/s)
  assert.match(digest.html, /Multi-core \+28% · single-thread \+5%/)
  assert.match(digest.html, /https:\/\/www\.ebay\.co\.uk\/itm\//)
  assert.ok(digest.html.length <= 4096)
})

test('does not create a second digest for the same successful snapshot', () => {
  assert.equal(buildTelegramDigest(datasetRows, stateWithSameHash, DASHBOARD_URL).shouldSend, false)
})

test('escapes Telegram HTML supplied by listing titles', () => {
  assert.match(buildTelegramDigest(dataset([eligible('<cheap & fast>')]), emptyState(), DASHBOARD_URL).html, /&lt;cheap &amp; fast&gt;/)
})
```

- [ ] **Step 2: Run the focused test and observe RED**

Run: `npx tsx --test tests-js/telegram.test.ts`

Expected: FAIL because Telegram modules do not exist.

- [ ] **Step 3: Implement the pure formatter**

```ts
export function escapeTelegramHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

export interface AlertState {
  schemaVersion: 1
  seenEligibleIds: string[]
  lastSnapshotHash: string | null
  lastSentAt: string | null
  lastMessageId: number | null
}
```

Format new eligible rows in best-buy order, then include enough current leaders to reach three unique listings. When there are no new rows, include only the current leader. Cap listing count before truncating prose; never truncate inside an HTML entity or anchor. Use each listing's existing `listingUrl` and the dashboard production URL.

- [ ] **Step 4: Implement the Bot API transport and state update**

```ts
const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    chat_id: chatId,
    text: digest.html,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
  }),
  signal: AbortSignal.timeout(15_000),
})
```

Validate the Bot API `{ ok, result.message_id }` response. In `--dry-run`, print the digest without credentials or state mutation. In live mode, require both secrets, send once, and atomically update state only after the API confirms success. Redact the token from all thrown errors.

- [ ] **Step 5: Add scripts and initial state**

```json
{
  "scripts": {
    "alerts:laptops": "tsx scripts/send-laptop-alerts.ts",
    "alerts:laptops:dry-run": "tsx scripts/send-laptop-alerts.ts --dry-run"
  }
}
```

Initialize `data/laptop-alert-state.json` with schema version 1, an empty seen-ID list and null send fields.

- [ ] **Step 6: Run Telegram tests and a fixture dry run**

Run: `npx tsx --test tests-js/telegram.test.ts && npm run alerts:laptops:dry-run`

Expected: tests PASS and the preview contains no token, no postage language, a dashboard link and at most 4,096 characters.

- [ ] **Step 7: Commit Telegram delivery**

```powershell
git add src/laptop/telegram.ts scripts/send-laptop-alerts.ts data/laptop-alert-state.json tests-js/telegram.test.ts package.json package-lock.json
git commit -m "feat: send laptop best-buy Telegram digests"
```

---

### Task 5: Replace the dashboard's gaming/postage ranking with work value

**Files:**
- Modify: `src/laptop/dashboard.ts`
- Modify: `src/App.tsx`
- Modify: `src/App.css`
- Modify: `src/index.css`
- Test: `tests-js/dashboard.test.ts`
- Test: `tests-js/best-buy.test.ts`

**Interfaces:**
- `rankListings` delegates to `rankBestBuys` for the recommended sort.
- `chartPrice(listing)` always returns `listing.price`.
- `buildChartModel` plots `workPerformance` against advertised item price.
- The React result modes become `new`, `matches`, `needs-checking`, `shortlist`.

- [ ] **Step 1: Add failing advertised-price, new-section and comparison tests**

```ts
test('chart and value always use advertised price', () => {
  const row = makeListing({ price: 1000, shippingPrice: 900, deliveredPrice: 1900, workPerformance: 120 })
  assert.deepEqual(chartPrice(row), { price: 1000, certainty: 'exact' })
  assert.equal(buildChartModel([row]).points[0].plottedPrice, 1000)
})

test('separates listings first seen within 24 hours', () => {
  const result = partitionResults([recent, older], filters, '', new Date('2026-07-22T20:00:00Z'))
  assert.deepEqual(result.newMatches.map((row) => row.id), [recent.id])
})
```

- [ ] **Step 2: Run dashboard tests and observe RED**

Run: `npx tsx --test tests-js/dashboard.test.ts tests-js/best-buy.test.ts`

Expected: FAIL because charting still uses delivered price/combined gaming power and there is no new partition.

- [ ] **Step 3: Refactor the dashboard model**

Remove lower-bound postage concepts from chart and copy. Keep legacy fields readable for old datasets, but require `workPerformance` for best-buy chart points. Change axes to `ADVERTISED PRICE` and `BACKTESTING WORK PERFORMANCE`; draw the G16 reference at £1,170 and power 100; construct the frontier from advertised-price points.

- [ ] **Step 4: Add the visible new-results and evidence presentation**

Render a `New since the last update` section above the market results. Give rows less than 24 hours old a high-contrast `NEW` badge. Each card and selected-point panel must show:

```text
Multi-core +28% · single-thread +5%
Work performance +21% · RAM 64 GB (=) · storage 2 TB (2×)
RTX 5070 Ti — passes graphics floor
£2,100 advertised · work value 29% below your G16
```

Remove postage warnings, hollow-point styling and postage certainty labels. Retain condition, seller, returns, risk, confidence, shortlist and direct eBay-link controls.

- [ ] **Step 5: Run dashboard tests, lint and build**

Run: `npm test && npm run lint && npm run build`

Expected: all tests PASS, ESLint exits 0, and Vite production build exits 0.

- [ ] **Step 6: Commit the dashboard**

```powershell
git add src/laptop/dashboard.ts src/App.tsx src/App.css src/index.css tests-js/dashboard.test.ts tests-js/best-buy.test.ts
git commit -m "feat: show new CPU-focused laptop best buys"
```

---

### Task 6: Compose the verified twice-daily refresh pipeline

**Files:**
- Modify: `package.json`
- Modify: `scripts/enrich-laptops-ai.ts`
- Create: `.github/workflows/laptop-alerts.yml`
- Test: `tests-js/ai-enrichment-pipeline.test.ts`

**Interfaces:**
- Produces `npm run refresh:laptop-alerts` for collection, optional AI enrichment, benchmark refresh and build preparation.
- Workflow consumes eBay, OpenAI, Telegram and Vercel repository secrets.

- [ ] **Step 1: Add a failing command-level preservation test**

```ts
test('AI enrichment preserves snapshot and best-buy fields until benchmark rescoring', async () => {
  const merged = await runPipelineFixture(makeListing({ firstSeenAt: FIRST_SEEN, cpuMultiPower: 128 }))
  assert.equal(merged.firstSeenAt, FIRST_SEEN)
  assert.equal(merged.cpuMultiPower, 128)
})
```

- [ ] **Step 2: Run the pipeline test and observe RED**

Run: `npx tsx --test tests-js/ai-enrichment-pipeline.test.ts`

Expected: FAIL where spread/merge code drops the new fields.

- [ ] **Step 3: Preserve fields and add the local pipeline script**

```json
{
  "scripts": {
    "refresh:laptop-alerts": "npm run collect:laptops && npm run enrich:laptops:ai && npm run refresh:laptop-benchmarks"
  }
}
```

Keep AI optional: when `OPENAI_API_KEY` is absent, the existing command exits without mutating the dataset and benchmark refresh still runs.

- [ ] **Step 4: Create the scheduled workflow**

```yaml
name: Laptop best-buy alerts

on:
  workflow_dispatch:
  schedule:
    - cron: '0 8 * * *'
      timezone: 'Europe/London'
    - cron: '0 20 * * *'
      timezone: 'Europe/London'

concurrency:
  group: laptop-best-buy-alerts
  cancel-in-progress: false

permissions:
  contents: write

jobs:
  refresh:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    env:
      EBAY_CLIENT_ID: ${{ secrets.EBAY_CLIENT_ID }}
      EBAY_CLIENT_SECRET: ${{ secrets.EBAY_CLIENT_SECRET }}
      EBAY_MARKETPLACE_ID: EBAY_GB
      OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
      TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
      TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_CHAT_ID }}
      VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
      VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
      VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}
      LAPTOP_DASHBOARD_URL: https://laptopscraper.vercel.app
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }
      - run: npm ci
      - run: npm run refresh:laptop-alerts
      - run: npm test
      - run: npm run lint
      - run: npm run build
      - name: Deploy verified dataset
        run: npx vercel deploy --prod --yes --token "$VERCEL_TOKEN" > deployment-url.txt
      - name: Send digest after publication
        run: npm run alerts:laptops
      - name: Persist successful snapshot and alert state
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add public/data/laptop-listings.json data/laptop-benchmark-evidence.json data/laptop-alert-state.json
          git diff --cached --quiet || git commit -m "chore: refresh laptop alerts"
          git push
```

Add a workflow condition that skips deploy/send when `refreshStatus` is `cached-fallback`, while still allowing the job to report preserved data.

- [ ] **Step 5: Validate workflow syntax and run the local pipeline with fixtures**

Run: `npm test && npm run lint && npm run build && npm run alerts:laptops:dry-run`

Expected: all commands exit 0 and no command prints a secret value.

- [ ] **Step 6: Commit scheduling**

```powershell
git add package.json package-lock.json scripts/enrich-laptops-ai.ts .github/workflows/laptop-alerts.yml tests-js/ai-enrichment-pipeline.test.ts
git commit -m "feat: schedule twice-daily laptop alerts"
```

---

### Task 7: Document and configure secure operation

**Files:**
- Modify: `.env.example`
- Modify: `.gitignore`
- Modify: `README.md`

**Interfaces:**
- Documents local dry run, live send, benchmark refresh, GitHub secrets, Vercel deployment and failure recovery.

- [ ] **Step 1: Add environment keys without values**

```dotenv
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
LAPTOP_DASHBOARD_URL=https://laptopscraper.vercel.app
VERCEL_TOKEN=
VERCEL_ORG_ID=
VERCEL_PROJECT_ID=
```

Keep `.env`, `.vercel/`, raw response captures and temporary alert previews ignored. Keep the two tracked JSON state files explicitly unignored.

- [ ] **Step 2: Document the exact operating commands**

```powershell
npm run refresh:laptop-alerts
npm run alerts:laptops:dry-run
npm test
npm run lint
npm run build
```

Explain the CPU multi/single split, 70/30 work score, advertised-price value ratio, seven-day benchmark freshness, RTX 4060 floor, new-item semantics, 08:00/20:00 schedule and cached-fallback behavior.

- [ ] **Step 3: Document repository secret setup**

```powershell
gh secret set EBAY_CLIENT_ID
gh secret set EBAY_CLIENT_SECRET
gh secret set OPENAI_API_KEY
gh secret set TELEGRAM_BOT_TOKEN
gh secret set TELEGRAM_CHAT_ID
gh secret set VERCEL_TOKEN
gh secret set VERCEL_ORG_ID
gh secret set VERCEL_PROJECT_ID
```

State that the bot must first receive a user message before its private chat can be targeted. Do not include any real credential or chat ID in documentation.

- [ ] **Step 4: Run documentation-sensitive checks and commit**

Run: `git diff --check && npm run lint && npm run build`

Expected: zero whitespace errors, lint failures or build failures.

```powershell
git add .env.example .gitignore README.md
git commit -m "docs: explain laptop alert operations"
```

---

### Task 8: Complete end-to-end verification and controlled release

**Files:**
- Create: `scripts/verify-laptop-dataset.ts`
- Modify if generated: `public/data/laptop-listings.json`
- Modify if generated: `data/laptop-benchmark-evidence.json`
- Modify if generated: `data/laptop-alert-state.json`

**Interfaces:**
- Produces a verified production dashboard, one controlled Telegram smoke message and an enabled twice-daily workflow.

- [ ] **Step 1: Run complete local verification**

Run: `npm test`

Expected: every parsing, evidence, ranking, snapshot, Telegram, AI and eBay test passes.

Run: `npm run lint`

Expected: exit code 0.

Run: `npm run build`

Expected: TypeScript and Vite exit 0 with a production bundle.

- [ ] **Step 2: Run a live refresh without Telegram mutation**

Run: `npm run refresh:laptop-alerts && npm run alerts:laptops:dry-run`

Expected: the digest uses advertised prices only, every included row passes all floors, benchmark evidence is no more than seven days old, direct eBay links are present, and new rows appear before the current leaders.

- [ ] **Step 3: Add and run the production-data invariant verifier**

```ts
import { readFile } from 'node:fs/promises'
import { assessBestBuy } from '../src/laptop/best-buy'
import { benchmarkKey, isFresh, type BenchmarkEvidenceStore } from '../src/laptop/benchmark-evidence'
import type { LaptopDataset } from '../src/laptop/types'

const dataset = JSON.parse(await readFile('public/data/laptop-listings.json', 'utf8')) as LaptopDataset
const evidence = JSON.parse(await readFile('data/laptop-benchmark-evidence.json', 'utf8')) as BenchmarkEvidenceStore

const recommendations = dataset.listings.filter((row) => row.bestBuyEligible)
const invalid = recommendations.filter((row) => !assessBestBuy(row).eligible)
const missingLinks = recommendations.filter((row) => !/^https:\/\/www\.ebay\.co\.uk\/itm\//.test(row.listingUrl))
const stale = recommendations.filter((row) => {
  const record = row.cpuModel ? evidence.records[benchmarkKey('cpu', row.cpuModel)] : undefined
  return !record || !isFresh(record, new Date(), 7)
})
const duplicateCount = dataset.listings.length - new Set(dataset.listings.map((row) => row.id)).size
const postageDependent = recommendations.filter((row) => row.workValue !== assessBestBuy({ ...row, shippingPrice: 9999, deliveredPrice: 9999 }).workValue)

console.log(`invalid recommendations: ${invalid.length}`)
console.log(`missing eBay links: ${missingLinks.length}`)
console.log(`stale recommended benchmarks: ${stale.length}`)
console.log(`duplicate IDs: ${duplicateCount}`)
console.log(`postage-dependent ranks: ${postageDependent.length}`)

if (invalid.length || missingLinks.length || stale.length || duplicateCount || postageDependent.length) process.exitCode = 1
```

Run: `npx tsx scripts/verify-laptop-dataset.ts`

Expected output includes `invalid recommendations: 0`, `missing eBay links: 0`, `stale recommended benchmarks: 0`, `duplicate IDs: 0`, and `postage-dependent ranks: 0`. The checks call the production best-buy functions rather than duplicating their formulas.

- [ ] **Step 4: Configure secrets and run one manual GitHub workflow dispatch**

Run: `gh workflow run laptop-alerts.yml`

Expected: refresh, verification, production deployment and Telegram send succeed in order. Confirm that the Telegram message has working eBay/dashboard links and the production dataset timestamp matches the workflow run.

- [ ] **Step 5: Verify scheduled operation and repository state**

Run: `gh run list --workflow laptop-alerts.yml --limit 3`

Expected: the manual run is successful and the generated snapshot/state commit is present on `main`. Confirm both schedule entries remain enabled.

- [ ] **Step 6: Commit any release-only corrections after rerunning affected checks**

```powershell
git status --short
git diff --check
git add -- public/data/laptop-listings.json data/laptop-benchmark-evidence.json data/laptop-alert-state.json scripts/verify-laptop-dataset.ts
git diff --cached --quiet || git commit -m "fix: complete laptop alert release"
git push origin main
```

Do not create an empty release commit. Do not enable the scheduled workflow until the controlled Telegram smoke message and production verification both pass.
