from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from statistics import mean, median

from pipeline.models import Listing, SoldComp
from pipeline.scoring.valuation import percentile


@dataclass(frozen=True, slots=True)
class SalesTrend:
    search_term: str
    period_start: datetime
    period_end: datetime
    sold_count: int
    median_sold_price: float
    average_sold_price: float
    low_sold_price: float
    high_sold_price: float
    price_momentum_percent: float
    sell_through_proxy: float
    confidence: str


def calculate_sales_trend(
    search_term: str,
    sold_comps: list[SoldComp],
    active_listings: list[Listing],
    lookback_days: int = 90,
) -> SalesTrend:
    now = datetime.now(UTC)
    period_start = now - timedelta(days=lookback_days)
    relevant = [
        comp
        for comp in sold_comps
        if comp.sold_date is None or comp.sold_date >= period_start
    ]
    values = [comp.sold_price + comp.shipping_price for comp in relevant]
    recent_values = [
        comp.sold_price + comp.shipping_price
        for comp in relevant
        if comp.sold_date is None or comp.sold_date >= now - timedelta(days=30)
    ]
    older_values = [
        comp.sold_price + comp.shipping_price
        for comp in relevant
        if comp.sold_date is not None and comp.sold_date < now - timedelta(days=30)
    ]

    recent_median = median(recent_values) if recent_values else 0
    older_median = median(older_values) if older_values else recent_median
    momentum = 0 if not older_median else ((recent_median - older_median) / older_median) * 100
    active_count = max(len(active_listings), 1)
    sell_through = len(relevant) / active_count
    confidence = "high" if len(relevant) >= 12 else "medium" if len(relevant) >= 6 else "low"

    return SalesTrend(
        search_term=search_term,
        period_start=period_start,
        period_end=now,
        sold_count=len(relevant),
        median_sold_price=round(median(values), 2) if values else 0,
        average_sold_price=round(mean(values), 2) if values else 0,
        low_sold_price=round(percentile(values, 0.25), 2) if values else 0,
        high_sold_price=round(percentile(values, 0.75), 2) if values else 0,
        price_momentum_percent=round(momentum, 1),
        sell_through_proxy=round(sell_through, 2),
        confidence=confidence,
    )
