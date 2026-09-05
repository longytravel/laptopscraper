# Laptop Best-Buy Finder

An evidence-first eBay UK search that finds a dependable replacement for the current ASUS ROG Strix G16 and sends concise morning and evening Telegram updates. The dashboard and Telegram use one shared ranking model.

The reference machine is:

- Intel Core i9-14900HX
- NVIDIA RTX 4060 Laptop GPU
- 64 GB RAM
- 1 TB storage
- £1,170 reference price

## What qualifies

A recommendation must be a complete working laptop, cost no more than £3,000 advertised, have at least 64 GB RAM and 1 TB storage, and have multi-core CPU performance at least equal to the G16. Single-thread performance and graphics are safety floors with a 5% tolerance: an index of 95 or more against the G16's i9-14900HX and RTX 4060 counts as matching them, because PassMark's own spread between samples of one part is wider than that. This admits the Ryzen 9 7945HX class (single-thread 96, multi-core 123) and the RTX 5060 (96) without relaxing the multi-core rule. An unresolved specification conflict keeps a listing out of recommendations.

Postage is deliberately excluded from filtering, ranking and recommendation wording. Ranking uses the advertised item price, less a credit for RAM and storage carried above the replacement floor.

Listings with missing or conflicting evidence stay in the separate **Needs info** view and are never sent as buying recommendations.

## Backtesting work score

All comparisons use the G16 as `100`:

```text
multiCore = 100 × candidateMultiCore / G16MultiCore
singleThread = 100 × candidateSingleThread / G16SingleThread
workPerformance = 100 × (multiCore / 100)^0.70 × (singleThread / 100)^0.30

surplusCredit = max(0, ramGb - 64) × £2.50 + max(0, storageGb - 1024) × £0.06
effectivePrice = max(£1, advertisedPrice - surplusCredit)
workValue = (workPerformance / effectivePrice) / (100 / 1170)
```

Multi-core receives 70% because local optimizer work can run across parallel CPU workers. Single-thread receives 30% because each trial and serial phase still depends on one thread. GPU speed above the RTX 4060 floor has zero ranking weight.

RAM and storage above the floor never touch `workPerformance`, because more of either does not make a single backtest run faster. They earn credit through `effectivePrice` instead: surplus hardware saves you buying the part separately, so it comes off the price that value is measured against, at street cost (DDR5 SO-DIMM ~£2.50/GB, NVMe ~£0.06/GB). `workPerformance` therefore stays an honest speed measure and is never inflated by capacity. The advertised price is still what the dashboard plots and what you pay; only the value ratio uses the credited figure.

CPU comparisons are always split into multi-core and single-thread figures; the app never claims that a processor is simply one percentage “better.” Benchmark evidence is refreshed when more than seven days old. On 2 September 2026 every stored CPU figure was cross-checked against PassMark's laptop and single-thread charts and every GPU figure against its GPU charts; all matched to the digit.

### Listing text

The Browse API search response carries only eBay's auto-generated two-sentence `shortDescription`. The per-item detail call, which the collector already makes, returns the seller's full description as HTML. Both are kept: the snippet, then the full text reduced to plain lines and capped at 6,000 characters. Warranty terms, seal status, keyboard layout, cosmetic notes and faults live in that full text, and until 5 September 2026 none of it was read. Two guards keep the longer text from misfiring: a hard-exclusion word inside the description is ignored when negated within the few words before it ("no faults", "not for parts"), and capacity ceilings ("upgradeable to 128GB", "supports up to 4TB") are stripped before RAM and storage are parsed. Business-seller status and the return window are also stored and shown, because a UK business seller owes Consumer Rights Act protection on top of eBay's guarantee.

### Risk flags

The deterministic parser raises a fixed set of risk labels. The AI extraction also reports risks, but in its own words, and 1,800 listings produced 880 distinct labels. Every AI label is folded into one of eleven fixed categories (no charger, instability reported, firmware or account lock, thermal concern, display or hinge damage, battery concern, stock photos, faulty or not working, not a laptop, cosmetic wear, listing details conflict) or dropped from the flags; the original wording is kept in `aiEnrichment.riskEvidence`. The dashboard's "Hide listings with" chips therefore stay short, and the default exclusions apply to AI-found risks too.

### Benchmark evidence integrity

