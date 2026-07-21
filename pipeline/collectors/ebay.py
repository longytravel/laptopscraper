from __future__ import annotations

import base64
import os
from datetime import UTC, datetime
from typing import Any

import httpx

from pipeline.collectors.base import ActiveListingCollector, SoldCompCollector
from pipeline.filters import exclusion_reason
from pipeline.models import Listing, SoldComp


class EbayAuthError(RuntimeError):
    pass


class EbayBrowseCollector(ActiveListingCollector):
    """Official eBay Browse API collector for active listings.

    eBay Browse exposes item_summary search at /buy/browse/v1/item_summary/search.
    Requests need an OAuth app token and an X-EBAY-C-MARKETPLACE-ID header.
    """

    token_url = "https://api.ebay.com/identity/v1/oauth2/token"
    search_url = "https://api.ebay.com/buy/browse/v1/item_summary/search"

    def __init__(
        self,
        client_id: str | None = None,
        client_secret: str | None = None,
        marketplace_id: str = "EBAY_GB",
    ) -> None:
        self.client_id = client_id or os.getenv("EBAY_CLIENT_ID")
        self.client_secret = client_secret or os.getenv("EBAY_CLIENT_SECRET")
        self.marketplace_id = marketplace_id or os.getenv("EBAY_MARKETPLACE_ID", "EBAY_GB")
        self._access_token: str | None = None

    async def collect_active(self, search_term: str, limit: int = 50) -> list[Listing]:
        token = await self._token()
        params = {
            "q": search_term,
            "limit": min(limit, 200),
            "filter": "conditions:{USED},priceCurrency:GBP",
            "fieldgroups": "EXTENDED",
        }
        headers = {
            "Authorization": f"Bearer {token}",
            "X-EBAY-C-MARKETPLACE-ID": self.marketplace_id,
        }
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(self.search_url, params=params, headers=headers)
            response.raise_for_status()
        payload = response.json()
        return [self._map_item(item) for item in payload.get("itemSummaries", [])]

    async def _token(self) -> str:
        if self._access_token:
            return self._access_token
        if not self.client_id or not self.client_secret:
            raise EbayAuthError("Set EBAY_CLIENT_ID and EBAY_CLIENT_SECRET in .env before running eBay collection.")

        credentials = base64.b64encode(f"{self.client_id}:{self.client_secret}".encode()).decode()
        headers = {
            "Authorization": f"Basic {credentials}",
            "Content-Type": "application/x-www-form-urlencoded",
        }
        data = {
            "grant_type": "client_credentials",
            "scope": "https://api.ebay.com/oauth/api_scope",
        }
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(self.token_url, data=data, headers=headers)
            response.raise_for_status()
        self._access_token = response.json()["access_token"]
        return self._access_token

    def _map_item(self, item: dict[str, Any]) -> Listing:
        price = float(item.get("price", {}).get("value", 0))
        shipping = _shipping(item)
        title = item.get("title", "")
        description = item.get("shortDescription", "")
        reason = exclusion_reason(f"{title} {description}")
        seller = item.get("seller", {})
        location = item.get("itemLocation", {})
        image = item.get("image", {})
        additional_images = item.get("additionalImages", [])
        image_urls = [url for url in [image.get("imageUrl"), *[img.get("imageUrl") for img in additional_images]] if url]

        return Listing(
            source="ebay",
            source_listing_id=item.get("itemId", ""),
            listing_url=item.get("itemWebUrl", ""),
            title=title,
            description=description,
            price=price,
            shipping_price=shipping,
            currency=item.get("price", {}).get("currency", "GBP"),
            condition=item.get("condition", ""),
            seller_name=seller.get("username", ""),
            seller_feedback_score=seller.get("feedbackScore"),
            seller_feedback_percent=_float_or_none(seller.get("feedbackPercentage")),
            location=", ".join(filter(None, [location.get("city"), location.get("country")])),
            category=item.get("categories", [{}])[0].get("categoryName", ""),
            image_urls=image_urls,
            listed_at=_parse_date(item.get("itemCreationDate")),
            scraped_at=datetime.now(UTC),
            listing_status="active",
            raw_payload=item,
            excluded=reason is not None,
            excluded_reason=reason,
        )


class UnavailableSoldCompCollector(SoldCompCollector):
    """Placeholder until Marketplace Insights access is approved."""

    async def collect_sold_comps(self, search_term: str, lookback_days: int = 90) -> list[SoldComp]:
        return []


def _shipping(item: dict[str, Any]) -> float:
    options = item.get("shippingOptions") or []
    if not options:
        return 0
    cost = options[0].get("shippingCost") or {}
    return float(cost.get("value", 0))


def _float_or_none(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))
