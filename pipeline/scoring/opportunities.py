from __future__ import annotations

from pipeline.models import ItemIdentity, Listing, OpportunityScore, SoldComp
from pipeline.scoring.profit import CostAssumptions, expected_profit
from pipeline.scoring.valuation import matched_comps, valuation_from_comps


def score_listing(
    listing: Listing,
    identity: ItemIdentity,
    comps: list[SoldComp],
    min_profit: float = 20,
    min_roi: float = 20,
    costs: CostAssumptions = CostAssumptions(),
) -> OpportunityScore:
    matches = matched_comps(identity, comps)
    market_value, low_value, high_value, comp_confidence = valuation_from_comps(matches)
    profit, roi = expected_profit(market_value, listing.price, listing.shipping_price, costs)
    severe_risk = any(flag in identity.risk_flags for flag in ["fungus", "haze", "untested", "faulty"])
    confidence = min([identity.confidence, comp_confidence], key=["low", "medium", "high"].index)

    risk_penalty = 30 if severe_risk else min(len(identity.risk_flags) * 6, 24)
    profit_score = min(max(int(profit), 0), 50)
    roi_score = min(max(int(roi), 0), 30)
    confidence_score = {"high": 18, "medium": 10, "low": 0}[confidence]
    liquidity_score = min(len(matches), 12)
    buy_score = max(0, min(100, profit_score + roi_score + confidence_score + liquidity_score - risk_penalty))

    if profit >= 40 and roi >= 30 and confidence in {"high", "medium"} and not severe_risk:
        decision = "Strong buy"
    elif profit >= min_profit and roi >= min_roi and confidence == "medium" and not severe_risk:
        decision = "Watch"
    else:
        decision = "Avoid"

    warnings = identity.risk_flags.copy()
    if len(matches) < 4:
        warnings.append("low comp count")
    if listing.excluded_reason:
        warnings.append(listing.excluded_reason)

    return OpportunityScore(
        listing_id=listing.source_listing_id,
        market_value=market_value,
        low_value=low_value,
        high_value=high_value,
        comp_count=len(matches),
        confidence=confidence,
        expected_profit=profit,
        roi_percent=roi,
        buy_score=buy_score,
        decision=decision,
        warnings=warnings,
    )
