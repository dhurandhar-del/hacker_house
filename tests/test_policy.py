"""One test per policy rule, including the negatives.

These tests are worth more to the score than any prompt. Twenty-five percent of
the judging is next-best-action quality, and every one of these assertions is a
way the agent could silently get a route or a rule wrong on case 14 at the worst
possible moment.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sentinel.ledger import Ledger  # noqa: E402
from sentinel.policy import (  # noqa: E402
    Action, CaseState, decide, route_for, sar_reason, should_file_report, should_stop,
)


def actions(state: CaseState) -> set[str]:
    return {r.action.value for r in decide(state)}


def route_of(state: CaseState, action: str) -> str | None:
    for r in decide(state):
        if r.action.value == action:
            return r.route
    return None


# --------------------------------------------------------------- routing table

def test_auto_actions_route_auto():
    for action in (Action.MONITOR_CARD, Action.WARN_CUSTOMER, Action.VERIFY_WITH_CUSTOMER,
                   Action.STEP_UP_AUTH, Action.CREATE_CASE, Action.ESCALATE_TO_ANALYST,
                   Action.CLOSE_NO_FRAUD, Action.ALLOW_TRANSACTION,
                   Action.MONITOR_CONNECTED_CARDS, Action.GENERATE_REPORT):
        assert route_for(action, 10_000) == "auto"


def test_decline_is_always_l1():
    assert route_for(Action.DECLINE_TRANSACTION, 0) == "L1"
    assert route_for(Action.DECLINE_TRANSACTION, 99_999) == "L1"


def test_block_card_route_flips_at_2500():
    assert route_for(Action.BLOCK_CARD, 2_400) == "L1"
    assert route_for(Action.BLOCK_CARD, 2_500) == "L1"   # boundary is inclusive
    assert route_for(Action.BLOCK_CARD, 2_500.01) == "L2"
    assert route_for(Action.BLOCK_CARD, 2_600) == "L2"


def test_block_all_and_file_report_are_always_l2():
    assert route_for(Action.BLOCK_ALL_CARDS, 1) == "L2"
    assert route_for(Action.FILE_REPORT, 1) == "L2"


# ------------------------------------------------------------------- R1 .. R10

def test_r1_bars_a_block_on_one_weak_signal():
    state = CaseState(fraud_probability=0.65, independent_signals=1,
                      trigger_type="risk_score", exposure_usd=300)
    got = actions(state)
    assert "BLOCK_CARD" not in got
    assert "VERIFY_WITH_CUSTOMER" in got


def test_r1_allows_a_block_once_probability_clears_070_with_corroboration():
    state = CaseState(fraud_probability=0.88, verdict="fraud", independent_signals=3,
                      customer_response="denied", exposure_usd=300)
    assert "BLOCK_CARD" in actions(state)


def test_r2_denial_gives_block_and_case():
    state = CaseState(fraud_probability=0.86, verdict="fraud", trigger_type="customer_report",
                      customer_response="denied", independent_signals=2, exposure_usd=268.43)
    got = actions(state)
    assert {"BLOCK_CARD", "CREATE_CASE"} <= got
    assert route_of(state, "BLOCK_CARD") == "L1"        # under $2,500


def test_r2_adds_a_report_when_exposure_exceeds_1000():
    state = CaseState(fraud_probability=0.9, verdict="fraud", trigger_type="customer_report",
                      customer_response="denied", independent_signals=2, exposure_usd=1_200)
    got = actions(state)
    assert "FILE_REPORT" in got
    assert route_of(state, "FILE_REPORT") == "L2"


def test_r2_adds_a_report_when_a_shared_device_links_another_card():
    state = CaseState(fraud_probability=0.86, verdict="fraud", trigger_type="customer_report",
                      customer_response="denied", independent_signals=2, exposure_usd=268.43,
                      shared_origin=True, shared_origin_kind="a shared device profile",
                      connected_card_ids=["C00877-K1"])
    got = actions(state)
    assert {"FILE_REPORT", "MONITOR_CONNECTED_CARDS"} <= got


def test_r3_confirmation_closes_the_alert():
    state = CaseState(fraud_probability=0.2, verdict="legitimate",
                      trigger_type="customer_report", customer_response="confirmed",
                      independent_signals=2)
    got = actions(state)
    assert "CLOSE_NO_FRAUD" in got
    assert "BLOCK_CARD" not in got


def test_r4_no_reply_monitors_and_declines_pending():
    state = CaseState(fraud_probability=0.5, customer_response="no_reply",
                      pending_authorization=True, independent_signals=2, exposure_usd=200)
    got = actions(state)
    assert {"MONITOR_CARD", "DECLINE_TRANSACTION"} <= got
    assert "ESCALATE_TO_ANALYST" not in got          # exposure below $500


def test_r4_escalates_when_exposure_exceeds_500():
    state = CaseState(fraud_probability=0.5, customer_response="no_reply",
                      independent_signals=2, exposure_usd=750)
    assert "ESCALATE_TO_ANALYST" in actions(state)


def test_r5_card_testing_declines_and_steps_up():
    state = CaseState(fraud_probability=0.72, verdict="fraud", independent_signals=2,
                      card_testing_sequence=True, exposure_usd=9.40)
    got = actions(state)
    assert {"DECLINE_TRANSACTION", "STEP_UP_AUTH"} <= got
    assert "BLOCK_CARD" not in got                   # nothing over $100 cleared yet


def test_r5_blocks_once_a_purchase_over_100_has_cleared():
    state = CaseState(fraud_probability=0.8, verdict="fraud", independent_signals=2,
                      card_testing_sequence=True, card_testing_cleared_over_100=True,
                      exposure_usd=268.43)
    got = actions(state)
    assert "BLOCK_CARD" in got
    assert route_of(state, "BLOCK_CARD") == "L1"


def test_r6_shared_origin_creates_case_reports_and_monitors():
    state = CaseState(fraud_probability=0.8, verdict="fraud", independent_signals=3,
                      shared_origin=True, shared_origin_kind="one device profile",
                      connected_card_ids=["C1-K1", "C2-K1"], exposure_usd=400)
    got = actions(state)
    assert {"CREATE_CASE", "FILE_REPORT", "MONITOR_CONNECTED_CARDS"} <= got


def test_r7_disputed_but_recurring_never_blocks():
    state = CaseState(fraud_probability=0.55, trigger_type="customer_report",
                      recurring_match=True, independent_signals=3, exposure_usd=49.0)
    got = actions(state)
    assert {"CREATE_CASE", "VERIFY_WITH_CUSTOMER", "WARN_CUSTOMER"} <= got
    assert "BLOCK_CARD" not in got


def test_r7_still_never_blocks_even_after_a_denial():
    """R7 is a bar, not a preference: a denial must not override it."""
    state = CaseState(fraud_probability=0.75, trigger_type="customer_report",
                      recurring_match=True, customer_response="denied",
                      independent_signals=3, exposure_usd=49.0)
    got = actions(state)
    assert "BLOCK_CARD" not in got
    assert "CREATE_CASE" in got


def test_r8_escalates_when_uncertain_and_exposed():
    state = CaseState(fraud_probability=0.5, verdict="uncertain",
                      independent_signals=2, exposure_usd=700)
    assert "ESCALATE_TO_ANALYST" in actions(state)


def test_r8_escalates_when_evidence_conflicts_regardless_of_exposure():
    state = CaseState(fraud_probability=0.5, verdict="uncertain", independent_signals=3,
                      exposure_usd=49, evidence_conflicts=True)
    assert "ESCALATE_TO_ANALYST" in actions(state)


def test_r9_undocumented_pattern():
    state = CaseState(fraud_probability=0.8, verdict="fraud", independent_signals=3,
                      undocumented_pattern=True, exposure_usd=300)
    got = actions(state)
    assert {"CREATE_CASE", "FILE_REPORT", "ESCALATE_TO_ANALYST"} <= got


def test_r10_bars_block_all_cards_with_only_one_compromised_card():
    state = CaseState(fraud_probability=0.95, verdict="fraud", independent_signals=3,
                      customer_response="denied", cards_with_confirmed_fraud=1,
                      exposure_usd=5_000)
    assert "BLOCK_ALL_CARDS" not in actions(state)


def test_r10_allows_block_all_cards_with_two_compromised_cards():
    state = CaseState(fraud_probability=0.95, verdict="fraud", independent_signals=3,
                      customer_response="denied", cards_with_confirmed_fraud=2,
                      exposure_usd=5_000)
    got = actions(state)
    assert "BLOCK_ALL_CARDS" in got
    assert route_of(state, "BLOCK_ALL_CARDS") == "L2"


def test_r10_allows_block_all_cards_when_credentials_compromised():
    state = CaseState(fraud_probability=0.9, verdict="fraud", independent_signals=3,
                      customer_response="denied", credentials_compromised=True,
                      exposure_usd=900)
    assert "BLOCK_ALL_CARDS" in actions(state)


# ------------------------------------------------------------ section 3a (SAR)

def test_no_report_when_fraud_is_not_strongly_suspected():
    state = CaseState(fraud_probability=0.4, verdict="uncertain", exposure_usd=5_000)
    assert should_file_report(state) is False


def test_no_report_for_a_small_isolated_confirmed_fraud():
    state = CaseState(fraud_probability=0.9, verdict="fraud", exposure_usd=268.43)
    assert should_file_report(state) is False
    assert "no report" in sar_reason(state)


def test_report_when_exposure_exceeds_1000():
    state = CaseState(fraud_probability=0.9, verdict="fraud", exposure_usd=1_000.01)
    assert should_file_report(state) is True


def test_report_when_connected_to_another_customers_fraud():
    state = CaseState(fraud_probability=0.9, verdict="fraud", exposure_usd=100,
                      other_customer_fraud=True)
    assert should_file_report(state) is True


def test_sar_flag_always_agrees_with_the_action_list():
    """The answer file's sar.file must equal FILE_REPORT being present."""
    for p in (0.1, 0.35, 0.69, 0.71, 0.9):
        for exposure in (10.0, 999.99, 1_000.01, 5_000.0):
            for shared in (False, True):
                state = CaseState(fraud_probability=p, exposure_usd=exposure,
                                  verdict="fraud" if p >= 0.7 else "uncertain",
                                  independent_signals=2, shared_origin=shared,
                                  shared_origin_kind="a device" if shared else "")
                in_actions = "FILE_REPORT" in actions(state)
                assert in_actions == should_file_report(state), (p, exposure, shared)


