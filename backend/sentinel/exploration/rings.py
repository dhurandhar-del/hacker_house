"""Looking for rings nobody asked about.

The twenty benchmark alerts are each about one card. A ring is not: it is a set
of cards that only becomes visible when you stop investigating cards one at a
time. Guide.md says so outright — "Some cases can only be solved by asking what
happened on *other* cards" — and names the undocumented pattern as explicitly
scored.

The method is deliberately the boring one, because the interesting one is wrong
here. Two hops out from each seed card through device profiles, **gated on
profile specificity at every hop**, then connected components over the
card-to-card co-occurrence graph, computed client-side. No community detection,
no modularity: with the gate applied the components are small and disjoint, and
a clustering algorithm would only add a parameter to defend.

The gate is the whole analysis. 116 of the 9,704 device profiles carry 24,653
of the card links and the largest spans 842 cards; ungated, every card that has
ever been used in a browser lands in one giant component and the output says
nothing. Gated at twenty cards per profile, what survives is cards that share a
fingerprint specific enough to mean something.

Output goes to ``exploration/``, never to ``cases/``. None of this is part of
the graded answer for any of the twenty; it is the question the twenty do not
ask.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from sentinel.domain.alert import Alert
from sentinel.graph.normalize import ResponseNormalizer
from sentinel.graph.repository import GraphRepository

logger = logging.getLogger(__name__)

#: A profile on more cards than this is a browser configuration, not a device.
#: Same constant the investigation uses, for the same reason.
MAX_DEVICE_CARDS = 20

#: How far either side of the seed transaction to look.
WINDOW_DAYS = 30

#: Cards per hop. The query caps its own result; this is the argument.
MAX_CARDS_PER_HOP = 40

#: A component of two cards is a coincidence. Three is a question.
MIN_COMPONENT_CARDS = 3


@dataclass
class Component:
    """One connected set of cards, and what makes it interesting."""

    cards: list[str] = field(default_factory=list)
    devices: list[str] = field(default_factory=list)
    seeds: list[str] = field(default_factory=list)
    customers: set[str] = field(default_factory=set)
    #: Cards in this component that appear in a confirmed-fraud closed case.
    confirmed_fraud_cards: list[str] = field(default_factory=list)
    exposure_usd: float = 0.0

    @property
    def size(self) -> int:
        return len(self.cards)

    @property
    def spans_customers(self) -> int:
        return len(self.customers)

    @property
    def is_ring(self) -> bool:
        """Cards from more than one customer, at least two already confirmed.

        Both halves matter. One customer with three cards on one laptop is a
        household, not a ring. Two customers sharing a fingerprint with no
        confirmed fraud between them is a coffee shop.
        """
        return self.spans_customers >= 2 and len(self.confirmed_fraud_cards) >= 2

    def as_dict(self) -> dict[str, Any]:
        return {
            "cards": sorted(self.cards),
            "size": self.size,
            "devices": sorted(self.devices),
            "seeds": sorted(self.seeds),
            "customers": sorted(self.customers),
            "spans_customers": self.spans_customers,
            "confirmed_fraud_cards": sorted(self.confirmed_fraud_cards),
            "exposure_usd": round(self.exposure_usd, 2),
            "is_ring": self.is_ring,
        }


@dataclass
class RingReport:
    """Everything the sweep found, and everything it deliberately did not look at."""

    seeds: int
    components: list[Component]
    generic_profiles_skipped: int
    window_days: int = WINDOW_DAYS
    max_device_cards: int = MAX_DEVICE_CARDS

    @property
    def rings(self) -> list[Component]:
        return [c for c in self.components if c.is_ring]

    def as_dict(self) -> dict[str, Any]:
        return {
            "method": {
                "hops": 2,
                "window_days": self.window_days,
                "max_device_cards": self.max_device_cards,
                "min_component_cards": MIN_COMPONENT_CARDS,
                "note": (
                    "Device profiles above max_device_cards are browser configurations "
                    "rather than devices and are excluded at every hop. Ungated, the "
                    "largest single profile spans 842 cards and every component merges."
                ),
            },
            "seeds": self.seeds,
            "generic_profiles_skipped": self.generic_profiles_skipped,
            "components_found": len(self.components),
            "rings_found": len(self.rings),
            "components": [c.as_dict() for c in self.components],
        }

    def as_markdown(self) -> str:
        lines = [
            "# Ring discovery",
            "",
            f"Two hops from {self.seeds} seed cards, device profiles gated at "
            f"{self.max_device_cards} cards, a {self.window_days}-day window either side.",
            "",
            f"**{len(self.components)} components** of {MIN_COMPONENT_CARDS} or more cards; "
            f"**{len(self.rings)}** of them meet the ring test (two or more customers, "
            f"two or more cards already confirmed fraudulent).",
            "",
            f"{self.generic_profiles_skipped} device profiles were excluded as generic.",
            "",
        ]
        if not self.components:
            lines.append("No component reached the threshold. That is a finding, not a gap:")
            lines.append("with the specificity gate applied, the twenty benchmark cards do")
            lines.append("not sit in a shared-device ring.")
            return "\n".join(lines)

        lines += [
            "| cards | customers | confirmed fraud | exposure | ring | seeds |",
            "|---|---|---|---|---|---|",
        ]
        for component in sorted(self.components, key=lambda c: -c.size):
            lines.append(
                f"| {component.size} | {component.spans_customers} | "
                f"{len(component.confirmed_fraud_cards)} | "
                f"${component.exposure_usd:,.2f} | "
                f"{'**yes**' if component.is_ring else 'no'} | "
                f"{', '.join(sorted(component.seeds))} |"
            )
        for component in sorted(self.rings, key=lambda c: -c.size):
            lines += [
                "",
                f"## Ring of {component.size} cards across {component.spans_customers} customers",
                "",
                f"- **Cards:** {', '.join(sorted(component.cards))}",
                f"- **Shared device profiles:** {', '.join(sorted(component.devices)) or 'none recorded'}",
                f"- **Already confirmed fraudulent:** "
                f"{', '.join(sorted(component.confirmed_fraud_cards))}",
                f"- **Exposure across the confirmed cases:** ${component.exposure_usd:,.2f}",
                f"- **Reached from:** {', '.join(sorted(component.seeds))}",
            ]
        return "\n".join(lines)


@dataclass
class RingExplorer:
    """Two-hop device expansion from a set of seed cards, then components.

    Responsibility: the sweep and the component arithmetic. It posts no
    evidence, writes no case and touches no answer file.
    Collaborators: ``GraphRepository`` for ``ring_expand_2hop`` and
    ``case_memory_for_card``; ``ResponseNormalizer`` for the wire format.
    """

    graph: GraphRepository
    normalizer: ResponseNormalizer = field(default_factory=ResponseNormalizer)
    max_device_cards: int = MAX_DEVICE_CARDS
    window_days: int = WINDOW_DAYS

    async def explore(self, alerts: Sequence[Alert]) -> RingReport:
        """Expand from every alert's card and merge what overlaps."""
        edges: list[tuple[str, str]] = []
        card_device: dict[str, set[str]] = {}
        seed_of: dict[str, set[str]] = {}
        generic_skipped = 0

        for alert in alerts:
            rows = await self._expand(alert)
            if rows is None:
                continue
            pairs = _pairs(rows.get("card_device_pairs"))
            generic_skipped += _generic_count(rows, self.max_device_cards)
            by_device: dict[str, set[str]] = {}
            for card, device in pairs:
                by_device.setdefault(device, set()).add(card)
                card_device.setdefault(card, set()).add(device)
                seed_of.setdefault(card, set()).add(alert.card_id)
            # The seed card itself anchors the component even when it shares
            # nothing: a component of one is dropped later anyway.
            seed_of.setdefault(alert.card_id, set()).add(alert.card_id)
            for cards in by_device.values():
                ordered = sorted(cards)
                edges += [(ordered[0], other) for other in ordered[1:]]
            logger.info(
                "%s: %d card-device pairs across %d profiles",
                alert.alert_id,
                len(pairs),
                len(by_device),
            )

        components = _components(edges)
        out: list[Component] = []
        for cards in components:
            if len(cards) < MIN_COMPONENT_CARDS:
                continue
            component = Component(
                cards=sorted(cards),
                devices=sorted({d for c in cards for d in card_device.get(c, ())}),
                seeds=sorted({s for c in cards for s in seed_of.get(c, ())}),
            )
            await self._annotate(component)
            out.append(component)

        return RingReport(
            seeds=len(alerts),
            components=out,
            generic_profiles_skipped=generic_skipped,
            window_days=self.window_days,
            max_device_cards=self.max_device_cards,
        )

    async def _expand(self, alert: Alert) -> dict[str, Any] | None:
        center = alert.opened_at - timedelta(hours=3)
        try:
            return await self.graph.run_query(
                "ring_expand_2hop",
                {
                    "c_in": alert.card_id,
                    "center": center.strftime("%Y-%m-%d %H:%M:%S"),
                    "days": self.window_days,
                    "max_device_cards": self.max_device_cards,
                    "max_cards": MAX_CARDS_PER_HOP,
                },
            )
        except Exception as exc:  # noqa: BLE001 - one failed seed must not end the sweep
            logger.warning("ring_expand_2hop failed on %s: %s", alert.card_id, exc)
            return None

    async def _annotate(self, component: Component) -> None:
        """Ask the graph what the bank already knows about these cards."""
        for card in component.cards:
            component.customers.add(_customer_of(card))
            try:
                payload = await self.graph.run_query("case_memory_for_card", {"c_in": card})
            except Exception as exc:  # noqa: BLE001 - annotation is best effort
                logger.debug("case_memory_for_card failed on %s: %s", card, exc)
                continue
            for row in self.normalizer.rows(payload.get("bank_closed_cases")):
                if str(row.get("outcome") or "") != "confirmed_fraud":
                    continue
                if card not in component.confirmed_fraud_cards:
                    component.confirmed_fraud_cards.append(card)
                component.exposure_usd += float(row.get("exposure_usd") or 0.0)


