"use client";

/**
 * Ring discovery, and the result it actually produced.
 *
 * The honest answer on this pack is **no ring**, and this screen says so in
 * the largest type on the page rather than burying it. That is not a failure
 * to show: a fraud console that can only draw a ring when there is one is a
 * console that will draw one when there is not.
 *
 * What it draws instead is the measurement that rules the second hop out. At
 * one hop no two seeds share a device at all, so there is literally nothing
 * to draw there. One hop further and they fall into a single component of
 * roughly 1,380 cards — the failure mode R6's specificity gate exists to
 * prevent, sitting one hop away. The canvas draws that: the real device
 * profiles and the real cards on them, from `exploration/rings.json`. The
 * hairball is the argument.
 *
 * When a sweep does find components, the same canvas draws them: seeds in
 * danger, members in accent, the shared device at the centre, edges walking
 * under the `trace` animation and a sweep ring turning over the whole thing.
 */

import { useMemo } from "react";

import { Icon } from "@/components/console/icons";
import { ConsoleChip, Overline, StatTile } from "@/components/console/parts";
import { money, toneVar } from "@/components/console/vm";
import { useRings } from "@/lib/hooks";
import type { RingComponent, RingDeviceLink } from "@/lib/generated/contract";

const W = 900;
const H = 620;
const CX = W / 2;
const CY = H / 2;

/** The profile ring. Bridging cards are placed at a fraction of it. */
const DEVICE_RX = 332;
const DEVICE_RY = 234;

/** Keep-out margins for labels: the frame, and the caption strip. */
const LABEL_INSET = 74;
const CAPTION_BAND = 120;

/** How many of the busiest shared cards get named, and how busy is busy. */
const HUB_LABELS = 5;
const HUB_DEGREE = 8;

interface Dot {
  x: number;
  y: number;
  r: number;
  label: string;
  sub: string;
  tone: "danger" | "accent" | "info" | "neutral";
  /** A seed card: one of the twenty the benchmark actually asks about. */
  seed?: boolean;
  /** How many devices this card sits on. 1 is a leaf, >1 holds the component together. */
  degree?: number;
  /** Extra radial distance for this node's label, to clear a neighbour's. */
  labelOut?: number;
}

interface Layout {
  dots: Dot[];
  edges: [number, number][];
  /** True when every drawn node is reachable from every other. Measured. */
  connected: boolean;
  devices: number;
  cards: number;
  bridges: number;
  /** Cards on exactly one profile, left out because they connect nothing. */
  hidden: number;
}

const EMPTY_LAYOUT: Layout = {
  dots: [],
  edges: [],
  connected: false,
  devices: 0,
  cards: 0,
  bridges: 0,
  hidden: 0,
};

/**
 * The recorded neighbourhood, reduced to the part that carries the claim.
 *
 * The sweep records 48 device profiles and the 268 cards on them. Drawing all
 * of that produces a sea urchin: 208 of those cards sit on exactly one
 * profile, so they are leaves that contribute a spoke each and not one edge
 * of connectivity. Removing them leaves 48 profiles and the 60 cards that sit
 * on more than one — 108 nodes, still a single connected component, and now
 * a picture rather than a texture. `connected` is measured on what is drawn,
 * never asserted, because an earlier version capped the sample in a way that
 * split the graph in two while the caption went on claiming one.
 *
 * Two placement rules do the work:
 *
 * **Profiles ring the outside, ordered by what they share.** In file order a
 * profile's partners land opposite it and every chord crosses the middle.
 * Ordered greedily — each next profile the one sharing most cards with the
 * last — the component's chain becomes an arc you can follow round.
 *
 * **A bridging card sits inside, at the vector mean of its profiles.** So a
 * card joining two adjacent profiles tucks just inside them, and one joining
 * opposite sides of the ring sits near the centre with two long chords. Where
 * the middle is busy, the component is genuinely tangled there.
 *
 * Seed cards — the ones the benchmark actually asks about — are always drawn
 * even when they are leaves, ringed and named, because "is my case in here"
 * is the first question anyone asks of this screen.
 */