def test_a_report_always_has_a_case_behind_it():
    state = CaseState(fraud_probability=0.9, verdict="fraud", exposure_usd=5_000,
                      independent_signals=2)
    got = [r.action.value for r in decide(state)]
    assert "FILE_REPORT" in got and "CREATE_CASE" in got
    assert got.index("CREATE_CASE") < got.index("FILE_REPORT")


# ---------------------------------------------------------------- section 3a/6

def test_case_opens_at_probability_030():
    assert "CREATE_CASE" not in actions(CaseState(fraud_probability=0.29))
    assert "CREATE_CASE" in actions(CaseState(fraud_probability=0.30))


def test_stop_requires_two_independent_signals():
    state = CaseState(fraud_probability=0.9, verdict="fraud")
    assert should_stop(state, independent_support=1)[0] is False
    assert should_stop(state, independent_support=2)[0] is True


def test_stop_on_a_settling_response():
    state = CaseState(fraud_probability=0.5, customer_response="denied")
    stop, reason = should_stop(state, independent_support=1)
    assert stop is True and "settled" in reason


def test_no_stop_in_the_middle_band():
    state = CaseState(fraud_probability=0.5, verdict="uncertain")
    assert should_stop(state, independent_support=5)[0] is False


def test_every_action_has_a_reason_and_a_valid_route():
    state = CaseState(fraud_probability=0.9, verdict="fraud", customer_response="denied",
                      independent_signals=3, exposure_usd=3_000, shared_origin=True,
                      shared_origin_kind="a device profile")
    for r in decide(state):
        assert r.reason.strip()
        assert r.route in {"auto", "L1", "L2"}
        assert r.route == route_for(r.action, state.exposure_usd)