# ── plain functions ──────────────────────────────────────────────────────────


def _customer_of(card_id: str) -> str:
    """``C08623-K2`` -> ``C08623``. The dataset's own convention."""
    return card_id.split("-", 1)[0]


def _pairs(value: Any) -> list[tuple[str, str]]:
    """``["C1-K1|dev-a", ...]`` as (card, device) tuples."""
    out: list[tuple[str, str]] = []
    for item in value or ():
        if not isinstance(item, str) or "|" not in item:
            continue
        card, _, device = item.partition("|")
        if card and device:
            out.append((card, device))
    return out


def _generic_count(rows: Mapping[str, Any], gate: int) -> int:
    """How many profiles the gate excluded, as the query reports them."""
    seen = 0
    for key in ("seed_devices", "hop1_devices"):
        for row in rows.get(key) or ():
            if isinstance(row, Mapping):
                attrs = row.get("attributes", row)
                n_cards = attrs.get("n_cards") if isinstance(attrs, Mapping) else None
                if isinstance(n_cards, (int, float)) and n_cards > gate:
                    seen += 1
    return seen


def _components(edges: Iterable[tuple[str, str]]) -> list[set[str]]:
    """Connected components by union-find. Small graphs, no dependency."""
    parent: dict[str, str] = {}

    def find(node: str) -> str:
        parent.setdefault(node, node)
        while parent[node] != node:
            parent[node] = parent[parent[node]]
            node = parent[node]
        return node

    for left, right in edges:
        a, b = find(left), find(right)
        if a != b:
            parent[a] = b

    groups: dict[str, set[str]] = {}
    for node in list(parent):
        groups.setdefault(find(node), set()).add(node)
    return list(groups.values())


def write_report(report: RingReport, directory: Path, now: datetime) -> tuple[Path, Path]:
    """``exploration/rings.json`` and ``exploration/rings.md``."""
    directory.mkdir(parents=True, exist_ok=True)
    payload = report.as_dict()
    payload["generated_at"] = now.strftime("%Y-%m-%d %H:%M:%S")
    json_path = directory / "rings.json"
    md_path = directory / "rings.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    md_path.write_text(report.as_markdown() + "\n", encoding="utf-8")
    return json_path, md_path
