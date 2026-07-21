from __future__ import annotations

import hashlib
import json
import os

from openai import OpenAI


PROMPT_VERSION = "lens-extract-v1"


def content_hash(title: str, description: str, image_urls: list[str] | None = None) -> str:
    content = json.dumps(
        {"title": title, "description": description, "image_urls": image_urls or []},
        sort_keys=True,
    )
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def extract_listing_json(title: str, description: str, image_urls: list[str] | None = None) -> dict:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("Set OPENAI_API_KEY before running AI extraction.")

    client = OpenAI(api_key=api_key)
    response = client.responses.create(
        model="gpt-4.1-mini",
        input=[
            {
                "role": "system",
                "content": "Extract camera lens listing details. Return only JSON matching the requested fields.",
            },
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "title": title,
                        "description": description,
                        "image_urls": image_urls or [],
                        "fields": [
                            "brand",
                            "lens_model",
                            "mount",
                            "focal_length",
                            "aperture",
                            "stabilization",
                            "autofocus",
                            "version",
                            "condition_grade",
                            "included_accessories",
                            "box_included",
                            "caps_included",
                            "hood_included",
                            "damage_flags",
                            "risk_flags",
                            "confidence",
                        ],
                    }
                ),
            },
        ],
        text={"format": {"type": "json_object"}},
    )
    return json.loads(response.output_text)
