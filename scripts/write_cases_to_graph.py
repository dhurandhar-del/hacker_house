"""Write finished answer files into TigerGraph as FraudCase vertices.

    python scripts/write_cases_to_graph.py                 # everything in cases/
    python scripts/write_cases_to_graph.py cases/HHG-003.json
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sentinel import config as cfg      # noqa: E402
from sentinel.memory import load_answer, write_case  # noqa: E402


def main() -> None:
    paths = [Path(p) for p in sys.argv[1:]] or sorted(cfg.CASES_DIR.glob("HHG-*.json"))
    if not paths:
        raise SystemExit("no answer files found in cases/")
    conn = cfg.connect(verbose=False)
    for path in paths:
        alert_id = path.stem
        alert = conn.getVerticesById("Alert", alert_id)[0]["attributes"]
        answer = load_answer(path, alert)
        vid = write_case(conn, answer)
        print(f"  {path.name} -> FraudCase {vid} "
              f"({answer['case']['verdict']}, p={answer['case']['fraud_probability']}, "
              f"cites {len(answer['case']['similar_prior_cases'])} prior cases)")


if __name__ == "__main__":
    main()