function layoutExamined(links: RingDeviceLink[], seedCards: Set<string>): Layout {
  if (links.length === 0) {
    return EMPTY_LAYOUT;
  }

  const cardsOf = new Map(links.map((link) => [link.device, new Set(link.cards)]));
  const order = orderByOverlap(links, cardsOf);

  const onDevices = new Map<string, string[]>();
  for (const link of links) {
    for (const card of link.cards) {
      const list = onDevices.get(card);
      if (list) list.push(link.device);
      else onDevices.set(card, [link.device]);
    }
  }
  const drawnCards = [...onDevices.entries()]
    .filter(([card, devices]) => devices.length > 1 || seedCards.has(card))
    .sort((a, b) => a[0].localeCompare(b[0]));
  // The handful of cards that sit on many profiles at once are the most
  // interesting thing on the screen — a single card seen on twenty-one
  // separate device fingerprints inside a month is the shape everyone came
  // looking for, even though it does not clear R6's gates. Name them.
  const hubs = new Set(
    [...drawnCards]
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .slice(0, HUB_LABELS)
      .filter(([, devices]) => devices.length >= HUB_DEGREE)
      .map(([card]) => card),
  );
  const bridges = drawnCards.filter(([, devices]) => devices.length > 1).length;
  const hidden = onDevices.size - drawnCards.length;

  const angleOf = new Map<string, number>();
  const dots: Dot[] = [];
  order.forEach((device, index) => {
    const angle = -Math.PI / 2 + (index / order.length) * Math.PI * 2;
    angleOf.set(device, angle);
    dots.push({
      x: CX + Math.cos(angle) * DEVICE_RX,
      y: CY + Math.sin(angle) * DEVICE_RY,
      r: 8,
      label: "",
      sub: "",
      tone: "danger",
    });
  });
  const deviceAt = new Map(order.map((device, index) => [device, index]));

  const cardsFrom = dots.length;
  const cardAt = new Map<string, number>();
  for (const [card, devices] of drawnCards) {
    // Mean of unit vectors, not of radians: averaging 350° and 10° the naive
    // way puts the card at 180°, on the far side of the ring.
    let sx = 0;
    let sy = 0;
    for (const device of devices) {
      const angle = angleOf.get(device) ?? 0;
      sx += Math.cos(angle);
      sy += Math.sin(angle);
    }
    const angle = Math.atan2(sy, sx);
    const bridge = devices.length > 1;
    // A wider spread between a card's profiles pulls it further in, so the
    // depth of a chord says how far apart the profiles it joins are.
    const tightness = Math.hypot(sx, sy) / devices.length;
    const pull = bridge ? 0.30 + tightness * 0.42 : 1.14;
    cardAt.set(card, dots.length);
    dots.push({
      x: CX + Math.cos(angle) * DEVICE_RX * pull,
      y: CY + Math.sin(angle) * DEVICE_RY * pull,
      r: seedCards.has(card) ? 8 : 3.4 + Math.min(devices.length, 12) * 0.8,
      label: seedCards.has(card) || hubs.has(card) ? card : "",
      sub: seedCards.has(card)
        ? bridge
          ? `benchmark seed · ${devices.length} profiles`
          : "benchmark seed"
        : hubs.has(card)
          ? `${devices.length} profiles`
          : "",
      tone: "accent",
      seed: seedCards.has(card),
      degree: devices.length,
    });
  }

  spread(dots, cardsFrom);
  declutterLabels(dots);

  const edges: [number, number][] = [];
  for (const link of links) {
    const from = deviceAt.get(link.device);
    if (from === undefined) continue;
    for (const card of link.cards) {
      const to = cardAt.get(card);
      if (to !== undefined) edges.push([from, to]);
    }
  }

  return {
    dots,
    edges,
    connected: isConnected(dots.length, edges),
    devices: order.length,
    cards: cardAt.size,
    bridges,
    hidden,
  };
}

/**
 * Order profiles so that neighbours in the drawing are neighbours in the graph.
 *
 * A depth-first walk of the profile-to-profile graph induced by shared cards,
 * strongest edge first. The walk matters: a greedy "take whoever shares most
 * with the last one" chain looks equivalent and is not, because the moment it
 * reaches a profile whose partners are all placed it has no move left and
 * falls back to alphabetical — which on this data was most of the ring, and
 * is why every chord crossed the middle. A DFS backtracks instead, so a
 * profile is almost always placed next to one it actually shares a card with
 * and the chords stay short.
 *
 * Deterministic throughout: neighbours are sorted by shared count then by id,
 * and the start is the profile with the most partners, ties by id. The same
 * sweep always draws the same picture.
 */
