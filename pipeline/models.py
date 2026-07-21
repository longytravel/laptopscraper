from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal


Confidence = Literal["high", "medium", "low"]
Decision = Literal["Strong buy", "Watch", "Avoid"]


@dataclass(slots=True)
class Listing:
    source: str
    source_listing_id: str
    listing_url: str
    title: str
    description: str
    price: float
    shipping_price: float
    currency: str
    condition: str
    seller_name: str
    seller_feedback_score: int | None
    seller_feedback_percent: float | None
    location: str
    category: str
    image_urls: list[str]
    listed_at: datetime | None
    scraped_at: datetime
    listing_status: str
    raw_payload: dict[str, Any]
    excluded: bool = False
    excluded_reason: str | None = None


@dataclass(slots=True)
class SoldComp:
    source: str
    sold_item_id: str
    sold_url: str
    title: str
    description: str
    sold_price: float
    shipping_price: float
    currency: str
    condition: str
    sold_date: datetime | None
    image_urls: list[str]
    raw_payload: dict[str, Any]


@dataclass(slots=True)
class ItemIdentity:
    brand: str
    lens_model: str
    mount: str
    focal_length: str
    aperture: str
    stabilization: bool | None = None
    autofocus: bool | None = None
    version: str | None = None
    condition_grade: str = "unknown"
    included_accessories: list[str] = field(default_factory=list)
    box_included: bool = False
    caps_included: bool = False
    hood_included: bool = False
    damage_flags: list[str] = field(default_factory=list)
    risk_flags: list[str] = field(default_factory=list)
    confidence: Confidence = "low"


@dataclass(slots=True)
class OpportunityScore:
    listing_id: str
    market_value: float
    low_value: float
    high_value: float
    comp_count: int
    confidence: Confidence
    expected_profit: float
    roi_percent: float
    buy_score: int
    decision: Decision
    warnings: list[str]
