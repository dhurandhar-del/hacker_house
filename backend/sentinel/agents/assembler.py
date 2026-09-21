"""Turning a finished investigation into the file that gets graded.

This is where the rule that no answer field comes from free-form model text
stops being an intention and becomes a type. Every value below is either read
off a computed object — the policy engine's recommendations, the ledger's
probability, the episode scoper's exposure, the tool log's counters — or taken
from ``Narration``, whose fields are the seven prose strings the brief allows.

There is no third source.
"""

from __future__ import annotations

from dataclasses import dataclass

from sentinel.agents.context import InvestigationContext
from sentinel.domain.answer import (
    ActionRecommendation,
    AnswerFile,
    Case,
    Evidence,
    EvidenceRequest,
    NextBestActions,
    SarReport,
)
from sentinel.domain.enums import Action, CaseStatus, Verdict


@dataclass
class AnswerAssembler:
    """Builds the answer file from the context, and nothing else.

    Responsibility: field-by-field construction of the graded artefact, plus the
    two consistency choices the format forces — status follows verdict and the
    actions taken, and `final` deep-equals `initial` when nothing was asked.
    Collaborators: read-only over ``InvestigationContext``.
    """

    created_by: str = "sentinel"

    def assemble(self, ctx: InvestigationContext) -> AnswerFile:
        episode = ctx.episode
        affected = list(episode.affected_txn_ids) if episode else []
        exposure = episode.exposure_usd if episode else 0.0
        first = episode.first_suspicious_txn_id if episode else ""

        # A legitimate verdict forces an empty episode, zero exposure and no
        # report. The scoper already enforces the first two; this is the second
        # gate, because the contract is checked on the file, not on the object.
        if ctx.verdict is Verdict.LEGITIMATE:
            affected, exposure, first = [], 0.0, ""

        case = Case(
            status=self._status(ctx),
            verdict=ctx.verdict,
            fraud_probability=round(ctx.ledger.p, 4),
            pattern=ctx.pattern,
            pattern_description=ctx.narration.pattern_description,
            affected_txn_ids=affected,
            first_suspicious_txn_id=first,
            connected_card_ids=list(ctx.connected_card_ids),
            connected_device_profiles=list(ctx.connected_device_profiles),
            exposure_usd=exposure,
            evidence=self._evidence(ctx),
            similar_prior_cases=list(ctx.similar_prior_cases),
            summary=ctx.narration.summary,
            written_to_graph=False,  # set by the write-back, not claimed here
            graph_case_id="",
        )

        return AnswerFile(
            case_id=ctx.alert.alert_id,
            case=case,
            evidence_requests=self._requests(ctx),
            next_best_actions=self._actions(ctx),
            sar=self._sar(ctx, exposure, affected),
            stop_reason=ctx.narration.stop_reason,
            tool_calls=ctx.tools.log.count,
            tokens=ctx.budget.meter.tokens,
            latency_s=round(ctx.budget.elapsed_s, 2),
        )

    # ── the parts ────────────────────────────────────────────────────────────

    @staticmethod
    def _status(ctx: InvestigationContext) -> CaseStatus:
        """Where the case stands, read off the verdict and what was recommended.

        `open` means evidence is still pending, which cannot be true here: the
        run has finished and the simulated response has already come back.
        """
        actions = {rec.action for rec in ctx.final}
        if Action.ESCALATE_TO_ANALYST in actions:
            return CaseStatus.ESCALATED
        if ctx.verdict is Verdict.FRAUD:
            return CaseStatus.CLOSED_FRAUD
        if ctx.verdict is Verdict.LEGITIMATE:
            return CaseStatus.CLOSED_LEGITIMATE
        return CaseStatus.OPEN

    @staticmethod
    def _evidence(ctx: InvestigationContext) -> list[Evidence]:
        """Every ledger posting, in the order it was made."""
        return [
            Evidence(
                claim=posting.claim,
                source=posting.source,
                ref=posting.ref,
                entity_ids=list(posting.entity_ids),
            )
            for posting in ctx.ledger.postings
        ]

    @staticmethod
    def _requests(ctx: InvestigationContext) -> list[EvidenceRequest]:
        if ctx.response is None or ctx.evidence_request_step is None:
            return []
        return [
            EvidenceRequest(
                type=ctx.response.request_type,
                # The same counter the SSE stream numbered its steps with.
                asked_after_step=ctx.evidence_request_step,
                assumed_response=ctx.response.assumed_response,
            )
        ]

    @staticmethod
    def _actions(ctx: InvestigationContext) -> NextBestActions:
        initial = [
            ActionRecommendation(action=r.action, route=r.route, reason=r.reason)
            for r in ctx.initial
        ]
        if ctx.response is None:
            # Nothing was asked, so the two lists must be identical — the
            # validator compares them deeply, reason strings included.
            return NextBestActions(
                initial=initial, final=list(initial), what_changed="nothing"
            )
        final = [
            ActionRecommendation(action=r.action, route=r.route, reason=r.reason)
            for r in ctx.final
        ]
        return NextBestActions(
            initial=initial,
            final=final,
            what_changed=ctx.narration.what_changed or "nothing",
        )

    @staticmethod
    def _sar(
        ctx: InvestigationContext, exposure: float, affected: list[str]
    ) -> SarReport:
        """The filing decision comes from the policy engine, never from prose."""
        if not ctx.sar_file:
            return SarReport(
                file=False,
                reason=ctx.sar_reason,
                narrative="",
                subjects=[],
                total_amount_usd=0,
                activity_dates=[],
            )
        subjects = [ctx.alert.customer_id, ctx.alert.card_id, *ctx.connected_card_ids]
        return SarReport(
            file=True,
            reason=ctx.sar_reason,
            narrative=ctx.narration.sar_narrative,
            subjects=[s for s in dict.fromkeys(subjects) if s],
            total_amount_usd=exposure,
            activity_dates=_activity_dates(ctx, affected),
        )


def _activity_dates(ctx: InvestigationContext, affected: list[str]) -> list[str]:
    """First and last date of the episode, `YYYY-MM-DD`, exactly two entries."""
    rows = []
    if ctx.window is not None:
        rows = [row for row in ctx.window.window if row.txn_id in set(affected)]
    if not rows and ctx.txn is not None:
        rows = [ctx.txn]
    stamps = sorted(row.ts for row in rows if row.ts is not None)
    if not stamps:
        return []
    return [stamps[0].strftime("%Y-%m-%d"), stamps[-1].strftime("%Y-%m-%d")]