function orderByOverlap(
  links: RingDeviceLink[],
  cardsOf: Map<string, Set<string>>,
): string[] {
  const names = links.map((link) => link.device).sort((a, b) => a.localeCompare(b));

  const shared = (a: string, b: string): number => {
    const left = cardsOf.get(a);
    const right = cardsOf.get(b);
    if (!left || !right) return 0;
    let count = 0;
    for (const card of left) if (right.has(card)) count += 1;
    return count;
  };

  const neighbours = new Map<string, string[]>();
  for (const name of names) {
    const partners = names
      .filter((other) => other !== name && shared(name, other) > 0)
      .sort((a, b) => shared(name, b) - shared(name, a) || a.localeCompare(b));
    neighbours.set(name, partners);
  }

  const start = [...names].sort(
    (a, b) =>
      (neighbours.get(b)?.length ?? 0) - (neighbours.get(a)?.length ?? 0) ||
      a.localeCompare(b),
  )[0];

  const seen = new Set<string>();
  const order: string[] = [];
  const stack: string[] = start ? [start] : [];
  while (stack.length > 0) {
    const device = stack.pop();
    if (device === undefined || seen.has(device)) continue;
    seen.add(device);
    order.push(device);
    // Reversed, so the strongest partner comes off the stack first.
    const partners = neighbours.get(device) ?? [];
    for (let index = partners.length - 1; index >= 0; index -= 1) {
      const partner = partners[index];
      if (partner !== undefined && !seen.has(partner)) stack.push(partner);
    }
  }
  // A profile sharing with nobody cannot be reached by the walk. On this pack
  // there are none, but the layout must not silently drop one if there are.
  for (const name of names) if (!seen.has(name)) order.push(name);
  return order;
}

/**
 * Push a label further out when it would land on another one.
 *
 * Radial placement fans most labels apart on its own, but where three named
 * nodes sit in the same corner — two busy shared cards and a seed, on this
 * pack — their labels still stack. Each one that collides is pushed further
 * along its own radius until it is clear, so it stays attached to the right
 * node and only the distance changes.
 */
function declutterLabels(dots: Dot[]): void {
  const placed: { x: number; y: number }[] = [];
  const clash = (x: number, y: number): boolean =>
    placed.some((other) => Math.abs(other.x - x) < 90 && Math.abs(other.y - y) < 26);

  for (const dot of dots) {
    if (!dot.label) continue;
    const dx = dot.x - CX;
    const dy = dot.y - CY;
    const length = Math.hypot(dx, dy) || 1;
    let out = 0;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const x = dot.x + (dx / length) * (dot.r + 13 + out);
      const y = dot.y + (dy / length) * (dot.r + 13 + out);
      if (!clash(x, y)) {
        placed.push({ x, y });
        break;
      }
      out += 30;
    }
    dot.labelOut = out;
  }
}

/**
 * Nudge coincident nodes apart along their own radius.
 *
 * Bridging cards are placed at the mean angle of their profiles, so two cards
 * joining the same pair land on the same point and read as one. Spreading
 * them radially keeps each one's angle — which is the meaningful part —
 * while making the count visible.
 */
function spread(dots: Dot[], from: number): void {
  const buckets = new Map<string, number>();
  for (let index = from; index < dots.length; index += 1) {
    const dot = dots[index];
    if (dot === undefined) continue;
    const key = `${Math.round(dot.x / 14)}:${Math.round(dot.y / 14)}`;
    const seen = buckets.get(key) ?? 0;
    buckets.set(key, seen + 1);
    if (seen === 0) continue;
    const dx = dot.x - CX;
    const dy = dot.y - CY;
    const length = Math.hypot(dx, dy) || 1;
    // Alternate in and out so a cluster grows either side of its true radius.
    const step = (seen % 2 === 1 ? 1 : -1) * Math.ceil(seen / 2) * 15;
    dot.x += (dx / length) * step;
    dot.y += (dy / length) * step;
  }
}

/** Union-find over what is drawn, so "one component" is measured, not claimed. */
function isConnected(nodes: number, edges: [number, number][]): boolean {
  if (nodes === 0) return false;
  const parent = Array.from({ length: nodes }, (_, index) => index);
  const find = (x: number): number => {
    let root = x;
    while (parent[root] !== root) root = parent[root] ?? root;
    return root;
  };
  for (const [a, b] of edges) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }
  const first = find(0);
  for (let index = 1; index < nodes; index += 1) if (find(index) !== first) return false;
  return true;
}

