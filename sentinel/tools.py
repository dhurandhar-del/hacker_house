"""The agent's hands: one Python wrapper per installed GSQL query.

Every call is recorded in a QueryLog and every result carries the exact
invocation string that produced it. That string becomes the `ref` on an evidence
item in the answer file, so an analyst reading a case can re-run any single line
of it. Build the citation once, here, and explainability is free everywhere else.

These wrappers return facts. No wrapper decides whether something is fraud; that
belongs to the ledger and the policy engine, which are unit-testable.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any


@dataclass
class ToolResult:
    """What one graph call produced, with its citation already formed."""

    tool: str
    ref: str
    data: dict[str, Any]
    entity_ids: list[str] = field(default_factory=list)
    elapsed_s: float = 0.0

    def get(self, key: str, default=None):
        return self.data.get(key, default)


@dataclass
class QueryLog:
    """Every graph call made during one investigation."""

    calls: list[ToolResult] = field(default_factory=list)

    def record(self, result: ToolResult) -> ToolResult:
        self.calls.append(result)
        return result

    @property
    def count(self) -> int:
        return len(self.calls)

    @property
    def total_seconds(self) -> float:
        return sum(c.elapsed_s for c in self.calls)

    def refs(self) -> list[str]:
        return [c.ref for c in self.calls]


def _fmt_ref(name: str, params: dict[str, Any]) -> str:
    inner = ", ".join(f"{k}={v}" for k, v in params.items())
    return f"query:{name}({inner})"


def _flatten(raw: list[dict]) -> dict[str, Any]:
    """TigerGraph returns a list of single-key blocks; merge into one dict."""
    out: dict[str, Any] = {}
    for block in raw or []:
        for key, value in block.items():
            out[key] = value
    return out


class GraphTools:
    """Sixteen named questions the agent can ask the graph."""

    def __init__(self, conn, log: QueryLog | None = None):
        self.conn = conn
        self.log = log or QueryLog()

    # -- plumbing ------------------------------------------------------------

    #: Parameters declared VERTEX<T> in GSQL. pyTigerGraph wants these as
    #: 1-tuples; a bare id falls back to a deprecated GET path.
    VERTEX_PARAMS = {"t_in", "c_in", "d_in", "r_in", "e_in"}

    def _run(self, name: str, params: dict[str, Any], entity_ids: list[str] | None = None,
             ref_params: dict[str, Any] | None = None) -> ToolResult:
        wire = {k: ((v,) if k in self.VERTEX_PARAMS else v) for k, v in params.items()}
        t0 = time.time()
        raw = self.conn.runInstalledQuery(name, wire, timeout=120_000)
        result = ToolResult(
            tool=name,
            ref=_fmt_ref(name, ref_params or params),
            data=_flatten(raw),
            entity_ids=entity_ids or [],
            elapsed_s=time.time() - t0,
        )
        return self.log.record(result)

    # -- 1-3: the alert and what normal looks like ---------------------------

    def txn_detail(self, txn_id: str) -> ToolResult:
        return self._run("txn_detail", {"t_in": txn_id}, [txn_id],
                         {"txn_id": txn_id})

    def card_baseline(self, card_id: str) -> ToolResult:
        return self._run("card_baseline", {"c_in": card_id}, [card_id],
                         {"card_id": card_id})

    def card_window(self, card_id: str, center: str, hours: int = 72) -> ToolResult:
        return self._run("card_window", {"c_in": card_id, "center": center, "hours": hours},
                         [card_id], {"card_id": card_id, "center": center, "hours": hours})

    # -- 4-7: the pattern detectors ------------------------------------------

    def card_testing_probe(self, card_id: str, center: str, small_amt: float = 5.0) -> ToolResult:
        return self._run("card_testing_probe",
                         {"c_in": card_id, "center": center, "small_amt": small_amt},
                         [card_id],
                         {"card_id": card_id, "center": center, "small_amt": small_amt})

    def region_novelty(self, card_id: str, region: str, as_of: str) -> ToolResult:
        """Novelty as of a moment, never over the whole file. See LOADING.md."""
        return self._run("region_novelty",
                         {"c_in": card_id, "region": region, "as_of": as_of},
                         [card_id, region],
                         {"card_id": card_id, "region": region, "as_of": as_of})

    def amount_band_probe(self, card_id: str, amt: float, as_of: str,
                          tol: float = 0.5) -> ToolResult:
        return self._run("amount_band_probe",
                         {"c_in": card_id, "amt": amt, "tol": tol, "as_of": as_of},
                         [card_id],
                         {"card_id": card_id, "amt": amt, "tol": tol, "as_of": as_of})

    def device_novelty(self, txn_id: str) -> ToolResult:
        return self._run("device_novelty", {"t_in": txn_id}, [txn_id], {"txn_id": txn_id})

    # -- 8-11: connections between cards -------------------------------------

    def device_neighbors(self, device_key: str, center: str, days: int = 30) -> ToolResult:
        return self._run("device_neighbors",
                         {"d_in": device_key, "center": center, "days": days},
                         [device_key],
                         {"device_key": device_key, "center": center, "days": days})

    def region_cluster(self, region: str, win_from: str, win_to: str, base_from: str,
                       base_to: str, risk_thresh: float = 0.7) -> ToolResult:
        """Always against a matched baseline window; a raw count proves nothing."""
        return self._run("region_cluster",
                         {"r_in": region, "win_from": win_from, "win_to": win_to,
                          "base_from": base_from, "base_to": base_to,
                          "risk_thresh": risk_thresh},
                         [region],
                         {"region": region, "window": f"{win_from}..{win_to}",
                          "baseline": f"{base_from}..{base_to}", "risk_thresh": risk_thresh})

    def email_cluster(self, domain: str, center: str, days: int = 30,
                      risk_thresh: float = 0.7) -> ToolResult:
        return self._run("email_cluster",
                         {"e_in": domain, "center": center, "days": days,
                          "risk_thresh": risk_thresh},
                         [domain],
                         {"domain": domain, "center": center, "days": days})

    def ring_expand(self, card_id: str, center: str, days: int = 30,
                    max_device_cards: int = 20) -> ToolResult:
        """Cards linked by a *specific* shared device.

        max_device_cards excludes generic browser fingerprints. Without it this
        returns a phantom ring for almost any card that has ever been used
        online. See docs/HAND_INVESTIGATION.md.
        """
        return self._run("ring_expand",
                         {"c_in": card_id, "center": center, "days": days,
                          "max_device_cards": max_device_cards},
                         [card_id],
                         {"card_id": card_id, "center": center, "days": days,
                          "max_device_cards": max_device_cards})

    # -- 12-13: behaviour over time ------------------------------------------

    def recurring_charge_probe(self, card_id: str, amt: float, product: str = "",
                               tol: float = 0.5) -> ToolResult:
        return self._run("recurring_charge_probe",
                         {"c_in": card_id, "amt": amt, "tol": tol, "product": product},
                         [card_id],
                         {"card_id": card_id, "amt": amt, "product": product})

    def velocity_probe(self, card_id: str, center: str, hours: int = 48) -> ToolResult:
        return self._run("velocity_probe", {"c_in": card_id, "center": center, "hours": hours},
                         [card_id], {"card_id": card_id, "center": center, "hours": hours})

    # -- 14-16: memory --------------------------------------------------------

    def customer_case_history(self, customer_id: str) -> ToolResult:
        """Includes the denial track record: how often this customer was right."""
        return self._run("customer_case_history", {"customer_id": customer_id},
                         [customer_id], {"customer_id": customer_id})

    def similar_prior_cases(self, pattern: str = "", amt_lo: float = 0.0,
                            amt_hi: float = 1e9, outcome: str = "", k: int = 10) -> ToolResult:
        return self._run("similar_prior_cases",
                         {"pattern_in": pattern, "amt_lo": amt_lo, "amt_hi": amt_hi,
                          "outcome_in": outcome, "k": k},
                         [],
                         {"pattern": pattern or "any", "exposure": f"{amt_lo}..{amt_hi}",
                          "outcome": outcome or "any", "k": k})

    def case_memory_for_card(self, card_id: str) -> ToolResult:
        """Bank closed cases AND cases Sentinel itself wrote earlier in the run."""
        return self._run("case_memory_for_card", {"c_in": card_id}, [card_id],
                         {"card_id": card_id})


TOOL_NAMES = [
    "txn_detail", "card_baseline", "card_window", "card_testing_probe", "region_novelty",
    "amount_band_probe", "device_novelty", "device_neighbors", "region_cluster",
    "email_cluster", "ring_expand", "recurring_charge_probe", "velocity_probe",
    "customer_case_history", "similar_prior_cases", "case_memory_for_card",
]
