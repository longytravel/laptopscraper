from datetime import UTC, datetime, timedelta

from pipeline.models import Listing, SoldComp
from pipeline.scoring.trends import calculate_sales_trend


def sold(title: str, price: float, days_ago: int) -> SoldComp:
    return SoldComp(
        source="ebay",
        sold_item_id=title,
        sold_url="https://example.com",
        title=title,
        description="",
        sold_price=price,
        shipping_price=0,
        currency="GBP",
        condition="Used",
        sold_date=datetime.now(UTC) - timedelta(days=days_ago),
        image_urls=[],
        raw_payload={},
    )


def active(item_id: str) -> Listing:
    return Listing(
        source="ebay",
        source_listing_id=item_id,
        listing_url="https://example.com",
        title="Canon EF 50mm f/1.8 STM",
        description="",
        price=40,
        shipping_price=0,
        currency="GBP",
        condition="Used",
        seller_name="seller",
        seller_feedback_score=None,
        seller_feedback_percent=None,
        location="UK",
        category="Camera Lenses",
        image_urls=[],
        listed_at=None,
        scraped_at=datetime.now(UTC),
        listing_status="active",
        raw_payload={},
    )


def test_sales_trend_tracks_momentum_and_sell_through():
    trend = calculate_sales_trend(
        "Canon EF 50mm f/1.8 STM",
        [sold("recent", 90, 5), sold("recent 2", 100, 10), sold("older", 80, 60), sold("older 2", 70, 70)],
        [active("a1"), active("a2")],
    )

    assert trend.sold_count == 4
    assert trend.sell_through_proxy == 2
    assert trend.price_momentum_percent > 0