/** A found component: its device at the centre, its cards around it. */
function layoutComponent(component: RingComponent): Layout {
  const dots: Dot[] = [];
  const edges: [number, number][] = [];
  const seeds = new Set(component.seeds);
  component.devices.slice(0, 4).forEach((device, index, all) => {
    const angle = -Math.PI / 2 + (index / Math.max(all.length, 1)) * Math.PI * 2;
    dots.push({
      x: all.length === 1 ? CX : CX + Math.cos(angle) * 90,
      y: all.length === 1 ? CY : CY + Math.sin(angle) * 60,
      r: 40,
      label: device,
      sub: "shared fingerprint",
      tone: "danger",
    });
  });
  const hub = dots.length;
  component.cards.slice(0, 14).forEach((card, index, all) => {
    const angle = -Math.PI / 2 + (index / Math.max(all.length, 1)) * Math.PI * 2;
    dots.push({
      x: CX + Math.cos(angle) * 290,
      y: CY + Math.sin(angle) * 200,
      r: 26,
      label: card,
      sub: seeds.has(card) ? "seed" : "member",
      tone: seeds.has(card) ? "danger" : "accent",
    });
    edges.push([0, hub + index]);
  });
  return {
    dots,
    edges,
    connected: isConnected(dots.length, edges),
    devices: Math.min(component.devices.length, 4),
    cards: Math.min(component.cards.length, 14),
    bridges: 0,
    hidden: 0,
  };
}

