"""The evidence ledger: a running, auditable fraud probability.

Every finding is posted as a likelihood ratio drawn from the fitted table in
`elt.json`, and the probability is the sigmoid of the accumulated log-odds. One
data structure serves three deliverables at once:

  * `fraud_probability` in the answer file, calibrated rather than asserted
  * the `evidence` list, because every posting carries its claim and its query
  * the probability trajectory the UI draws and `what_changed` describes

Two rules keep it honest.

**Correlated evidence is capped by group.** "New device", "device never used on
this card" and "proxy present" are three phrasings of one observation. Without a
cap they multiply and a single fact drives the probability past 0.9 on its own.

**Absence is evidence.** A detector that runs and finds nothing posts its
`lr_absent`, which is usually just below 1. That is what lets an agent argue a
case is legitimate instead of merely failing to find anything.
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

ELT_PATH = Path(__file__).with_name("elt.json")

#: Total log-odds any one evidence group may contribute, in either direction.
#: exp(1.2) is about 3.3x, so one group can move 0.50 to roughly 0.77 alone.
GROUP_CAP = 1.2


def _load_elt() -> dict:
    if not ELT_PATH.exists():
        raise RuntimeError(
            f"{ELT_PATH.name} is missing. Fit it first: python -m eval.fit_elt"
        )
    return json.loads(ELT_PATH.read_text(encoding="utf-8"))


@dataclass
class Posting:
    """One finding, and what it did to the probability."""

    feature: str
    present: bool
    lr: float
    log_lr: float
    p_before: float
    p_after: float
    claim: str
    ref: str
    source: str = "graph"
    entity_ids: list[str] = field(default_factory=list)
    capped: bool = False

    def as_evidence(self) -> dict[str, Any]:
        """The answer file's evidence shape."""
        return {
            "claim": self.claim,
            "source": self.source,
            "ref": self.ref,
            "entity_ids": list(self.entity_ids),
        }


class Ledger:
    """Accumulates log-odds and remembers why."""

    def __init__(self, trigger_type: str = "risk_score", elt: dict | None = None):
        self.elt = elt or _load_elt()
        self.features: dict[str, dict] = self.elt["features"]
        priors = self.elt.get("trigger_priors", {})
        prior = priors.get(trigger_type, {}).get("prior_used", 0.5)
        self.trigger_type = trigger_type
        self.prior = prior
        self.log_odds = math.log(prior / (1 - prior))
        self.postings: list[Posting] = []
        self._group_total: dict[str, float] = {}

    # -- probability ---------------------------------------------------------

    @property
    def p(self) -> float:
        return 1.0 / (1.0 + math.exp(-self.log_odds))

    @property
    def trajectory(self) -> list[float]:
        return [round(self.prior, 4)] + [round(x.p_after, 4) for x in self.postings]

    # -- posting -------------------------------------------------------------

    def post(self, feature: str, present: bool, claim: str, ref: str,
             entity_ids: list[str] | None = None, source: str = "graph",
             weight: float = 1.0) -> Posting:
        """Record a finding. `present` False posts the absence likelihood."""
        spec = self.features.get(feature)
        if spec is None:
            raise KeyError(f"{feature!r} is not in the fitted table")

        lr = spec["lr_present"] if present else spec["lr_absent"]
        log_lr = math.log(lr) * weight

        group = spec.get("group", feature)
        used = self._group_total.get(group, 0.0)
        capped = False
        if abs(used + log_lr) > GROUP_CAP:
            room = max(GROUP_CAP - abs(used), 0.0)
            log_lr = math.copysign(room, log_lr)
            capped = True
        self._group_total[group] = used + log_lr

        p_before = self.p
        self.log_odds += log_lr
        posting = Posting(
            feature=feature, present=present, lr=round(lr, 4), log_lr=round(log_lr, 4),
            p_before=round(p_before, 4), p_after=round(self.p, 4), claim=claim, ref=ref,
            source=source, entity_ids=entity_ids or [], capped=capped,
        )
        self.postings.append(posting)
        return posting

    def post_response(self, claim: str, ref: str, log_lr: float,
                      entity_ids: list[str] | None = None) -> Posting:
        """Post a customer or analyst response, which has no fitted LR.

        Responses are not in the table -- the closed cases record outcomes, not
        what customers said mid-investigation -- so the weight is a stated
        judgement rather than a fitted one, and it is capped like anything else.
        """
        group = "response"
        used = self._group_total.get(group, 0.0)
        capped = False
        if abs(used + log_lr) > GROUP_CAP * 1.5:
            room = max(GROUP_CAP * 1.5 - abs(used), 0.0)
            log_lr = math.copysign(room, log_lr)
            capped = True
        self._group_total[group] = used + log_lr

        p_before = self.p
        self.log_odds += log_lr
        posting = Posting(
            feature="response", present=True, lr=round(math.exp(log_lr), 4),
            log_lr=round(log_lr, 4), p_before=round(p_before, 4), p_after=round(self.p, 4),
            claim=claim, ref=ref, source="customer", entity_ids=entity_ids or [],
            capped=capped,
        )
        self.postings.append(posting)
        return posting

    # -- outputs -------------------------------------------------------------

    def evidence(self) -> list[dict[str, Any]]:
        return [p.as_evidence() for p in self.postings]

    def top_drivers(self, n: int = 3) -> list[Posting]:
        """The postings that moved the number most, for `what_changed`."""
        return sorted(self.postings, key=lambda x: abs(x.log_lr), reverse=True)[:n]

    def independent_support(self) -> int:
        """How many distinct evidence groups actually moved the number.

        Policy section 6 requires two independent pieces of evidence before
        stopping, so 'independent' has to mean distinct groups, not distinct
        postings -- otherwise three restatements of one device finding would
        satisfy it.
        """
        return sum(1 for total in self._group_total.values() if abs(total) > 0.05)

    def explain(self) -> str:
        lines = [f"prior {self.prior:.2f} ({self.trigger_type})"]
        for post in self.postings:
            arrow = "up  " if post.log_lr > 0 else "down"
            mark = " [capped]" if post.capped else ""
            lines.append(
                f"  {post.p_before:.2f} -> {post.p_after:.2f}  {arrow} "
                f"LR {post.lr:>6.2f}  {post.feature}{mark}"
            )
        lines.append(f"final {self.p:.2f}")
        return "\n".join(lines)
