from pipeline.scoring.profit import CostAssumptions, expected_profit


def test_expected_profit_for_canon_example():
    profit, roi = expected_profit(
        market_value=80,
        listing_price=40,
        inbound_shipping=0,
        costs=CostAssumptions(),
    )

    assert profit == 23.06
    assert roi == 57.6
