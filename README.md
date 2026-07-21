# Laptop Power Finder

An API-backed decision dashboard for finding powerful laptops currently available on eBay UK. It compares delivered price against normalized CPU/GPU power, highlights the price-power Pareto frontier, and keeps seller, returns, condition and specification uncertainty visible.

The reference machine is an ASUS ROG Strix G16 with an Intel Core i9-14900HX, RTX 4060 Laptop GPU and 64 GB RAM. Its CPU, GPU and combined power scores are each normalized to `100`.

## What it does

- Collects current listings through the official eBay Browse API—no HTML scraping.
- Searches high-performance gaming and mobile-workstation families up to £3,000 delivered.
- Deduplicates overlapping searches and enriches listings through the eBay item endpoint.
- Extracts CPU, GPU, RAM, storage, display, seller, returns and buying-option evidence.
- Keeps unknown or conflicting specifications out of the precise power graph.
- Offers coordinated sliders and filters for price, power, CPU/GPU priority, RAM, VRAM, storage, display, seller quality, condition, returns, location and risk.
- Draws the Pareto frontier so dominated listings are easy to spot.
- Saves a local shortlist with a side-by-side comparison and links directly to the original eBay listing.

## Power model

CPU and GPU model indices are versioned in `src/laptop/benchmarks.ts`, including source URL, observation date, metric and estimation method for every entry. The representative PassMark CPU Mark/G3D class indices are normalized against the current machine:

```text
cpuPower = 100 × candidateCpuIndex / i9-14900HX index
gpuPower = 100 × candidateGpuIndex / RTX 4060 Laptop index
combinedPower = 100 × (cpuPower / 100)^cpuWeight × (gpuPower / 100)^(1-cpuWeight)
```

The dashboard defaults to 60% CPU / 40% GPU because build, Python and backtesting workloads are CPU-heavy. The weighting is adjustable from 20% to 90% CPU. Model names cannot capture laptop TGP, firmware, cooling or sustained thermal behavior, so the dashboard explicitly labels power as an estimate.

## Local setup

Requirements: Node.js 24+ and eBay production Browse API credentials.

```powershell
npm install
Copy-Item .env.example .env
```

Set these values in the ignored `.env` file:

```dotenv
EBAY_CLIENT_ID=your-client-id
EBAY_CLIENT_SECRET=your-client-secret
EBAY_MARKETPLACE_ID=EBAY_GB
EBAY_DELIVERY_POSTCODE=your-uk-postcode
EBAY_LAPTOP_LIMIT_PER_SEARCH=80
EBAY_LAPTOP_DETAIL_LIMIT=320
```

Collect live data and start the app:

```powershell
npm run collect:laptops
npm run dev
```

The collector writes `public/data/laptop-listings.json` atomically. The dashboard always displays its generation time.
If `EBAY_DELIVERY_POSTCODE` is omitted or eBay does not quote postage, delivered price remains unknown and the listing stays off the price/power graph. A recent committed snapshot can keep a Vercel build available during a temporary eBay outage or rate limit; credential failures still fail the build.

## Verification

```powershell
npm test
npm run lint
npm run build
```

Tests cover parsing, exclusions, uncertainty, benchmark normalization, power weighting, coordinated filters, Pareto calculation, shortlist storage, eBay request filters, retry behavior and deduplication.

## Vercel

`vercel.json` runs `npm run build:live`, so every production deployment refreshes the eBay dataset before building the static Vite app. Configure these encrypted project variables in Vercel:

- `EBAY_CLIENT_ID`
- `EBAY_CLIENT_SECRET`
- `EBAY_MARKETPLACE_ID`
- `EBAY_DELIVERY_POSTCODE` (optional, recommended for accurate postage)
- `EBAY_LAPTOP_LIMIT_PER_SEARCH` (optional)
- `EBAY_LAPTOP_DETAIL_LIMIT` (optional)

Credentials are used only during the server-side build and are never shipped to the browser bundle.

## Buying-safety boundary

The dashboard reports observable listing evidence; it does not certify a laptop as safe. Verify the exact model, GPU TGP, RAM upgrade path, charger, serial/warranty status and return terms with the seller before purchase.
