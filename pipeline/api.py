from __future__ import annotations

import json
from pathlib import Path

from fastapi import FastAPI

from pipeline.db.sqlite import connect, initialize

app = FastAPI(title="Lens Resale Arbitrage API")


@app.on_event("startup")
def startup() -> None:
    conn = connect()
    initialize(conn)
    conn.close()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/opportunities")
def opportunities() -> list[dict]:
    db_path = Path("data/resale.db")
    if not db_path.exists():
        return []
    conn = connect(db_path)
    rows = conn.execute(
        """
        SELECT source_listing_id, market_value, low_value, high_value, comp_count,
               confidence, expected_profit, roi_percent, buy_score, decision, warnings, scored_at
        FROM opportunity_scores
        ORDER BY buy_score DESC, expected_profit DESC
        """
    ).fetchall()
    conn.close()
    return [{**dict(row), "warnings": json.loads(row["warnings"])} for row in rows]
