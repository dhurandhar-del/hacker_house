"""The ten steps of an investigation.

The names are a contract, not a convenience. They appear in the SSE stream, in
the UI timeline and in the persisted trace, and the counter that numbers them is
the same one that fills ``answer.evidence_requests[].asked_after_step``.

Six of the ten touch no model at all. That is the point: the model chooses what
to ask, names what it sees and writes the prose, and everything that becomes a
graded number or a policy decision is computed.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import Any, ClassVar

from sentinel.agents.agents.assessment import AssessmentAgent, DevilsAdvocateAgent
from sentinel.agents.agents.narration import NarrationAgent
from sentinel.agents.agents.planner import PlannerAgent
from sentinel.agents.context import InvestigationContext
from sentinel.agents.episode import EpisodeScoper
from sentinel.agents.state_builder import CaseStateBuilder, ScopedFacts
from sentinel.domain.enums import Pattern, RequestType
from sentinel.domain.errors import BudgetExceeded, VertexNotFound
from sentinel.policy.engine import PolicyEngine, PolicyOutcome
from sentinel.policy.state import CaseState
from sentinel.policy.stopping import StoppingPolicy
from sentinel.simulation.simulator import EvidenceSimulator
from sentinel.tools.dto import (
    AmountBandProbe,
    CardAmountStats,
    CardCaseMemory,
    CardTestingProbe,
    CardWindow,
    CustomerCaseHistory,
    DeviceNovelty,
    ProductNovelty,
    RecurringChargeProbe,
    RegionNovelty,
    RingExpansion,
    TxnDetail,
    TxnSequenceContext,
)
from sentinel.tools.log import ToolResult

logger = logging.getLogger(__name__)


class InvestigationStep(ABC):
    """One numbered stage. Advances the context and emits what it did.

    A step never writes a file, never picks a route and never calls a model
    directly — it delegates to an ``LlmAgent`` when it needs one.
    """

    name: ClassVar[str]
    title: ClassVar[str]

    @abstractmethod
    async def run(self, ctx: InvestigationContext) -> None: ...

    def skip(self, ctx: InvestigationContext) -> bool:
        """True when this step has nothing to do for this case."""
        return False


# ── 1. scope ─────────────────────────────────────────────────────────────────


class ScopeStep(InvestigationStep):
    """Resolve the alert to its transaction, and anchor the run on its clock."""

    name = "scope"
    title = "Scope the alert"

    async def run(self, ctx: InvestigationContext) -> None:
        result = await _call(ctx, "txn_detail", txn_id=ctx.flagged_txn_id)
        if not result.ok or not isinstance(result.data, TxnDetail):
            raise VertexNotFound(
                f"flagged transaction {ctx.flagged_txn_id} could not be read: {result.error}",
                vertex_type="Transaction",
                vertex_id=ctx.flagged_txn_id,
            )
        ctx.txn = result.data.txn
        # Everything downstream anchors on the transaction's own timestamp. The
        # alert is one to six hours later on all twenty and never equal.
        ctx.post_all(ctx.extractor.from_txn_detail(result.data, result.ref))


# ── 2. plan ──────────────────────────────────────────────────────────────────


class PlanStep(InvestigationStep):
    """Choose the detectors. The one step where a model decides what happens."""

    name = "plan"
    title = "Plan the investigation"

    def __init__(self, planner: PlannerAgent) -> None:
        self._planner = planner

    async def run(self, ctx: InvestigationContext) -> None:
        """The planner ADDS to a mandatory core; it does not replace it.

        Measured on HHG-003 against the live model: allowed to choose freely it
        picked 6 detectors instead of 11, and the five it dropped were the
        exonerating ones — the amount band, the card's own amount distribution,
        the recurring-charge probe. The probability came out 0.74 instead of
        0.36 on identical facts, while the model's own summary said the evidence
        did not fit a fraud pattern.

        That is the failure mode this benchmark punishes hardest, and it is
        structural rather than a prompt problem: a detector that would exonerate
        does not look relevant when a customer has just disputed a charge. So the
        core sweep is not the planner's to skip.
        """
        core = list(PlannerAgent.static_plan(ctx))
        output = await self._planner.run(ctx)
        extra = [call.name for call in PlannerAgent.usable(output, ctx) if call.name not in core]
        ctx.planned = core + extra
        ctx.planner_added = extra


# ── 3. sweep ─────────────────────────────────────────────────────────────────


class SweepStep(InvestigationStep):
    """Run the plan, normalise what comes back, post what it evidences."""

    name = "sweep"
    title = "Gather evidence from the graph"

    async def run(self, ctx: InvestigationContext) -> None:
        txn = ctx.txn
        assert txn is not None, "scope must run first"
        card = ctx.alert.card_id
        region = txn.addr1

        # Arguments are built here, from measurements, so a planner cannot shift
        # a window by passing the alert's time instead of the transaction's.
        arguments: dict[str, dict[str, object]] = {
            "card_baseline": {"card_id": card},
            "card_window": {"card_id": card, "center": ctx.as_of, "hours": 72},
            "amount_band_probe": {"card_id": card, "amt": txn.amt, "as_of": ctx.as_of},
            "card_amount_stats": {"card_id": card, "as_of": ctx.as_of},
            "region_novelty": {"card_id": card, "region": region, "as_of": ctx.as_of},
            "device_novelty": {"txn_id": txn.txn_id},
            "txn_sequence_context": {"txn_id": txn.txn_id},
            "customer_case_history": {"customer_id": ctx.alert.customer_id},
            "case_memory_for_card": {"card_id": card},
            "card_testing_probe": {"card_id": card, "center": ctx.as_of, "small_amt": 5.0},
            "velocity_probe": {"card_id": card, "center": ctx.as_of, "hours": 48},
            "recurring_charge_probe": {"card_id": card, "amt": txn.amt, "product": txn.product},
            "product_novelty": {"card_id": card, "product": txn.product, "as_of": ctx.as_of},
            "ring_expand": {
                "card_id": card,
                "center": ctx.as_of,
                "days": 30,
                # A correctness gate, never left to a planner: 116 of 9,704
                # profiles carry 24,653 of the card links.
                "max_device_cards": 20,
            },
            "device_neighbors": {
                "device_key": txn.device_key,
                "center": ctx.as_of,
                "days": 30,
            },
        }

        plan = [name for name in getattr(ctx, "planned", []) if name in arguments]
        if region == "":
            plan = [n for n in plan if n != "region_novelty"]
        if not txn.device_key:
            plan = [n for n in plan if n != "device_neighbors"]

        stats: CardAmountStats | None = None
        band: AmountBandProbe | None = None

        for name in plan:
            try:
                ctx.guard.check_tool_call()
            except BudgetExceeded:
                logger.info("sweep: tool budget reached, %d detector(s) not run", len(plan))
                break
            result = await _call(ctx, name, **arguments[name])
            if not result.ok:
                continue
            data = result.data

            if isinstance(data, CardWindow):
                ctx.window = data
            elif isinstance(data, CardTestingProbe):
                ctx.facts = _with(ctx.facts, testing=data)
            elif isinstance(data, RecurringChargeProbe):
                ctx.facts = _with(ctx.facts, recurring=data)
            elif isinstance(data, RingExpansion):
                ctx.facts = _with(ctx.facts, ring=data)
                ctx.post_all(ctx.extractor.from_ring(data, result.ref, ctx.alert.card_id))
                ctx.connected_card_ids = [c.card_id for c in data.connected_cards]
                ctx.connected_device_profiles = [
                    d.label for d in data.identifying_devices if d.label
                ]
            elif isinstance(data, CustomerCaseHistory):
                ctx.facts = _with(ctx.facts, history=data)
            elif isinstance(data, RegionNovelty):
                ctx.region_novelty = data
                ctx.post_all(
                    ctx.extractor.from_region_novelty(data, result.ref, ctx.alert.card_id, region)
                )
            elif isinstance(data, DeviceNovelty):
                ctx.device_novelty = data
                ctx.post_all(ctx.extractor.from_device_novelty(data, result.ref, txn.txn_id))
            elif isinstance(data, TxnSequenceContext):
                ctx.post_all(ctx.extractor.from_sequence(data, result.ref, txn.txn_id))
            elif isinstance(data, ProductNovelty):
                ctx.post_all(
                    ctx.extractor.from_product_novelty(
                        data, result.ref, ctx.alert.card_id, txn.product
                    )
                )
            elif isinstance(data, CardAmountStats):
                stats = data
            elif isinstance(data, AmountBandProbe):
                band = data
                ctx.amount_ref = result.ref
            elif isinstance(data, CardCaseMemory):
                ctx.similar_prior_cases = [c.case_id for c in data.bank_closed_cases][:6]

        # The amount family needs both results, so it posts once both are in.
        if band is not None:
            ctx.post_all(
                ctx.extractor.from_amount_band(
                    band, stats, ctx.amount_ref, ctx.alert.card_id, txn.amt
                )
            )


# ── 4. recall ────────────────────────────────────────────────────────────────


class RecallStep(InvestigationStep):
    """Retrieve prior cases and the policy text the assessment reasons over.

    Structural retrieval today; the hybrid retriever replaces the body of this
    step once the ``PolicyDoc`` corpus is ingested, without the step's contract
    changing.
    """

    name = "recall"
    title = "Recall prior cases"

    async def run(self, ctx: InvestigationContext) -> None:
        if not ctx.similar_prior_cases:
            result = await _call(ctx, "case_memory_for_card", card_id=ctx.alert.card_id)
            if result.ok and isinstance(result.data, CardCaseMemory):
                ctx.similar_prior_cases = [c.case_id for c in result.data.bank_closed_cases][:6]
        ctx.emitter.emit(
            "retrieval.completed",
            {
                "kind": "closed_case",
                "strategy": "structural",
                "query": f"card {ctx.alert.card_id}",
                "hits": [{"id": case_id} for case_id in ctx.similar_prior_cases],
            },
            step=ctx.counter.current,
        )


# ── 5. assess ────────────────────────────────────────────────────────────────


class AssessStep(InvestigationStep):
    """Name the pattern, then argue the other side of it."""

    name = "assess"
    title = "Assess and challenge"

    def __init__(self, assessor: AssessmentAgent, defence: DevilsAdvocateAgent) -> None:
        self._assessor = assessor
        self._defence = defence

    async def run(self, ctx: InvestigationContext) -> None:
        assessment = await self._assessor.run(ctx)
        ctx.pattern = assessment.pattern
        ctx.narration.summary = assessment.summary
        ctx.narration.pattern_description = (
            assessment.pattern_description if assessment.pattern is Pattern.UNDOCUMENTED else ""
        )

        exoneration = await self._defence.run(ctx)
        accepted = DevilsAdvocateAgent.to_postings(exoneration, ctx)
        ctx.post_all(accepted)
        ctx.facts = _with(ctx.facts, pattern=ctx.pattern, evidence_conflicts=bool(accepted))


# ── 6. stop_test ─────────────────────────────────────────────────────────────


class StopTestStep(InvestigationStep):
    """Policy §6: is the evidence already decisive enough to act on."""

    name = "stop_test"
    title = "Test whether to stop"

    def __init__(self, stopping: StoppingPolicy) -> None:
        self._stopping = stopping

    async def run(self, ctx: InvestigationContext) -> None:
        state = _state(ctx)
        decision = self._stopping.should_stop(state, ctx.ledger.independent_support())
        ctx.stop_before_request = decision.stop
        if decision.stop:
            ctx.narration.stop_reason = decision.reason


# ── 7. request_evidence ──────────────────────────────────────────────────────


class RequestEvidenceStep(InvestigationStep):
    """Ask for what is missing, and answer it from the graph, with the basis stated."""

    name = "request_evidence"
    title = "Request further evidence"

    def skip(self, ctx: InvestigationContext) -> bool:
        return ctx.stop_before_request

    async def run(self, ctx: InvestigationContext) -> None:
        try:
            ctx.guard.check_evidence_round()
        except BudgetExceeded:
            return
        ctx.guard.record_evidence_round()

        request_type = (
            RequestType.STEP_UP_AUTH
            if ctx.txn is not None and ctx.txn.channel == "online" and ctx.ledger.p >= 0.5
            else RequestType.CUSTOMER_VALIDATION
        )
        simulator = EvidenceSimulator(
            recurring=ctx.facts.recurring,
            region=ctx.region_novelty,
            history=ctx.facts.history,
            device=ctx.device_novelty,
            refs=dict(ctx.refs),
        )
        response = simulator.simulate(request_type)
        ctx.response = response
        ctx.customer_response = response.branch
        ctx.evidence_request_step = ctx.counter.current
        ctx.narration.assumed_response = response.assumed_response

        if response.log_lr != 0.0:
            posting = ctx.ledger.post_judgement(
                group="response",
                log_lr=response.log_lr,
                claim=response.claim,
                ref="evidence_request:1",
            )
            ctx.emitter.emit(
                "evidence.posted",
                {
                    "feature": posting.feature,
                    "present": True,
                    "group": posting.group,
                    "claim": posting.claim,
                    "source": posting.source.value,
                    "ref": posting.ref,
                    "entity_ids": [],
                    "lr": round(posting.lr, 4),
                    "log_lr": round(posting.log_lr, 4),
                    "p_before": round(posting.p_before, 4),
                    "p_after": round(posting.p_after, 4),
                    "capped": posting.capped,
                },
                step=ctx.counter.current,
            )

        ctx.emitter.emit(
            "evidence.requested",
            {
                "request_index": 1,
                "type": request_type.value,
                "rationale": "The evidence was not decisive under policy section 6.",
                "assumed_response": response.assumed_response,
                "assumption_basis": list(response.assumption_basis),
                "branch": response.branch.value,
                "log_lr_applied": response.log_lr,
            },
            step=ctx.evidence_request_step,
        )


# ── 8. decide ────────────────────────────────────────────────────────────────


class DecideStep(InvestigationStep):
    """Two policy evaluations: before the request, and after it."""

    name = "decide"
    title = "Decide under policy"

    def __init__(self, engine: PolicyEngine) -> None:
        self._engine = engine

    async def run(self, ctx: InvestigationContext) -> None:
        txn = ctx.txn
        assert txn is not None

        ctx.verdict = CaseStateBuilder(ctx.ledger).verdict()
        scoper = EpisodeScoper(
            window=ctx.window, testing=ctx.facts.testing, region=ctx.region_novelty
        )
        ctx.episode = scoper.scope(txn, ctx.pattern, ctx.verdict, txn.addr1)

        # `initial` is the recommendation BEFORE the requested evidence came
        # back, so it is evaluated with no customer response, whatever happened
        # later. Evaluating it after would make the pair incomparable.
        before = _state(ctx, customer_response=None)
        initial = self._engine.evaluate(before)
        ctx.initial = initial.recommendations
        ctx.emitter.emit(
            "policy.evaluated", _policy_payload(ctx, before, initial, "initial"),
            step=ctx.counter.current,
        )

        if ctx.response is None:
            # Nothing was asked, so final must deep-equal initial. The validator
            # makes any difference a hard error.
            ctx.final = list(ctx.initial)
            ctx.sar_file = initial.sar.file
            ctx.sar_reason = initial.sar.reason
            return

        after = _state(ctx, customer_response=ctx.customer_response)
        final = self._engine.evaluate(after)
        ctx.final = final.recommendations
        ctx.sar_file = final.sar.file
        ctx.sar_reason = final.sar.reason
        ctx.gates_fired = [gate.as_dict() for gate in final.gates if gate.fired]
        ctx.emitter.emit(
            "policy.evaluated", _policy_payload(ctx, after, final, "final"),
            step=ctx.counter.current,
        )


# ── 9. narrate ───────────────────────────────────────────────────────────────


class NarrateStep(InvestigationStep):
    """Write the prose, once every number is settled."""

    name = "narrate"
    title = "Write the case"

    def __init__(self, narrator: NarrationAgent) -> None:
        self._narrator = narrator

    async def run(self, ctx: InvestigationContext) -> None:
        output = await self._narrator.run(ctx)
        ctx.narration.sar_narrative = output.sar_narrative if ctx.sar_file else ""
        ctx.narration.what_changed = output.what_changed or "nothing"
        if not ctx.narration.stop_reason:
            ctx.narration.stop_reason = output.stop_reason


# ── helpers ──────────────────────────────────────────────────────────────────


async def _call(ctx: InvestigationContext, name: str, **args: object) -> ToolResult:
    """Dispatch one tool, count it against the budget, record its citation."""
    ctx.guard.record_tool_call()
    result = await ctx.tools.call(name, args)
    ctx.remember_ref(name, result.ref)
    ctx.emitter.emit(
        "tool.called",
        {
            "tool": name,
            "ref": result.ref,
            "params": {k: str(v) for k, v in args.items()},
            "entity_ids": list(result.entity_ids),
            "elapsed_s": round(result.elapsed_s, 3),
            "ok": result.ok,
            "error": result.error,
        },
        step=ctx.counter.current,
    )
    return result


#: Distinguishes "use whatever the context has" from "explicitly no response",
#: which is the difference between the initial and the final evaluation.
_UNSET: Any = object()


def _state(ctx: InvestigationContext, customer_response: Any = _UNSET) -> CaseState:
    response = ctx.customer_response if customer_response is _UNSET else customer_response
    return CaseStateBuilder(ctx.ledger).build(
        facts=ctx.facts,
        trigger_type=ctx.alert.trigger_type,
        exposure_usd=ctx.episode.exposure_usd if ctx.episode else 0.0,
        connected_card_ids=ctx.connected_card_ids,
        customer_response=response,
    )


def _policy_payload(
    ctx: InvestigationContext, state: CaseState, outcome: PolicyOutcome, phase: str
) -> dict[str, object]:
    return {
        "phase": phase,
        "fraud_probability": round(ctx.ledger.p, 4),
        "exposure_usd": state.exposure_usd,
        "verdict": state.verdict.value,
        "independent_support": state.independent_signals,
        "recommendations": [r.as_dict() for r in outcome.recommendations],
        "gates_applied": [gate.as_dict() for gate in outcome.gates if gate.fired],
        "sar": {"file": outcome.sar.file, "reason": outcome.sar.reason},
        "stop": {"should_stop": ctx.stop_before_request, "reason": ctx.narration.stop_reason},
    }


def _with(facts: ScopedFacts, **changes: object) -> ScopedFacts:
    """ScopedFacts is frozen, so accumulate by replacement."""
    from dataclasses import replace

    return replace(facts, **changes)  # type: ignore[arg-type]
