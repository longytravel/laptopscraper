from __future__ import annotations

from statistics import median

from pipeline.models import ItemIdentity, SoldComp


def percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0
    values = sorted(values)
    index = (len(values) - 1) * pct
    lower = int(index)
    upper = min(lower + 1, len(values) - 1)
    if lower == upper:
        return values[lower]
    fraction = index - lower
    return values[lower] + (values[upper] - values[lower]) * fraction


def matched_comps(identity: ItemIdentity, comps: list[SoldComp]) -> list[SoldComp]:
    matches: list[SoldComp] = []
    for comp in comps:
        title = comp.title.lower()
        if identity.brand.lower() not in title:
            continue
        if identity.focal_length.lower() not in title.replace(" ", ""):
            continue
        if identity.aperture != "unknown" and identity.aperture.replace("/", "") not in title.replace("/", ""):
            continue
        if any(term in title for term in ["cap", "adapter", "filter", "for parts", "faulty", "spares"]):
            continue
        matches.append(comp)
    return matches


def valuation_from_comps(comps: list[SoldComp]) -> tuple[float, float, float, str]:
    values = [comp.sold_price + comp.shipping_price for comp in comps]
    if not values:
        return 0, 0, 0, "low"
    confidence = "high" if len(values) >= 8 else "medium" if len(values) >= 4 else "low"
    return round(median(values), 2), round(percentile(values, 0.25), 2), round(percentile(values, 0.75), 2), confidence
