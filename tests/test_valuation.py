from datetime import UTC, datetime

from pipeline.ai.lens_parser import normalize_lens_title
from pipeline.models import SoldComp
from pipeline.scoring.valuation import matched_comps, valuation_from_comps


def comp(title: str, price: float) -> SoldComp:
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
        sold_date=datetime.now(UTC),
        image_urls=[],
        raw_payload={},
    )


def test_excludes_accessory_and_wrong_mount_comps():
    identity = normalize_lens_title("Canon EF 50mm f/1.8 STM")
    comps = [
        comp("Canon EF 50mm f1.8 STM lens", 80),
        comp("Canon EF 50mm lens cap only", 10),
        comp("Sony FE 50mm f1.8 lens", 120),
    ]

    matches = matched_comps(identity, comps)

    assert len(matches) == 1
    assert matches[0].sold_price == 80


def test_valuation_uses_median_and_confidence():
    market, low, high, confidence = valuation_from_comps([comp("Canon EF 50mm f1.8 STM lens", price) for price in [70, 80, 90, 100]])

    assert market == 85
    assert low == 77.5
    assert high == 92.5
    assert confidence == "medium"
