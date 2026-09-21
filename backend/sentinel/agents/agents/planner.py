"""Choosing which questions to ask the graph.

The planner is the one place a model decides what happens next, and its blast
radius is deliberately small: it picks from a fixed catalogue, every name is
validated against the registry before anything is dispatched, and a plan that
comes back empty or unusable falls through to a static plan per trigger type.

The static plans are not a degraded mode. They encode the order the hand
investigation actually used, so a run with no model still asks the right
questions — it just cannot adapt when an answer is surprising.
"""

from __future__ import annotations

from dataclasses import dataclass

from pydantic import BaseModel, Field

from sentinel.agents.agents.base import LlmAgent, bullet
from sentinel.agents.context import InvestigationContext
from sentinel.domain.enums import TriggerType
from sentinel.llm.prompts import PLANNER_SYSTEM


class PlannedCall(BaseModel):
    """One chosen tool. Deliberately no arguments.

    The sweep builds every argument from measurements, so a planner cannot
    anchor a window on the alert's timestamp instead of the transaction's. It
    also keeps the schema expressible: OpenAI's strict mode requires
    `additionalProperties: false` on every object, which a free-form argument
    dict cannot satisfy.
    """

    name: str
    why: str = ""


class PlanOutput(BaseModel):
    tools: list[PlannedCall] = Field(default_factory=list)


#: The detectors every case runs, in the order the hand investigation used them.
#: txn_detail comes first because it is the only source of the true `ts`, and
#: every window in the run is anchored on it.
CORE_PLAN: tuple[str, ...] = (
    "card_baseline",
    "card_window",
    "amount_band_probe",
    "card_amount_stats",
    "region_novelty",
    "device_novelty",
    "txn_sequence_context",
    "customer_case_history",
    "case_memory_for_card",
)

#: What each trigger type adds, because the question each alert asks differs.
TRIGGER_PLANS: dict[TriggerType, tuple[str, ...]] = {
    # A score alone. The job is to find what the score is reacting to, or to
    # establish that nothing supports it.
    TriggerType.RISK_SCORE: ("card_testing_probe", "velocity_probe", "product_novelty"),
    # A dispute. R7 protects the cardholder who forgot their own subscription,
    # so the recurring probe is not optional here.
    TriggerType.CUSTOMER_REPORT: ("recurring_charge_probe", "card_testing_probe"),
    # HHG-014's trigger says outright that several cards share a device profile,
    # so the ring is the question being asked.
    TriggerType.ANALYST_REQUEST: ("ring_expand", "device_neighbors", "velocity_probe"),
}


@dataclass
class PlannerAgent(LlmAgent[PlanOutput]):
    """Picks the next graph calls; falls back to the plan per trigger type."""

    purpose: str = "plan"
    schema: type[BaseModel] = PlanOutput
    system: str = PLANNER_SYSTEM
    max_output_tokens: int = 800

    def render(self, ctx: InvestigationContext) -> str:
        catalogue = bullet(
            [f"{tool.name}: {tool.question}" for tool in ctx.tools.catalogue()]
        )
        known = bullet([p.claim for p in ctx.ledger.postings]) or "- nothing yet"
        txn = ctx.txn
        return (
            f"Case {ctx.alert.alert_id} ({ctx.alert.trigger_type.value}).\n"
            f"Trigger text: {ctx.alert.trigger_text}\n"
            f"Card {ctx.alert.card_id}, customer {ctx.alert.customer_id}, "
            f"flagged transaction {ctx.flagged_txn_id}.\n"
            f"as_of (use this for every window): {ctx.as_of}\n"
            + (
                f"The transaction is ${txn.amt:,.2f}, {txn.channel}, region "
                f"{txn.addr1 or 'not recorded'}, product {txn.product}, "
                f"model score {txn.risk_score:.2f}.\n"
                if txn is not None
                else ""
            )
            + f"\nAlready known:\n{known}\n\n"
            f"Tools available:\n{catalogue}\n\n"
            f"You may make at most {ctx.guard.remaining_tool_calls()} more calls. "
            "Choose the ones whose answers could change the decision."
        )

    def fallback(self, ctx: InvestigationContext) -> PlanOutput:
        return PlanOutput(tools=[PlannedCall(name=name, why="standard plan") for name in self.static_plan(ctx)])

    @staticmethod
    def static_plan(ctx: InvestigationContext) -> tuple[str, ...]:
        """The detectors this trigger type always warrants."""
        return CORE_PLAN + TRIGGER_PLANS.get(ctx.alert.trigger_type, ())

    @staticmethod
    def usable(output: PlanOutput, ctx: InvestigationContext) -> list[PlannedCall]:
        """Drop names the registry does not know, and anything already answered.

        A hallucinated tool name is not an error worth failing a run over — it is
        simply discarded, and the trace shows what was asked for.
        """
        seen = {call.tool for call in ctx.tools.log.calls}
        out: list[PlannedCall] = []
        for call in output.tools:
            if call.name not in ctx.tools:
                continue
            if call.name in seen or any(c.name == call.name for c in out):
                continue
            out.append(call)
        return out
