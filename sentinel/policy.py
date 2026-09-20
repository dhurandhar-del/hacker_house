"""The fraud policy as code. No LLM touches this file's decisions.

Twenty-five percent of the score is next-best-action quality, and a prompt will
eventually route BLOCK_CARD to `auto` or invent an action name. This is a pure
function from investigation state to an ordered action list with approval routes
and rule citations, with one unit test per rule in tests/test_policy.py.

Everything here is transcribed from the Fraud Policy section of the dataset
README, version 1.0. Action names and route identifiers are verbatim.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class Action(str, Enum):
    ALLOW_TRANSACTION = "ALLOW_TRANSACTION"
    DECLINE_TRANSACTION = "DECLINE_TRANSACTION"
    MONITOR_CARD = "MONITOR_CARD"
    MONITOR_CONNECTED_CARDS = "MONITOR_CONNECTED_CARDS"
    WARN_CUSTOMER = "WARN_CUSTOMER"
    VERIFY_WITH_CUSTOMER = "VERIFY_WITH_CUSTOMER"
    STEP_UP_AUTH = "STEP_UP_AUTH"
    BLOCK_CARD = "BLOCK_CARD"
    BLOCK_ALL_CARDS = "BLOCK_ALL_CARDS"
    GENERATE_REPORT = "GENERATE_REPORT"
    CREATE_CASE = "CREATE_CASE"
    FILE_REPORT = "FILE_REPORT"
    ESCALATE_TO_ANALYST = "ESCALATE_TO_ANALYST"
    CLOSE_NO_FRAUD = "CLOSE_NO_FRAUD"


AUTO_ACTIONS = {
    Action.ALLOW_TRANSACTION, Action.MONITOR_CARD, Action.MONITOR_CONNECTED_CARDS,
    Action.WARN_CUSTOMER, Action.VERIFY_WITH_CUSTOMER, Action.STEP_UP_AUTH,
    Action.GENERATE_REPORT, Action.CREATE_CASE, Action.ESCALATE_TO_ANALYST,
    Action.CLOSE_NO_FRAUD,
}

BLOCK_CARD_L2_THRESHOLD = 2500.0
SAR_EXPOSURE_THRESHOLD = 1000.0
CASE_PROBABILITY_THRESHOLD = 0.30
VERIFY_BEFORE_BLOCK_THRESHOLD = 0.70
ESCALATE_EXPOSURE_THRESHOLD = 500.0
R4_ESCALATE_THRESHOLD = 500.0


def route_for(action: Action, exposure_usd: float = 0.0) -> str:
    """The approval route. Only BLOCK_CARD depends on exposure."""
    if action in AUTO_ACTIONS:
        return "auto"
    if action is Action.DECLINE_TRANSACTION:
        return "L1"
    if action is Action.BLOCK_CARD:
        return "L1" if exposure_usd <= BLOCK_CARD_L2_THRESHOLD else "L2"
    if action in (Action.BLOCK_ALL_CARDS, Action.FILE_REPORT):
        return "L2"
    raise ValueError(f"no route defined for {action}")


@dataclass
class Recommendation:
    action: Action
    route: str
    reason: str

    def as_dict(self) -> dict:
        return {"action": self.action.value, "route": self.route, "reason": self.reason}


@dataclass
class CaseState:
    """Everything the policy needs. Filled from the graph and the ledger."""

    fraud_probability: float
    exposure_usd: float = 0.0
    verdict: str = "uncertain"

    trigger_type: str = "risk_score"          # risk_score / customer_report / analyst_request
    customer_response: str | None = None      # denied / confirmed / no_reply / None

    #: How many independent evidence groups moved the probability. Policy R1
    #: turns on whether the case rests on a *single* signal.
    independent_signals: int = 1

    pattern: str = "none"
    card_testing_sequence: bool = False
    card_testing_cleared_over_100: bool = False
    pending_authorization: bool = False

    recurring_match: bool = False             # R7: disputed charge matches own pattern
    shared_origin: bool = False               # R6: shared device / region / recipient email
    shared_origin_kind: str = ""
    connected_card_ids: list[str] = field(default_factory=list)
    other_customer_fraud: bool = False

    cards_with_confirmed_fraud: int = 0       # R10 gate
    credentials_compromised: bool = False

    evidence_conflicts: bool = False          # R8
    undocumented_pattern: bool = False        # R9


def _add(out: list[Recommendation], action: Action, reason: str, state: CaseState) -> None:
    if any(r.action is action for r in out):
        return
    out.append(Recommendation(action, route_for(action, state.exposure_usd), reason))


def decide(state: CaseState) -> list[Recommendation]:
    """Ordered recommendations for one investigation state.

    Order is execution order -- what happens first -- not severity, as the
    policy requires.
    """
    out: list[Recommendation] = []
    p = state.fraud_probability

    # R5: card testing. Decline and step up; block only if a real purchase cleared.
    if state.card_testing_sequence:
        _add(out, Action.DECLINE_TRANSACTION,
             "R5: three or more small online authorizations within an hour followed "
             "by a larger purchase", state)
        _add(out, Action.STEP_UP_AUTH, "R5: require step-up before further activity", state)

    # R7: disputed but matches the cardholder's own recurring pattern. Never block.
    if state.recurring_match and state.trigger_type == "customer_report":
        _add(out, Action.CREATE_CASE, "R7: cardholder disputes a charge that matches "
                                      "their own recurring pattern", state)
        if state.customer_response is None:
            _add(out, Action.VERIFY_WITH_CUSTOMER, "R7: confirm with the cardholder "
                                                   "before taking any action", state)
        _add(out, Action.WARN_CUSTOMER,
             "R7: send an informational message about the recurring charge", state)

    # R1: verify before blocking on a weak single signal.
    blocked_by_r1 = (
        state.independent_signals <= 1
        and p < VERIFY_BEFORE_BLOCK_THRESHOLD
        and state.customer_response is None
    )
    if blocked_by_r1:
        _add(out, Action.VERIFY_WITH_CUSTOMER,
             f"R1: the case rests on a single signal and assessed probability "
             f"{p:.2f} is below 0.70, so verify before any block", state)

    # R2 / R3 / R4: what the customer said.
    if state.customer_response == "denied":
        if not state.recurring_match:
            _add(out, Action.BLOCK_CARD, "R2: cardholder denies the transaction", state)
        _add(out, Action.CREATE_CASE, "R2: cardholder denies the transaction", state)
    elif state.customer_response == "confirmed":
        if not state.shared_origin and not state.undocumented_pattern:
            _add(out, Action.CLOSE_NO_FRAUD,
                 "R3: cardholder confirms the transaction", state)
    elif state.customer_response == "no_reply":
        _add(out, Action.MONITOR_CARD, "R4: no reply within 24 hours", state)
        if state.pending_authorization:
            _add(out, Action.DECLINE_TRANSACTION,
                 "R4: decline pending authorizations while unverified", state)
        if state.exposure_usd > R4_ESCALATE_THRESHOLD:
            _add(out, Action.ESCALATE_TO_ANALYST,
                 f"R4: no reply and exposure ${state.exposure_usd:,.2f} exceeds $500", state)

    # R5 continued: a cleared purchase over $100 justifies a block outright.
    if state.card_testing_sequence and state.card_testing_cleared_over_100:
        _add(out, Action.BLOCK_CARD,
             "R5: a purchase over $100 has already cleared after the testing sequence",
             state)

    # R6: shared origin across cards.
    if state.shared_origin:
        kind = state.shared_origin_kind or "a shared origin"
        _add(out, Action.CREATE_CASE, f"R6: several cards show fraud from {kind}", state)
        _add(out, Action.MONITOR_CONNECTED_CARDS,
             f"R6: monitor every card sharing {kind}", state)

    # R9: coordinated or repeated abuse that fits none of the known patterns.
    if state.undocumented_pattern:
        _add(out, Action.CREATE_CASE, "R9: coordinated abuse fitting no known pattern", state)
        _add(out, Action.ESCALATE_TO_ANALYST,
             "R9: undocumented pattern needs a human to characterise it", state)

    # 3a: open a case once fraud is plausible, or whenever evidence was requested.
    if p >= CASE_PROBABILITY_THRESHOLD or state.customer_response is not None:
        _add(out, Action.CREATE_CASE,
             f"3a: a case is opened once fraud probability reaches 0.30 "
             f"(assessed {p:.2f}) or evidence has been requested", state)

    # R8: uncertain and exposed, or evidence pulling both ways.
    if state.verdict == "uncertain" and (
        state.exposure_usd > ESCALATE_EXPOSURE_THRESHOLD or state.evidence_conflicts
    ):
        why = ("the evidence conflicts" if state.evidence_conflicts
               else f"exposure ${state.exposure_usd:,.2f} exceeds $500")
        _add(out, Action.ESCALATE_TO_ANALYST, f"R8: verdict is uncertain and {why}", state)

    # SAR, decided by the same boolean that the answer file's sar.file must use.
    if should_file_report(state):
        _add(out, Action.FILE_REPORT, sar_reason(state), state)

    # R10 gate: BLOCK_ALL_CARDS is unreachable without two compromised cards or
    # confirmed credential theft. Enforced as a gate, not as a suggestion.
    if state.cards_with_confirmed_fraud >= 2 or state.credentials_compromised:
        _add(out, Action.BLOCK_ALL_CARDS,
             "R10: two or more of the customer's cards show confirmed fraud, or "
             "credentials are confirmed compromised", state)

    # Legitimate and settled: close it.
    if state.verdict == "legitimate" and not any(
        r.action in (Action.CLOSE_NO_FRAUD, Action.WARN_CUSTOMER) for r in out
    ):
        _add(out, Action.CLOSE_NO_FRAUD,
             f"assessed probability {p:.2f} with no supporting evidence found", state)

    # Monitoring is the low-impact fallback when nothing else is warranted.
    if not out:
        _add(out, Action.MONITOR_CARD,
             f"assessed probability {p:.2f} warrants sensitivity but no action", state)

    return _enforce_gates(out, state)


def _enforce_gates(out: list[Recommendation], state: CaseState) -> list[Recommendation]:
    """Hard bars that no rule above may violate. Defence in depth."""
    p = state.fraud_probability

    # R1: no block on a single weak signal before the customer has answered.
    if (state.independent_signals <= 1 and p < VERIFY_BEFORE_BLOCK_THRESHOLD
            and state.customer_response is None):
        out = [r for r in out if r.action not in (Action.BLOCK_CARD, Action.BLOCK_ALL_CARDS)]

    # R7: a disputed charge matching the cardholder's own pattern is never blocked.
    if state.recurring_match:
        out = [r for r in out if r.action is not Action.BLOCK_CARD]

    # R10.
    if not (state.cards_with_confirmed_fraud >= 2 or state.credentials_compromised):
        out = [r for r in out if r.action is not Action.BLOCK_ALL_CARDS]

    # A report always has a case behind it.
    if any(r.action is Action.FILE_REPORT for r in out) and not any(
        r.action is Action.CREATE_CASE for r in out
    ):
        out.insert(0, Recommendation(Action.CREATE_CASE, "auto",
                                     "3a: a report always has a case behind it"))

    # CLOSE_NO_FRAUD cannot coexist with an enforcement action.
    if any(r.action is Action.CLOSE_NO_FRAUD for r in out) and any(
        r.action in (Action.BLOCK_CARD, Action.BLOCK_ALL_CARDS, Action.FILE_REPORT)
        for r in out
    ):
        out = [r for r in out if r.action is not Action.CLOSE_NO_FRAUD]

    # Routes are recomputed from the table, never trusted from above.
    for r in out:
        r.route = route_for(r.action, state.exposure_usd)
    return out


def should_file_report(state: CaseState) -> bool:
    """Section 3a. Confirmed or strongly suspected AND at least one trigger."""
    strongly_suspected = (
        state.verdict == "fraud" or state.fraud_probability >= 0.70
    )
    if not strongly_suspected:
        return False
    return (
        state.exposure_usd > SAR_EXPOSURE_THRESHOLD
        or state.shared_origin
        or state.other_customer_fraud
        or state.undocumented_pattern
    )


def sar_reason(state: CaseState) -> str:
    if not should_file_report(state):
        bits = []
        if not (state.verdict == "fraud" or state.fraud_probability >= 0.70):
            bits.append(f"fraud is neither confirmed nor strongly suspected "
                        f"(probability {state.fraud_probability:.2f})")
        if state.exposure_usd <= SAR_EXPOSURE_THRESHOLD:
            bits.append(f"exposure ${state.exposure_usd:,.2f} is at or below $1,000")
        if not (state.shared_origin or state.other_customer_fraud
                or state.undocumented_pattern):
            bits.append("the activity connects to no shared device profile, region "
                        "cluster or other customer's fraud")
        return "3a: no report. " + "; ".join(bits) + "."
    triggers = []
    if state.exposure_usd > SAR_EXPOSURE_THRESHOLD:
        triggers.append(f"exposure ${state.exposure_usd:,.2f} exceeds $1,000")
    if state.shared_origin:
        triggers.append(f"the activity connects to {state.shared_origin_kind or 'a shared origin'}")
    if state.other_customer_fraud:
        triggers.append("the activity connects to another customer's fraud")
    if state.undocumented_pattern:
        triggers.append("the pattern is coordinated and undocumented (R9)")
    return "3a: fraud confirmed or strongly suspected and " + "; ".join(triggers) + "."


def should_stop(state: CaseState, independent_support: int) -> tuple[bool, str]:
    """Policy section 6. Returns (stop, reason)."""
    p = state.fraud_probability
    if state.customer_response in ("denied", "confirmed"):
        return True, ("Policy 6: the verification response settled the question "
                      f"(cardholder {state.customer_response} the transaction).")
    if p >= 0.85 and independent_support >= 2:
        return True, (f"Policy 6: probability {p:.2f} is at or above 0.85 with "
                      f"{independent_support} independent pieces of evidence.")
    if p <= 0.15 and independent_support >= 2:
        return True, (f"Policy 6: probability {p:.2f} is at or below 0.15 with "
                      f"{independent_support} independent pieces of evidence.")
    return False, ""
