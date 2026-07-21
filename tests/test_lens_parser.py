from pipeline.ai.lens_parser import normalize_lens_title
from pipeline.filters import exclusion_reason, risk_flags


def test_normalizes_canon_ef_50mm():
    identity = normalize_lens_title("Canon EF 50mm f/1.8 STM lens with caps")

    assert identity.brand == "Canon"
    assert identity.mount == "Canon EF"
    assert identity.focal_length == "50mm"
    assert identity.aperture == "f/1.8"
    assert identity.confidence == "high"


def test_flags_parts_and_risk_terms():
    text = "Tamron 28-75mm f2.8 Sony E untested spares repair fungus haze"

    assert exclusion_reason(text) == "spares-repair"
    assert "untested" in risk_flags(text)
    assert "fungus" in risk_flags(text)
    assert "haze" in risk_flags(text)
