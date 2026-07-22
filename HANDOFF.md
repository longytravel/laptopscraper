# Laptop Power Finder — context handoff

Last updated: 22 July 2026 (Europe/London)

This is the restart document for the laptop-finding system. A new developer or a fresh Codex context should read this file first, then inspect the files named in **Resume order**. Do not reconstruct the project from chat history.

## Outcome the user wants

Find a genuinely good-value replacement for the user's current ASUS ROG Strix G16 and keep the user informed automatically in Telegram every morning and evening.

The user does not care about gaming performance. The machine is for local backtesting and other demanding work. GPU capability is therefore a safety floor, not a reason to rank a laptop higher.

Only recommend complete, working laptops that are at least as capable as the G16 on every hard requirement:

- at least 64 GB RAM;
- at least 1 TB storage;
- CPU multi-core performance at least equal to the G16;
- CPU single-thread performance at least equal to the G16;
- GPU at least the audited RTX 4060 Laptop floor;
- advertised item price no more than £3,000;
- exact CPU identity and sufficiently trustworthy specification evidence;
- no unresolved evidence conflict.

Postage is deliberately ignored. Filter, ranking, chart position and Telegram wording all use the advertised item price only.

## Current live state

- Production dashboard: <https://laptopscraper.vercel.app>
- GitHub repository: <https://github.com/longytravel/laptopscraper>
- Canonical branch: `main`
- Completed implementation checkpoint before this handoff: `22446b6b57804ac3e2ae952b69217eb595446b5a`
- Current `main` includes this handoff after that checkpoint; always verify its live tip with the commands in **Resume order** rather than copying a self-referential handoff SHA
- Current primary inventory source: official eBay Browse API
- Production dataset generated: `2026-07-22T20:13:12.756Z`
- Dataset at handoff: 319 collected listings, 18 eligible recommendations, schema version 7
- Telegram delivery: configured and successfully smoke-tested
- Scheduled automation: enabled at 08:00 and 20:00 Europe/London every day

The first manually triggered hosted workflow completed successfully, but eBay returned HTTP 429 for every search because that day's API quota was exhausted. The workflow correctly used the cached dataset, ran verification, and skipped deployment and Telegram rather than pretending stale results were new. The scheduled runs remain enabled. If eBay still rate-limits a run, no stale alert is sent.

Workflow run showing this fail-safe behaviour: <https://github.com/longytravel/laptopscraper/actions/runs/29956014664>

## Current purchase verdict

At the handoff snapshot, none of the qualifying replacements beat the G16's original £1,170 work-value baseline. That is an important result: the system should not manufacture a recommendation merely because it found eligible laptops.

The leading snapshot candidates were:

