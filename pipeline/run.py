from __future__ import annotations

import argparse
import asyncio

from dotenv import load_dotenv

from pipeline.ai.lens_parser import normalize_lens_title
from pipeline.collectors.ebay import EbayBrowseCollector, UnavailableSoldCompCollector
from pipeline.config import load_config


async def collect() -> None:
    load_dotenv()
    config = load_config()
    active_collector = EbayBrowseCollector(marketplace_id=config["sources"]["ebay"]["marketplace_id"])
    sold_collector = UnavailableSoldCompCollector()
    limit = config["sources"]["ebay"]["active_limit_per_search"]
    lookback_days = config["sources"]["ebay"]["sold_lookback_days"]

    for search_term in config["searches"]:
        listings = await active_collector.collect_active(search_term, limit)
        comps = await sold_collector.collect_sold_comps(search_term, lookback_days)
        print(f"{search_term}: {len(listings)} active listings, {len(comps)} sold comps")
        for listing in listings[:3]:
            identity = normalize_lens_title(listing.title, listing.description)
            print(f"  - {identity.brand} | {identity.lens_model} | excluded={listing.excluded}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Run resale arbitrage pipeline tasks.")
    parser.add_argument("command", choices=["collect"])
    args = parser.parse_args()
    if args.command == "collect":
        asyncio.run(collect())


if __name__ == "__main__":
    main()
