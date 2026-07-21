from __future__ import annotations

EXCLUSION_PHRASES = {
    "parts only": "parts-only",
    "for parts": "parts-only",
    "spares or repair": "spares-repair",
    "spares repair": "spares-repair",
    "faulty": "faulty",
    "untested": "untested",
    "manual only": "accessory-only",
    "box only": "accessory-only",
    "cap only": "accessory-only",
    "caps only": "accessory-only",
    "hood only": "accessory-only",
    "adapter only": "accessory-only",
}


RISK_PHRASES = [
    "fungus",
    "haze",
    "scratch",
    "scratches",
    "dust",
    "autofocus issue",
    "af is not as refined",
    "not as accurate",
    "not smooth",
    "*read*",
    "stabilization issue",
    "dropped",
    "stiff zoom",
    "stiff focus",
    "oil on aperture",
    "missing rear cap",
    "missing front cap",
    "no test body",
    "untested",
    "stock photos",
    "poor photos",
    "paint coming off",
    "paint loss",
    "paint wear",
    "cosmetic wear",
    "heavy wear",
    "well used",
    "marks on body",
    "wear to barrel",
]


def exclusion_reason(text: str) -> str | None:
    haystack = text.lower()
    for phrase, reason in EXCLUSION_PHRASES.items():
        if phrase in haystack:
            return reason
    return None


def risk_flags(text: str) -> list[str]:
    haystack = text.lower()
    return [phrase for phrase in RISK_PHRASES if phrase in haystack]