1. [Acer Predator Helios Neo 16S AI — £1,950](https://www.ebay.co.uk/itm/398093513919): work performance +23%, multi-core +27%, single-thread +13%, but work-value 26% below the G16. New; 64 GB; 1 TB; RTX 5070 Ti.
2. [Lenovo Legion Pro 7 — £2,100](https://www.ebay.co.uk/itm/168507236897): work performance +31%, multi-core +43%, single-thread +8%, but work-value 27% below the G16. Used; 64 GB; 2 TB; RTX 5070 Ti.
3. [MSI Titan GT77 — £2,098](https://www.ebay.co.uk/itm/198490245189): work performance +3%, multi-core +4%, single-thread +1%, and work-value 43% below the G16. 64 GB; 3 TB; RTX 4090.

Listings are transient. These are evidence of the scoring output on 22 July, not permanent recommendations.

## Exact scoring contract

The visible G16 baseline is:

- ASUS ROG Strix G16;
- Intel Core i9-14900HX;
- RTX 4060 Laptop GPU;
- 64 GB RAM;
- 1 TB storage floor;
- advertised comparison price £1,170;
- multi-core, single-thread, GPU and combined work performance indexed to 100.

CPU benchmark evidence is converted into multi-core and single-thread indices relative to the G16. A candidate is rejected if either CPU index is below 100. This prevents a high-core-count CPU from hiding weak interactive/single-thread performance.

For an eligible laptop:

```text
work performance = 100 × (multi index / 100)^0.70 × (single index / 100)^0.30

work value = (work performance / advertised price)
             ÷ (100 / £1,170)
```

This is a weighted geometric mean: 70% multi-core and 30% single-thread. It matches the user's backtesting-heavy workload while retaining a meaningful single-thread floor. GPU receives zero ranking weight once the RTX 4060 floor is met.

Recommendations are ordered primarily by work-value. The dashboard also computes a Pareto frontier across advertised price, work performance, RAM and storage so a clearly dominated laptop is not presented as a best trade-off.

Do not casually change this formula or claim that a CPU is “49% better” from model naming, core counts, marketing boost clocks, or a single benchmark. Percentage claims must come from the audited benchmark evidence and must identify whether they mean multi-core, single-thread or the combined work score.

## Automation and secrets

Workflow file: `.github/workflows/laptop-alerts.yml`

Schedules:

```yaml
- cron: '0 8 * * *'
  timezone: 'Europe/London'
- cron: '0 20 * * *'
  timezone: 'Europe/London'
```

The following GitHub Actions secrets are configured. Never write their values into source files, logs or this handoff:

- `EBAY_CLIENT_ID`
- `EBAY_CLIENT_SECRET`
- `OPENAI_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

Security follow-up: the Telegram bot token was pasted into chat before it was stored as a GitHub secret. The user explicitly chose to continue temporarily and rotate it later. It must be revoked/reissued through BotFather, then replaced with:

```powershell
gh secret set TELEGRAM_BOT_TOKEN
```

Do not repeat or recover the old token from chat, shell history or logs.

## Data flow and safety behaviour

```text
eBay Browse API
  -> deterministic collection and basic extraction
  -> optional AI evidence enrichment with a fingerprinted cache
  -> audited CPU/GPU benchmark mapping
  -> hard eligibility gates
  -> work-power and value scoring
  -> dataset verification
  -> deploy fresh dashboard
  -> compare alert state and send Telegram update
```

Important safeguards:

- AI helps extract uncertain listing facts; it does not decide price, performance or ranking.
- Cache keys include the full evidence fingerprint so changed evidence is re-evaluated.
- Conflicting or incomplete evidence is rejected, not guessed.
- A cached fallback after an eBay 429 is safe to display, but is not deployed or announced as a fresh scan.
- Telegram state prevents the same unchanged result from being announced repeatedly.
- Links in recommendations must point to the actual listing.
- Keep base-price ranking even if a source exposes postage; the user has explicitly rejected postage-based ranking complexity.

## Verification completed at handoff

The last full local release verification passed:

- `npm test`: 81 passed, 0 failed
- `npm run lint`: passed
- `npm run build`: passed
- `npm run verify:laptop-dataset`: 18 recommendations; 0 invalid; 0 omitted eligible; 0 missing eBay links; 0 stale benchmarks; 0 duplicate IDs; 0 postage-dependent ranks
- workflow YAML lint: passed
- production dashboard HTTP response: 200
- production dataset HTTP response: 200
- Telegram controlled send: succeeded; Telegram message ID 3

The production page was checked by HTTP/content inspection. Interactive browser screenshot QA was unavailable during the release, so visual screenshot verification remains a low-priority follow-up.

## Resume order

1. Read this file.
2. Check the canonical state:

   ```powershell
   git status --short
   git rev-parse HEAD
   git fetch origin
   git rev-parse origin/main
   gh run list --workflow laptop-alerts.yml --limit 5
   ```

3. Inspect the newest scheduled run, especially whether collection is `fresh` or `cached-fallback`.
4. Open the production dashboard and its dataset:
   - <https://laptopscraper.vercel.app>
   - <https://laptopscraper.vercel.app/data/laptop-listings.json>
5. If changing code, read the design and implementation plan:
   - `docs/superpowers/specs/2026-07-22-laptop-best-buy-alerts-design.md`
   - `docs/superpowers/plans/2026-07-22-laptop-best-buy-alerts.md`
6. Run proportionate verification before claiming success:

   ```powershell
   npm test
   npm run lint
   npm run build
   npm run verify:laptop-dataset
   ```

Do not send a real Telegram alert during development. Use:

```powershell
npm run alerts:laptops:dry-run
```

## Key implementation files

- `.github/workflows/laptop-alerts.yml` — twice-daily orchestration and fresh-data deployment guard
- `src/laptop/best-buy.ts` — hard gates, work-power formula, work-value and Pareto logic
- `src/laptop/benchmark-evidence.ts` — benchmark provenance and validation
- `src/laptop/snapshot.ts` — current/historical result state
- `src/laptop/telegram.ts` — alert copy and Telegram delivery
- `src/laptop/dashboard.ts` — dashboard filtering, labels and chart model
- `scripts/collect-laptops.ts` — eBay collection
- `scripts/enrich-laptops-ai.ts` — evidence extraction and cache
- `scripts/refresh-benchmark-evidence.ts` — benchmark refresh
- `scripts/send-laptop-alerts.ts` — dry-run/real alert entry point
- `scripts/verify-laptop-dataset.ts` — release dataset integrity checks
- `public/data/laptop-listings.json` — deployed static dataset
- `data/laptop-benchmark-evidence.json` — benchmark evidence
- `data/laptop-alert-state.json` — alert de-duplication state

## Where to find more options

The right expansion is a multi-source collector with a common evidence schema, not a large pile of brittle scrapers. Prefer an authorised API or product feed when one exists; for public catalogue pages, review the site's current terms and robots policy, rate-limit requests, cache responses and never bypass login or anti-bot controls.

### Priority 1 — implement first

1. **EuroPC** — highest immediate fit for this search. Its live catalogue includes certified refurbished gaming laptops and mobile workstations, and on 22 July it showed a 64 GB, 2 TB, RTX 5070 Ti Acer. Specs and prices are unusually structured. Start here with a public-catalogue adapter, while checking for an approved feed first. [EuroPC refurbished gaming laptops](https://www.europc.co.uk/gaming-laptops)

2. **Awin product feeds** — best route to broad retailer coverage without writing one scraper per shop. Awin provides configurable CSV product feeds and feed-list download URLs to approved publishers. Retailer availability depends on which advertiser programmes approve the account; never assume a named retailer is included until confirmed. [Awin product-feed access](https://success.awin.com/articles/en_US/Knowledge/How-can-I-access-a-Product-Feed)

3. **Dell Outlet and Lenovo Certified Refurbished** — strong sources for Precision/Pro Max and ThinkPad P-series mobile workstations. These are especially relevant to local compute even when they are not marketed as gaming machines. Dell advertises limited stock, same-as-new warranty and certified/scratch-and-dent grades; Lenovo advertises certified refurbishment and a one-year warranty. [Dell Outlet](https://www.dell.com/en-uk/dfh/lp/outlet) · [Lenovo Certified Refurbished laptops](https://www.lenovo.com/gb/outletgb/en/laptops/)

4. **Laptops Direct** — a large, parseable refurbished catalogue with exact CPU, RAM and storage fields. It is likely to add breadth quickly. [Laptops Direct refurbished laptops](https://www.laptopsdirect.co.uk/st/refurbished-laptops)

### Priority 2 — valuable after the common adapter is proven

5. **Currys Refurbished** — broad inventory, explicit condition grades and a 12-month technical guarantee. Most stock is below the 64 GB floor, but occasional high-end/open-box machines are worth catching. [Currys refurbished laptops](https://www.currys.co.uk/computing/laptops/refurbished-laptops)

6. **Cash Converters** — many local-store listings and some genuine one-off bargains. Titles often contain CPU, RAM, storage and GPU, but quality is inconsistent and pickup-only items need a visible tag. The user's ranking must still ignore postage. [Cash Converters laptops](https://www.cashconverters.co.uk/shop/phones-cameras--computers/tablets--laptops/laptops/laptop)

7. **CeX** — useful national used inventory and relatively standardised condition/warranty handling, but catalogue pages are JavaScript-heavy and specification precision needs careful validation. Prefer a permitted feed/API if one can be obtained; otherwise treat this as a later adapter.

8. **Scan Today Only / B-grade**, **Tier1 Online**, **Bargain Hardware** and **Back Market** — useful secondary pools. Scan's offers change quickly; Tier1 and Bargain Hardware skew toward older business hardware; Back Market is broad but seller/spec normalisation is required. [Scan Today Only](https://www.scan.co.uk/todayonly) · [Tier1 Online](https://tier1online.com/) · [Bargain Hardware](https://www.bargainhardware.co.uk/) · [Back Market laptops](https://www.backmarket.co.uk/en-gb/l/notebook-and-laptop/240123e2-0a1d-452b-aff3-9ed640cf464d)

### Conditional source

9. **Amazon UK** — do not scrape Amazon pages. The old Product Advertising API was deprecated on 15 May 2026. The replacement Creators API provides catalogue search, but requires Amazon Associates enrolment and currently states a threshold of 10 qualifying sales in the previous 30 days. It is therefore a later, authorised integration rather than an immediate source. [Amazon Creators API](https://affiliate-program.amazon.com/creatorsapi/docs/)

### Defer initially

- Facebook Marketplace, Gumtree and similar classifieds: more listings, but weak specifications, duplication, scams, local-pickup friction, login dependence and fragile anti-automation controls. They would create far more manual review than high-confidence recommendations.
- General auctions such as John Pye/BidSpotter: potentially cheap, but buyer premiums, VAT treatment, collection charges, uncertain condition and limited returns make the visible bid price misleading. They need a separate all-in-cost and risk model, which conflicts with the deliberately simple base-price ranking.
- musicMagpie: trustworthy refurbishment, but its computer inventory is strongly Apple-oriented and is unlikely to yield many Windows machines meeting this exact 64 GB/CPU/GPU floor.

## Recommended expansion design

Do not put source-specific logic into the scoring engine. Each source adapter should emit the same canonical record:

```text
source + stable source ID + URL
title + manufacturer + model
advertised item price
condition + seller/retailer identity
CPU exact model + evidence
RAM as sold + evidence
storage as sold + evidence
GPU exact model + evidence
availability timestamp
optional warranty, pickup-only and confidence tags
```

Then run every record through the existing evidence, hard-gate and value pipeline.

Cross-source requirements:

- de-duplicate the same physical listing and identify equivalent model/configurations;
- preserve raw evidence and retrieval time for auditability;
- assign source-specific confidence, but do not silently change performance scores by source;
- show warranty, condition, pickup-only and seller quality as decision tags, not hidden score weights;
- retain base-price ranking exactly as requested;
- quarantine ambiguous configurable products until the selected 64 GB/1 TB configuration and its exact price are known;
- allow a retailer's selectable 64 GB configuration, but rank the actual configured price—not the cheaper 16/32 GB headline price;
- detect price drops and newly non-dominated deals, so Telegram reports meaningful opportunities rather than merely more rows.

The recommended first implementation slice is **EuroPC + one Awin feed-backed retailer**, followed by Dell/Lenovo outlet adapters. This tests both direct-catalogue and structured-feed ingestion while targeting sources most likely to produce powerful 64 GB laptops.

## Open follow-ups

1. Rotate the exposed Telegram bot token and replace the GitHub secret.
2. Confirm that the next fresh scheduled eBay run collects successfully after quota reset and sends only a meaningful Telegram update.
3. Perform browser screenshot QA when an interactive browser is available.
4. Before adding sources, agree the short multi-source design and test fixtures. The expansion should not weaken the existing hard gates or audit trail.
5. Consider recording price history and price-drop alerts after multi-source de-duplication exists.

## Commit history for the completed system

- `a9683dc` — pure best-buy model
- `496c8ca` — benchmark evidence
- `8cd2f2c` — snapshot history
- `a02d002` — Telegram delivery
- `12a82cc` — dashboard
- `e5a4921` — schedule
- `e38b42a` — documentation
- `5953bf6` — release fixes and live data
- `22446b6` — Telegram smoke-test state

The system is live and safe to leave running. The next context should begin by checking tomorrow's workflow run, not by rebuilding the implementation.
