# Laptop Best-Buy Finder

An evidence-first eBay UK search that finds a dependable replacement for the current ASUS ROG Strix G16 and sends concise morning and evening Telegram updates. The dashboard and Telegram use one shared ranking model.

The reference machine is:

- Intel Core i9-14900HX
- NVIDIA RTX 4060 Laptop GPU
- 64 GB RAM
- 1 TB storage
- £1,170 reference price

## What qualifies

A recommendation must be a complete working laptop, cost no more than £3,000 advertised, have at least 64 GB RAM and 1 TB storage, pass the RTX 4060 graphics floor, and have neither lower multi-core nor lower single-thread CPU performance than the G16. An unresolved specification conflict keeps a listing out of recommendations.

Postage is deliberately excluded from filtering, ranking and recommendation wording. The system ranks the advertised item price only.

Listings with missing or conflicting evidence stay in the separate **Needs info** view and are never sent as buying recommendations.

## Backtesting work score

All comparisons use the G16 as `100`:

```text
multiCore = 100 × candidateMultiCore / G16MultiCore
singleThread = 100 × candidateSingleThread / G16SingleThread
workPerformance = 100 × (multiCore / 100)^0.70 × (singleThread / 100)^0.30
workValue = (workPerformance / advertisedPrice) / (100 / 1170)
```

Multi-core receives 70% because local optimizer work can run across parallel CPU workers. Single-thread receives 30% because each trial and serial phase still depends on one thread. GPU speed above the RTX 4060 floor has zero ranking weight. RAM and storage are gates shown separately, not artificial power multipliers.

CPU comparisons are always split into multi-core and single-thread figures; the app never claims that a processor is simply one percentage “better.” Benchmark evidence is refreshed when more than seven days old.

## New listings and alerts

`firstSeenAt` is retained by eBay item ID. A qualifying item is marked **NEW** for 24 hours; a relisted title with the same item ID does not become new again.

The GitHub Actions workflow runs at approximately 08:00 and 20:00 in `Europe/London`, including daylight-saving changes. Each fresh successful run:

1. collects current listings through the official eBay Browse API;
2. optionally applies cached GPT-5.6 Luna evidence extraction;
3. refreshes stale or newly required benchmarks and recalculates every score;
4. runs tests, lint and the production build;
5. deploys the verified dashboard to Vercel;
6. sends Telegram only after deployment succeeds; and
7. commits the successful dataset, benchmark cache and alert state.

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
