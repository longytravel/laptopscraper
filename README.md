# Laptop Power Finder

An evidence-first dashboard for finding powerful laptops currently available on eBay UK. It compares listing price against normalized CPU/GPU power, highlights exact price-power Pareto picks, and keeps postage, seller, returns, condition, and specification uncertainty visible.

The reference machine is an ASUS ROG Strix G16 with an Intel Core i9-14900HX, RTX 4060 Laptop GPU, and 64 GB RAM. Its CPU, GPU, and combined power scores are each normalized to `100`; its reference price is £1,170.

## What it does

- Collects current listings through the official eBay Browse API—no HTML scraping.
- Searches high-performance gaming and mobile-workstation families up to £3,000.
- Deduplicates overlapping searches and enriches listings through the eBay item endpoint.
- Extracts CPU, GPU, RAM, storage, display, seller, returns, and buying-option evidence.
- Plots exact delivered prices as filled dots and item-price lower bounds as hollow dots when postage is unknown.
- Colours points by value relative to the current G16 and keeps lower-bound points out of the exact Pareto frontier.
- Separates “postage unknown” from incomplete CPU/GPU specifications instead of presenting known item prices as unavailable.
- Saves a local shortlist with a side-by-side comparison and direct eBay links.

## Power and value model

CPU and GPU indices are versioned in `src/laptop/benchmarks.ts`, with source metadata and derivation notes. Scores are normalized against the current machine:

```text
cpuPower = 100 × candidateCpuIndex / i9-14900HX index
gpuPower = 100 × candidateGpuIndex / RTX 4060 Laptop index
combinedPower = 100 × (cpuPower / 100)^cpuWeight × (gpuPower / 100)^(1-cpuWeight)
```

The dashboard opens with the whole scored market visible so the chart has enough context to reveal value. The G16 reference lines mark power 100 and £1,170; sliders can then narrow the field to a 64 GB, at-least-100 replacement. CPU/GPU weighting starts at 60% / 40% because build, Python, and backtesting workloads are CPU-heavy. Laptop TGP, firmware, cooling, and sustained thermal behaviour can differ even for the same model name, so power remains explicitly labelled as an estimate.

The G16’s equal-value line is based on power `100` at £1,170. Lower-bound item prices can show a *possible* value opportunity, but unknown postage is never treated as free.

## Optional GPT-5.6 Luna enrichment

`npm run enrich:laptops:ai` reads every listing with `gpt-5.6-luna` at medium reasoning effort and uses Structured Outputs to recover explicit specification and risk evidence that deterministic parsing missed.

Safety and cost controls:

- the deterministic parser, benchmark catalogue, exclusions, price arithmetic, and recommendation score remain authoritative;
- every accepted AI claim needs an exact evidence substring from the listing;
- existing deterministic fields are not silently overwritten;
- unchanged listings are cached by a SHA-256 content fingerprint under ignored `.cache/`;
- the command checkpoints after every successful response;
- the browser never receives the API key and never calls OpenAI;
- ordinary builds are offline and incur no model cost.

## Local setup

Requirements: Node.js 24+, eBay production Browse API credentials, and an OpenAI API key only if AI enrichment is wanted.

```powershell
npm install
Copy-Item .env.example .env
```

Set values in the ignored `.env` file:

```dotenv
EBAY_CLIENT_ID=your-client-id
EBAY_CLIENT_SECRET=your-client-secret
EBAY_MARKETPLACE_ID=EBAY_GB
EBAY_DELIVERY_POSTCODE=your-uk-postcode
EBAY_LAPTOP_LIMIT_PER_SEARCH=80
EBAY_LAPTOP_DETAIL_LIMIT=320
OPENAI_API_KEY=your-server-side-key
```

Refresh and enrich the static dataset, then start the app:

```powershell
npm run collect:laptops
npm run enrich:laptops:ai
npm run dev
```

Or run the complete verified refresh pipeline:

```powershell
npm run refresh:laptops
```

The collector and AI command write `public/data/laptop-listings.json` atomically. Missing postage remains unknown and is rendered as an item-price lower bound.

## Verification

```powershell
npm test
npm run lint
npm run build
```

Tests cover parsing, exclusions, uncertainty, benchmark normalization, power weighting, chart price certainty, readiness states, value wording, Pareto calculation, shortlist storage, eBay requests, Luna request configuration, evidence validation, deterministic merge precedence, caching, and partial failures.

## Vercel

`vercel.json` runs the offline `npm run build` command and deploys the already-generated static dataset. Refresh and verify the dataset locally before deployment. This prevents repeated eBay/OpenAI calls and surprise model spend on rebuilds.

The OpenAI key is not required in Vercel. The eBay credentials are needed locally only when refreshing data.

## Buying-safety boundary

The dashboard reports observable listing evidence; it does not certify a laptop as safe. Verify the exact model, GPU TGP, RAM upgrade path, charger, serial/warranty status, postage, and return terms with the seller before purchase.