export function RingView() {
  const { data, isLoading, error } = useRings();

  const model = useMemo<Layout | null>(() => {
    if (!data) return null;
    const first = data.components[0];
    if (first) return layoutComponent(first);
    const seeds = new Set(data.examined.flatMap((link) => link.seeds));
    return layoutExamined(data.examined, seeds);
  }, [data]);

  if (isLoading) {
    return <Frame><p className="text-caption text-fg-subtle">Loading the sweep…</p></Frame>;
  }
  if (error || !data || !data.available) {
    return (
      <Frame>
        <div className="max-w-[60ch] rounded-lg border border-dashed border-border bg-surface p-5">
          <div className="text-[15px] font-bold">The sweep has not been run</div>
          <p className="mt-2 text-[12.5px] leading-relaxed text-fg-muted">
            Run <code className="font-mono text-accent">python -m sentinel explore rings</code> to
            write <code className="font-mono">exploration/rings.json</code>. This screen reads that
            artefact rather than recomputing it, so the page and the terminal cannot disagree.
          </p>
        </div>
      </Frame>
    );
  }

  const found = data.rings_found > 0;
  const component = data.components[0] ?? null;
  // Past about eighty edges the dashes stop reading as movement and start
  // reading as texture, and animating them all costs a frame budget for
  // nothing.
  const busy = (model?.edges.length ?? 0) > 80;

  return (
    <div className="absolute inset-x-0 bottom-0 top-0 z-view flex bg-bg">
      <div className="bg-dotgrid relative min-w-0 flex-1 border-r border-border bg-surface">
        <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" role="img"
          aria-label={
            found
              ? `A ring of ${component?.cards.length ?? 0} cards`
              : `No ring at one hop across ${data.seeds} seeds`
          }
        >
          {model?.edges.map(([from, to]) => {
            const a = model.dots[from];
            const b = model.dots[to];
            if (!a || !b) return null;
            return (
              <line
                key={`${from}-${to}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="var(--border-strong)"
                strokeOpacity={busy ? 0.4 : 0.6}
                strokeWidth={busy ? 0.8 : 2}
                strokeDasharray={busy ? undefined : "7 7"}
                className={busy ? undefined : "animate-trace"}
              />
            );
          })}

          {model?.dots.map((dot, index) => (
            <g key={index} className="animate-s-pop">
              {dot.seed ? (
                <circle
                  cx={dot.x}
                  cy={dot.y}
                  r={dot.r + 7}
                  fill="none"
                  stroke={toneVar(dot.tone)}
                  strokeWidth="1.2"
                  strokeDasharray="4 4"
                  className="animate-spin-slow"
                />
              ) : null}
              <circle
                cx={dot.x}
                cy={dot.y}
                r={dot.r}
                fill={`color-mix(in srgb, ${toneVar(dot.tone)} ${dot.seed ? 55 : 15}%, transparent)`}
                stroke={toneVar(dot.tone)}
                strokeWidth={dot.seed ? 2.6 : dot.r < 4 ? 1.2 : 2}
                strokeOpacity={dot.r < 4 ? 0.55 : 1}
              />
            </g>
          ))}

          {/* Labels are a second pass, so a node drawn later cannot sit on
              top of a name written earlier. */}
          {model?.dots.map((dot, index) =>
            dot.label ? <Label key={`label-${index}`} dot={dot} /> : null,
          )}

          {/* The two-hop boundary. Dashed because it is a measurement, not a
              finding, and turning because the sweep is what drew it. */}
          <ellipse
            cx={CX}
            cy={CY}
            rx={found ? 76 : DEVICE_RX + 26}
            ry={found ? 76 : DEVICE_RY + 26}
            fill="none"
            stroke={found ? "var(--danger)" : "var(--border-strong)"}
            strokeWidth="1.4"
            strokeDasharray="7 9"
            opacity="0.45"
            /* Dashes travel; the ellipse does not turn. Rotating a non-circle
               reads as tumbling rather than sweeping. */
            className="animate-trace"
          />
          {!found ? (
            <>
              <rect
                x={CX - 260}
                y={H - 76}
                width="520"
                height="62"
                rx="10"
                fill="var(--surface)"
                fillOpacity="0.94"
              />
              <text
                x={CX}
                y={H - 48}
                fill="var(--fg)"
                fontFamily="var(--font-mono)"
                fontSize="18"
                fontWeight="600"
                textAnchor="middle"
              >
                no two seeds share a device at one hop
              </text>
              <text
                x={CX}
                y={H - 26}
                fill="var(--fg-muted)"
                fontFamily="var(--font-mono)"
                fontSize="14"
                textAnchor="middle"
              >
                {model
                  ? `the second hop — ${model.devices} profiles joined by ${model.bridges} shared cards` +
                    `${model.connected ? ", one component" : ""}`
                  : ""}
              </text>
            </>
          ) : null}
        </svg>
      </div>

      <div className="w-[360px] shrink-0 overflow-y-auto bg-surface px-4 pb-7 pt-4">
        <div className="text-[15px] font-bold leading-tight">
          {found ? "Undocumented component" : "No ring on this pack"}
        </div>
        <div className="mt-1.5 font-mono text-[10px] text-fg-muted">
          device projection · {data.hops} hop · {data.window_days}-day window
        </div>
        {!found && model && model.devices > 0 ? (
          <p className="mt-2.5 text-[12px] leading-relaxed text-fg-muted">
            At one hop the twenty seeds share no device with each other at all — that is the
            finding, and there is nothing to draw. Drawn instead is the <b>second</b> hop, reduced
            to the part that carries the connection: {model.devices} device profiles and the{" "}
            {model.bridges} cards that sit on more than one of them
            {model.connected ? ", a single connected component" : ""}. The other {model.hidden}{" "}
            cards sit on exactly one profile and join nothing, so they are left out. Benchmark
            seeds are ringed and named wherever they appear.
          </p>
        ) : null}

        <div className="mt-3.5 grid grid-cols-2 gap-2">
          <StatTile label="Seeds" value={String(data.seeds)} />
          <StatTile
            label="Rings found"
            value={String(data.rings_found)}
            tone={found ? "danger" : "success"}
          />
          <StatTile
            label="1-hop components"
            value={String(data.components_found)}
            note="of 3+ cards, past the gate"
          />
          <StatTile
            label="2-hop reach"
            value={data.two_hop_reach.toLocaleString()}
            tone="warning"
          />
          <StatTile
            label="2-hop customers"
            value={data.two_hop_customers.toLocaleString()}
            tone="warning"
          />
          <StatTile
            label="Profiles skipped"
            value={String(data.generic_profiles_skipped)}
            note="above the device cap"
          />
          {model && model.devices > 0 ? (
            <StatTile
              label="Drawn"
              value={`${model.devices} + ${model.bridges}`}
              note={`profiles + shared cards · ${model.hidden} leaves omitted`}
            />
          ) : null}
        </div>

        {data.note ? (
          <div className="mt-4 rounded-lg border border-warning-tint bg-warning-tint px-3.5 py-3">
            <div className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.1em]" style={{ color: "var(--warning)" }}>
              Method · R6
            </div>
            <p className="mt-2 text-[12.5px] leading-relaxed" style={{ color: "var(--warning)" }}>
              {data.note}
            </p>
          </div>
        ) : null}

        {!found ? (
          <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-border bg-surface-2 px-3.5 py-3">
            <Icon name="check" size={16} className="mt-px shrink-0" style={{ color: "var(--success)" }} />
            <p className="text-[12px] leading-relaxed text-fg-muted">
              R6 is right not to fire here. A rule that found a ring in this pack would be finding
              one in the giant component, which is a property of the portfolio rather than of any
              case.
            </p>
          </div>
        ) : null}

        {component ? (
          <>
            <Overline className="mt-5 block">Component members</Overline>
            <ul className="mt-2 flex flex-col gap-1.5">
              {component.cards.map((card) => (
                <li
                  key={card}
                  className="flex items-center gap-2.5 rounded-md border border-border px-3 py-2.5"
                >
                  <Icon name="card" size={13} style={{ color: toneVar("accent") }} />
                  <span className="font-mono text-[10.5px] font-semibold">{card}</span>
                  <span className="flex-1" />
                  {component.seeds.includes(card) ? (
                    <ConsoleChip tone="danger">seed</ConsoleChip>
                  ) : (
                    <ConsoleChip tone="accent">member</ConsoleChip>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-2.5 font-mono text-[10px] text-fg-subtle">
              exposure {money(component.exposure_usd)} · {component.customers.length} customers
            </p>
          </>
        ) : null}

        <p className="mt-5 font-mono text-[9px] text-fg-subtle">
          swept {data.generated_at}
        </p>
      </div>
    </div>
  );
}

/**
 * A node's name, placed away from the middle.
 *
 * Hung underneath, labels in the crowded part of the ring sit on top of each
 * other and on the edges. Pushing each one out along its own radius — and
 * flipping the anchor so text on the left of the ring ends at the node and
 * text on the right begins at it — separates them for free, because nodes
 * that are close together are close in *angle* and their labels then fan out
 * rather than stack.
 */
function Label({ dot }: { dot: Dot }) {
  const dx = dot.x - CX;
  const dy = dot.y - CY;
  const length = Math.hypot(dx, dy) || 1;
  const out = dot.r + 13 + (dot.labelOut ?? 0);
  // Clamped inside the canvas: a label that leaves the viewBox is clipped,
  // and the strip along the bottom belongs to the caption.
  const x = Math.min(Math.max(dot.x + (dx / length) * out, LABEL_INSET), W - LABEL_INSET);
  const y = Math.min(Math.max(dot.y + (dy / length) * out, 22), H - CAPTION_BAND);
  const horizontal = Math.abs(dx) / length;
  const anchor = horizontal < 0.35 ? "middle" : dx > 0 ? "start" : "end";
  // Below the centre the two lines read downward; above it, upward, so a
  // label never runs back across its own node.
  const lead = dy >= 0 ? 11 : -6;
  return (
    <>
      {(dot.labelOut ?? 0) > 0 ? (
        <line
          x1={dot.x + (dx / length) * dot.r}
          y1={dot.y + (dy / length) * dot.r}
          x2={x}
          y2={y}
          stroke="var(--border-strong)"
          strokeWidth="0.8"
          strokeOpacity="0.7"
        />
      ) : null}
      <text
        x={x}
        y={y + lead}
        fill="var(--fg)"
        fontFamily="var(--font-mono)"
        fontSize="12.5"
        fontWeight="600"
        textAnchor={anchor}
        paintOrder="stroke"
        stroke="var(--surface)"
        strokeWidth="3.5"
        strokeLinejoin="round"
      >
        {dot.label}
      </text>
      {dot.sub ? (
        <text
          x={x}
          y={y + lead + 13}
          fill="var(--fg-subtle)"
          fontFamily="var(--font-mono)"
          fontSize="10.5"
          textAnchor={anchor}
          paintOrder="stroke"
          stroke="var(--surface)"
          strokeWidth="3"
          strokeLinejoin="round"
        >
          {dot.sub}
        </text>
      ) : null}
    </>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-x-0 bottom-0 top-0 z-view flex items-center justify-center bg-bg p-8">
      {children}
    </div>
  );
}
