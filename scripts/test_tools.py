"""Exit test for the tool layer: reproduce the HHG-003 hand investigation.

Every number asserted here was established by hand in docs/HAND_INVESTIGATION.md
before any of these queries existed. If the tools disagree with the hand
investigation, the tools are wrong.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sentinel import config as cfg          # noqa: E402
from sentinel.tools import GraphTools, QueryLog  # noqa: E402

CARD = "C08623-K2"
TXN = "3530164"
TS = "2016-12-10 13:01:21"
REGION = "330.0"

failures: list[str] = []


def check(label: str, got, want) -> None:
    ok = got == want
    print(f"  [{'ok  ' if ok else 'FAIL'}] {label:<44} got {got!r:>12}  want {want!r}")
    if not ok:
        failures.append(label)


def main() -> None:
    log = QueryLog()
    g = GraphTools(cfg.connect(verbose=False), log)

    print("txn_detail")
    r = g.txn_detail(TXN)
    txn = r.get("txn")[0]["attributes"]
    check("amount", round(txn["amt"], 2), 49.0)
    check("channel", txn["channel"], "in_person")
    check("risk_score", round(txn["risk_score"], 2), 0.4)
    check("billing region", txn["addr1"], REGION)
    check("no device record (product W)", txn["device_key"], "")

    print("\ncard_baseline")
    r = g.card_baseline(CARD)
    card = r.get("card")[0]["attributes"]
    check("n_txns", card["n_txns"], 1134)
    check("n_in_person", card["n_in_person"], 1080)
    check("median_amt", round(card["median_amt"], 2), 68.01)
    check("p95_amt", round(card["p95_amt"], 2), 425.66)

    print("\nregion_novelty (as of the alert)")
    r = g.region_novelty(CARD, REGION, TS)
    check("prior txns in region 330.0", r.get("prior_txns_in_region"), 42)
    check("prior txns on card", r.get("prior_txns_on_card"), 980)
    check("first seen in region", r.get("first_seen_in_region")[:10], "2016-07-09")

    print("\namount_band_probe")
    r = g.amount_band_probe(CARD, 49.0, TS, tol=0.5)
    check("prior charges in $48.50-49.50", r.get("prior_charges_in_band"), 53)

    print("\ncard_window (+/- 72h)")
    r = g.card_window(CARD, TS, 72)
    rows = r.get("window")
    hi = [x["attributes"] for x in rows if x["attributes"]["T.risk_score"] >= 0.85]
    # 43, not the 62 of the hand investigation: that used a 7-day calendar
    # span, this is +/-72h around the alert. Verified against staging.
    check("window size (+/-72h)", len(rows), 43)
    check("highest-risk neighbour", hi[0]["T.txn_id"] if hi else None, "3530056")
    check("its amount", round(hi[0]["T.amt"], 2) if hi else None, 116.93)

    print("\ncustomer_case_history (denial track record)")
    r = g.customer_case_history("C08623")
    check("confirmed fraud cases", r.get("confirmed_fraud_cases"), 5)
    check("cleared cases", r.get("cleared_cases"), 1)
    check("customer reports confirmed as fraud", r.get("customer_reports_confirmed_fraud"), 5)

    print("\nregion_cluster (window vs matched baseline)")
    r = g.region_cluster(REGION, "2016-12-08 00:00:00", "2016-12-12 23:59:59",
                         "2016-11-08 00:00:00", "2016-11-12 23:59:59", 0.7)
    check("window txns", r.get("window_txns"), 608)
    check("window high-risk", r.get("window_high_risk"), 18)
    check("baseline txns", r.get("baseline_txns"), 552)
    check("baseline high-risk", r.get("baseline_high_risk"), 13)

    print("\nrecurring_charge_probe")
    r = g.recurring_charge_probe(CARD, 49.0, product="W", tol=0.5)
    check("matching charges >= 50", r.get("matching_charges") >= 50, True)
    check("spans >= 5 months", r.get("distinct_months") >= 5, True)

    print("\ncase_memory_for_card (memory that compounds)")
    r = g.case_memory_for_card(CARD)
    check("bank closed cases", len(r.get("bank_closed_cases")), 6)
    check("sentinel's own prior cases", len(r.get("sentinel_cases")), 1)

    print("\nprobes that must come back EMPTY on this case")
    r = g.card_testing_probe(CARD, TS, 5.0)
    check("small online auths in 1h (R5)", r.get("small_online_auths_1h"), 0)
    r = g.device_novelty(TXN)
    check("prior txns on this device", r.get("prior_txns_this_device_on_card"), 0)
    # The card used 5 device profiles online in the window; 3 are generic
    # fingerprints (102, 215 and 33 cards) and are excluded. The 2 that survive
    # link 11 other cards -- but none of them touch the DISPUTED charge, which is
    # in person and carries no device record at all. That is why the answer file
    # reports no connected cards for this case.
    r = g.ring_expand(CARD, TS, 30, max_device_cards=20)
    check("device profiles used in window", r.get("devices_total"), 5)
    check("of those, specific enough to link", r.get("devices_specific_enough"), 2)
    check("cards linked via specific devices", len(r.get("connected_cards")), 11)
    loose = g.ring_expand(CARD, TS, 30, max_device_cards=10000)
    check("ungated, generic profiles inflate it", len(loose.get("connected_cards")), 25)
    check("flagged txn itself has no device", txn["device_key"], "")

    print(f"\n{log.count} tool calls, {log.total_seconds:.1f}s total")
    print("sample refs written into evidence:")
    for ref in log.refs()[:4]:
        print(f"    {ref}")

    if failures:
        print(f"\n{len(failures)} MISMATCH(ES): {', '.join(failures)}")
        sys.exit(1)
    print("\nall tool results match the hand investigation")


if __name__ == "__main__":
    main()
