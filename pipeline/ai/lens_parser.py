from __future__ import annotations

import re

from pipeline.filters import risk_flags
from pipeline.models import ItemIdentity


BRANDS = {
    "canon": ("Canon", "Canon EF"),
    "sony": ("Sony", "Sony E"),
    "fujifilm": ("Fujifilm", "Fujifilm X"),
    "fuji": ("Fujifilm", "Fujifilm X"),
    "nikon": ("Nikon", "Nikon F"),
    "sigma": ("Sigma", "Unknown"),
    "tamron": ("Tamron", "Unknown"),
}


MOUNT_PATTERNS = [
    (r"\bcanon\s+rf\b|\brf\b", "Canon RF"),
    (r"\bcanon\s+ef\b|\bef\b", "Canon EF"),
    (r"\bsony\s+(fe|e)\b|\bsony e\b", "Sony E"),
    (r"\bfuji(film)?\s+x\b|\bxf\b", "Fujifilm X"),
    (r"\bnikon\s+z\b|\bz mount\b", "Nikon Z"),
    (r"\bnikon\s+f\b|\baf-s\b", "Nikon F"),
]


def normalize_lens_title(title: str, description: str = "") -> ItemIdentity:
    text = f"{title} {description}".lower()
    brand, default_mount = _brand_and_mount(text)
    mount = _mount(text, default_mount)
    focal_length = _first_match(text, r"(\d{2,3}(?:-\d{2,3})?\s?mm)") or "unknown"
    aperture = _first_match(text, r"f/?\s?(\d(?:\.\d)?)")
    aperture = f"f/{aperture}" if aperture else "unknown"
    model = _model_name(title, brand, focal_length, aperture)
    accessories = _accessories(text)
    flags = risk_flags(text)

    confidence = "medium" if brand != "Unknown" and focal_length != "unknown" and aperture != "unknown" else "low"
    if mount != "Unknown" and model != "unknown":
        confidence = "high"

    return ItemIdentity(
        brand=brand,
        lens_model=model,
        mount=mount,
        focal_length=focal_length.replace(" ", ""),
        aperture=aperture,
        autofocus="manual focus" not in text,
        condition_grade=_condition(text, flags),
        included_accessories=accessories,
        box_included="box" in accessories,
        caps_included="front cap" in accessories and "rear cap" in accessories,
        hood_included="hood" in accessories,
        risk_flags=flags,
        damage_flags=[flag for flag in flags if flag in {"fungus", "haze", "scratch", "scratches"}],
        confidence=confidence,
    )


def _brand_and_mount(text: str) -> tuple[str, str]:
    for token, value in BRANDS.items():
        if token in text:
            return value
    return "Unknown", "Unknown"


def _mount(text: str, default: str) -> str:
    for pattern, mount in MOUNT_PATTERNS:
        if re.search(pattern, text):
            return mount
    return default


def _first_match(text: str, pattern: str) -> str | None:
    match = re.search(pattern, text, re.IGNORECASE)
    return match.group(1) if match else None


def _model_name(title: str, brand: str, focal_length: str, aperture: str) -> str:
    if brand == "Unknown" or focal_length == "unknown" or aperture == "unknown":
        return "unknown"
    compact = " ".join(title.split())
    return compact[:90]


def _accessories(text: str) -> list[str]:
    accessories: list[str] = []
    for phrase in ["front cap", "rear cap", "hood", "box", "case", "filter"]:
        if phrase in text:
            accessories.append(phrase)
    if "caps" in text and not accessories:
        accessories.extend(["front cap", "rear cap"])
    return accessories


def _condition(text: str, flags: list[str]) -> str:
    if any(flag in flags for flag in ["faulty", "untested"]) or "spares" in text:
        return "faulty/parts"
    if "excellent" in text or "mint" in text:
        return "excellent"
    if "good" in text or "clean" in text:
        return "good"
    if "acceptable" in text or "well used" in text:
        return "acceptable"
    return "unknown"
