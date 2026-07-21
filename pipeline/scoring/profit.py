from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class CostAssumptions:
    platform_fee_percent: float = 12.8
    payment_fee_percent: float = 0
    fixed_fee: float = 0.30
    postage_out: float = 5.00
    packaging: float = 1.00
    cleaning_or_prep: float = 3.00
    risk_buffer_percent: float = 8


def expected_profit(
    market_value: float,
    listing_price: float,
    inbound_shipping: float,
    costs: CostAssumptions = CostAssumptions(),
) -> tuple[float, float]:
    total_buy_cost = listing_price + inbound_shipping
    percentage_fees = market_value * ((costs.platform_fee_percent + costs.payment_fee_percent) / 100)
    risk_buffer = market_value * (costs.risk_buffer_percent / 100)
    profit = (
        market_value
        - total_buy_cost
        - percentage_fees
        - costs.fixed_fee
        - costs.postage_out
        - costs.packaging
        - costs.cleaning_or_prep
        - risk_buffer
    )
    roi_percent = 0 if total_buy_cost <= 0 else (profit / total_buy_cost) * 100
    return round(profit, 2), round(roi_percent, 1)
