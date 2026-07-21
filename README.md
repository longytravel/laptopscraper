# Camera Lens Resale Arbitrage Scanner

Local MVP for finding underpriced used camera lenses, valuing them from sold comparable data, and ranking resale opportunities after fees, postage, prep, and risk buffers.

## Current Shape

- React/Vite dashboard with ranked opportunities, scatter graph, listing review panel, search config, sold trend panel, and run history.
- Python pipeline modules for eBay active listing collection, sold comp abstraction, SQLite schema, title normalization, risk phrase detection, valuation, profit scoring, and sales trend calculation.
- Official eBay Browse API collector is implemented for active listings. Sold comps are behind an interface because Marketplace Insights access is account-dependent.
- AI extraction module is scaffolded with structured JSON output and content hashing for cache keys.

## Setup

```powershell
npm install
npm run dev
```

Open the local URL printed by Vite.

Python is not installed in this Windows environment right now. Once installed:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m pipeline.run collect
uvicorn pipeline.api:app --reload
pytest
```

## Credentials

Copy `.env.example` to `.env` and add secrets there. Do not commit `.env`.

```ini
EBAY_CLIENT_ID=
EBAY_CLIENT_SECRET=
EBAY_MARKETPLACE_ID=EBAY_GB
OPENAI_API_KEY=
```

If a production eBay client secret has been pasted into any chat, ticket, or shared log, rotate/reset it in the eBay developer portal before using it.

## Config

Non-secret settings live in `config.yaml`:

- UK/GBP marketplace defaults.
- Ten starter lens searches.
- Max buy price and minimum profit/ROI.
- Fee, postage, prep, packaging, and risk buffer assumptions.

## Pipeline

Primary flow:

```text
collect active listings -> collect sold comps -> normalize identity -> value from comps -> score -> review in dashboard
```

Implemented modules:

- `pipeline/collectors/ebay.py`: eBay Browse API active listing collector.
- `pipeline/collectors/base.py`: active listing and sold comp interfaces.
- `pipeline/ai/lens_parser.py`: deterministic v1 lens title parser and risk/accessory extraction.
- `pipeline/ai/openai_extractor.py`: OpenAI structured extraction scaffold.
- `pipeline/scoring/valuation.py`: comparable filtering and median/IQR valuation.
- `pipeline/scoring/profit.py`: fee, postage, prep, risk buffer, profit and ROI math.
- `pipeline/scoring/opportunities.py`: buy score and decision labels.
- `pipeline/scoring/trends.py`: sold volume, price momentum, and sell-through proxy.
- `pipeline/db/schema.sql`: local SQLite tables.

## eBay API Notes

The active listing collector uses eBay Browse item summary search at:

```text
https://api.ebay.com/buy/browse/v1/item_summary/search
```

It requests an OAuth app token with client credentials and sends `X-EBAY-C-MARKETPLACE-ID: EBAY_GB`. The Browse docs describe keyword search, field groups such as `EXTENDED`, filters, and marketplace headers.

Marketplace Insights/Product Research access varies by account approval. The code keeps sold comps abstract so a Marketplace Insights implementation, imported CSV, or later scraper can feed the same `SoldComp` shape.

## V1 Gaps

- Persistence writers are not wired yet; schema and models are ready.
- Sold comp collector is a placeholder until Marketplace Insights access is available or another compliant source is chosen.
- Dashboard currently uses representative seed data rather than live API data.
- Python tests cannot be run in this session until Python is installed.