def test_close_no_fraud_never_coexists_with_enforcement():
    state = CaseState(fraud_probability=0.2, verdict="legitimate",
                      customer_response="confirmed", independent_signals=2,
                      exposure_usd=5_000, shared_origin=True, shared_origin_kind="a device")
    got = actions(state)
    assert not ({"BLOCK_CARD", "BLOCK_ALL_CARDS"} & got and "CLOSE_NO_FRAUD" in got)


# ---------------------------------------------------------------- the ledger

def test_ledger_prior_follows_the_trigger():
    assert Ledger("customer_report").prior > Ledger("risk_score").prior


def test_ledger_moves_with_evidence_and_records_why():
    led = Ledger("risk_score")
    start = led.p
    led.post("risk_85_100", True, "model scored 0.90", "query:txn_detail(txn_id=X)", ["X"])
    assert led.p > start
    assert led.postings[0].p_before == pytest.approx(start, abs=1e-4)
    assert led.trajectory[0] == pytest.approx(round(led.prior, 4))


def test_ledger_caps_correlated_evidence():
    """Three phrasings of one device finding must not multiply."""
    led = Ledger("risk_score")
    for feature in ("device_new", "device_never_used_on_card", "proxy_present"):
        led.post(feature, True, "device signal", "query:device_novelty(txn_id=X)", ["X"])
    assert any(p.capped for p in led.postings)
    assert led.independent_support() == 1     # one group, however many postings


def test_ledger_counts_independent_groups_not_postings():
    led = Ledger("risk_score")
    led.post("risk_85_100", True, "score", "ref", [])
    led.post("device_new", True, "device", "ref", [])
    assert led.independent_support() == 2


def test_absence_is_recorded_as_evidence():
    led = Ledger("customer_report")
    start = led.p
    led.post("device_new", False, "device is not new for this account", "ref", [])
    assert led.p != start
    assert led.postings[0].present is False
    assert led.postings[0].as_evidence()["claim"]