PassMark's name search (`cpu.php?cpu=<name>`) returns the nearest chip, not an exact match: asking for the Core Ultra 9 285H returns the 285HX page, and asking for the Ryzen 9 9955HX returns the 9955HX3D page. The provider therefore reads the processor name printed on every page and compares it with the requested chip. On a mismatch it resolves the exact model through PassMark's lookup catalogue, whose links carry a numeric `id`, and re-verifies; if no exact page exists the record is marked failed or stale, never filled with another chip's scores. Records scraped before this check (`providerVersion` `passmark-html-v1`) are treated as stale and re-fetched. `npm run verify:laptop-dataset` fails on any two validated CPUs sharing identical multi-core, single-thread and sample figures, and `npm run audit:laptop-benchmarks` prints the collision, page-name and seed-divergence checks in full.

## New listings and alerts

`firstSeenAt` is retained by eBay item ID. A qualifying item is marked **NEW** for 24 hours; a relisted title with the same item ID does not become new again.

The GitHub Actions workflow runs at approximately 08:00 and 20:00 in `Europe/London`, including daylight-saving changes. Each fresh successful run:

1. collects current listings through the official eBay Browse API;
2. optionally applies cached GPT-5.6 Luna evidence extraction;
3. refreshes stale or newly required benchmarks and recalculates every score;
4. runs tests, lint and the production build;
5. sends the Telegram digest; and
6. commits the successful dataset, benchmark cache and alert state, which Vercel's Git integration publishes as the dashboard. The job then polls the live dataset until it serves this run's `generatedAt`.

GitHub starts scheduled jobs when it has capacity, which in practice is one to seven hours after the cron time, so the digests land late morning and late evening rather than at 08:30 and 20:30.

If eBay collection uses the cached fallback, verification still runs but deployment and Telegram are skipped. A snapshot already sent successfully is not sent twice.

## Local setup

Requirements: Node.js 24+ and eBay production Browse API credentials. OpenAI, Telegram and Vercel credentials are needed only for their respective optional/live operations.

```powershell
npm install
Copy-Item .env.example .env
```

Put credentials in the ignored `.env`; never add them to source files or generated JSON.

The complete local refresh is:

```powershell
npm run refresh:laptop-alerts
npm run alerts:laptops:dry-run
npm test
npm run lint
npm run build
```

`OPENAI_API_KEY` is optional. When absent, AI enrichment logs a skip and leaves the collected dataset unchanged before benchmark scoring continues.

AI evidence only ever fills gaps; it never overrides a value the deterministic parser found. A listing whose own text or aspects already put it under 64 GB or 1 TB, mark it as parts or faulty, or price it above £3,000 therefore cannot be lifted into the recommendations by more evidence, and the pipeline does not spend a model request on it (`unqualifiable` in `aiRun`). Roughly four listings in five fall into that group. Cached extractions are still applied when present.
GitHub Actions restores the previous ignored enrichment cache so unchanged listings do not consume model calls on every scheduled run. Local worktrees can reuse a cache by setting `LAPTOP_AI_CACHE_PATH` to its absolute path.

To send a real Telegram digest after reviewing the dry run:

```powershell
npm run alerts:laptops
```

The live command requires `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`. It writes `data/laptop-alert-state.json` only after Telegram confirms delivery.

## One-time Telegram and GitHub setup

Create a bot with BotFather, then send that bot a message from the private Telegram chat that should receive alerts. Telegram cannot target the private chat until the user has started the conversation. Obtain the chat ID without putting the token or ID in a committed file.

Configure the repository secrets interactively:

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

`OPENAI_API_KEY` can be omitted; all other secrets are required for the complete automated workflow. The workflow is also available through manual dispatch for a controlled smoke run.

## Failure recovery

- A transient eBay failure preserves the last good dataset and suppresses deploy/send.
- A benchmark-provider failure retains the last validated record, marks it stale and prevents unknown hardware from becoming a recommendation.
- AI failure cannot weaken deterministic exclusions or invent a ranking value.
- Deployment failure prevents Telegram from linking to an unpublished dashboard.
- Telegram failure leaves the snapshot unsent so a later run can retry it.
- Transport errors redact the Telegram token.

After fixing credentials or an upstream outage, run `npm run refresh:laptop-alerts`, inspect `npm run alerts:laptops:dry-run`, and manually dispatch the workflow.

## Buying-safety boundary

The system ranks observable listing evidence; it does not certify the physical laptop. Before purchase, verify the exact model, RAM configuration, storage, charger, serial/warranty status, return terms, GPU power limit, cooling condition and any seller disclosures.
