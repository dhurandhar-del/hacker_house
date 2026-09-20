"""Case memory: write a finished case back into TigerGraph.

This is what makes memory compound. A case is not just a JSON file on disk; it
becomes a FraudCase vertex wired to the transactions it covers, the card it sits
on, the alert that triggered it and the closed cases it cited. A later
investigation that lands on the same card or device walks one hop and finds it.

('FraudCase' rather than 'Case' because Case is a reserved GSQL keyword.)
"""
from __future__ import annotations

import datetime as dt
import json
from pathlib import Path


def case_vertex_id(case_id: str) -> str:
    return f"CASE-{case_id}"


def write_case(conn, answer: dict, created_by: str = "sentinel") -> str:
    """Upsert one answer file into the graph. Returns the case vertex id."""
    case = answer["case"]
    vid = case.get("graph_case_id") or case_vertex_id(answer["case_id"])
    nba = answer.get("next_best_actions", {})

    conn.upsertVertex(
        "FraudCase",
        vid,
        {
            "source_alert": answer["case_id"],
            "customer_id": _customer_of(answer),
            "card_id": _card_of(answer),
            "status": case["status"],
            "verdict": case["verdict"],
            "fraud_probability": float(case["fraud_probability"]),
            "pattern": case["pattern"],
            "pattern_description": case.get("pattern_description", ""),
            "exposure_usd": float(case["exposure_usd"]),
            "n_affected_txns": len(case["affected_txn_ids"]),
            "summary": case["summary"],
            "initial_actions": "|".join(a["action"] for a in nba.get("initial", [])),
            "final_actions": "|".join(a["action"] for a in nba.get("final", [])),
            "sar_filed": bool(answer.get("sar", {}).get("file", False)),
            "stop_reason": answer.get("stop_reason", ""),
            "created_at": dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "created_by": created_by,
        },
    )

    for txn_id in case["affected_txn_ids"]:
        conn.upsertEdge("FraudCase", vid, "CASE_INVOLVES", "Transaction", txn_id)
    card = _card_of(answer)
    if card:
        conn.upsertEdge("FraudCase", vid, "CASE_ON_CARD", "Card", card)
    for other in case.get("connected_card_ids", []):
        conn.upsertEdge("FraudCase", vid, "CASE_CONNECTED_TO", "Card", other)
    for prior in case.get("similar_prior_cases", []):
        conn.upsertEdge("FraudCase", vid, "CITES", "ClosedCase", prior)
    for device in case.get("connected_device_profiles", []):
        key = _device_key_for_label(conn, device)
        if key:
            conn.upsertEdge("FraudCase", vid, "IMPLICATES", "DeviceProfile", key)
    conn.upsertEdge("FraudCase", vid, "FROM_ALERT", "Alert", answer["case_id"])
    return vid


def _customer_of(answer: dict) -> str:
    """The customer is not a field of the answer format; take it from the alert."""
    return answer.get("_customer_id", "")


def _card_of(answer: dict) -> str:
    return answer.get("_card_id", "")


def _device_key_for_label(conn, label: str) -> str | None:
    """Device profiles are named by their label in answer files, keyed by hash."""
    res = conn.runInterpretedQuery(
        f'INTERPRET QUERY () FOR GRAPH {conn.graphname} {{'
        f'  D = {{DeviceProfile.*}};'
        f'  R = SELECT d FROM D:d WHERE d.label == "{label}";'
        f'  PRINT R; }}'
    )
    rows = res[0].get("R", []) if res else []
    return rows[0]["v_id"] if rows else None


def load_answer(path: Path, alert: dict | None = None) -> dict:
    answer = json.loads(path.read_text(encoding="utf-8"))
    if alert:
        answer["_customer_id"] = alert.get("customer_id", "")
        answer["_card_id"] = alert.get("card_id", "")
    return answer
