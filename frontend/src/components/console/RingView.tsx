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

/**
 * Caps for legibility, and they are low on purpose.
 *
 * The whole two-hop set is ~1,380 cards. Drawn in full it is a solid disc —
 * which is true, and says nothing, because a reader cannot see a device or a
 * card in it. Fourteen profiles and six cards each is enough to show the
 * shape that matters: every card hangs off a profile, profiles do not touch,
 * and the component only holds together because the cards are shared onward.
 * The panel beside the canvas states the real totals, so the drawing is a
 * sample and never a claim about size.
 */
const MAX_DEVICES = 14;
const MAX_CARDS_PER_DEVICE = 6;

interface Dot {
  x: number;
  y: number;
  r: number;
  label: string;
  sub: string;
  tone: "danger" | "accent" | "info" | "neutral";
}

interface Layout {
  dots: Dot[];
  edges: [number, number][];
}

/**
 * The two-hop neighbourhood, drawn.
 *
 * Devices on an inner ring, the cards they touch on an outer one, an edge for
 * every real pairing. This is not a ring in R6's sense and the panel beside
 * it says so — it is the giant component the second hop falls into, which is
 * the measurement that rules the second hop out. Drawing it is the argument:
 * "1,385 cards" is a number, and a hairball is a shape.
 */
function layoutExamined(links: RingDeviceLink[]): Layout {
  const dots: Dot[] = [];
  const edges: [number, number][] = [];
  const shown = links.slice(0, MAX_DEVICES);

  const cardIndex = new Map<string, number>();
  const cards: string[] = [];
  for (const link of shown) {
    for (const card of link.cards.slice(0, MAX_CARDS_PER_DEVICE)) {
      if (!cardIndex.has(card)) {
        cardIndex.set(card, cards.length);
        cards.push(card);
      }
    }
  }

  // Cards on the outside, devices inside. Both rings are angle-ordered by
  // index, so the same sweep always draws the same picture.
  const cardBase = shown.length;
  shown.forEach((link, index) => {
    const angle = -Math.PI / 2 + (index / Math.max(shown.length, 1)) * Math.PI * 2;
    dots.push({
      x: CX + Math.cos(angle) * 168,
      y: CY + Math.sin(angle) * 118,
      r: 13,
      label: "",
      sub: "",
      tone: "danger",
    });
  });
  cards.forEach((card, index) => {
    const angle = -Math.PI / 2 + (index / Math.max(cards.length, 1)) * Math.PI * 2;
    dots.push({
      x: CX + Math.cos(angle) * 380,
      y: CY + Math.sin(angle) * 268,
      r: 7,
      label: "",
      sub: "",
      tone: "accent",
    });
  });

  shown.forEach((link, deviceAt) => {
    for (const card of link.cards.slice(0, MAX_CARDS_PER_DEVICE)) {
      const at = cardIndex.get(card);
      if (at !== undefined) edges.push([deviceAt, cardBase + at]);
    }
  });

  return { dots, edges };
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
  return { dots, edges };
}

export function RingView() {
  const { data, isLoading, error } = useRings();

  const model = useMemo<Layout | null>(() => {
    if (!data) return null;
    const first = data.components[0];
    if (first) return layoutComponent(first);
    return layoutExamined(data.examined);
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
                stroke="var(--danger)"
                strokeOpacity={busy ? 0.16 : 0.45}
                strokeWidth={busy ? 1 : 2}
                strokeDasharray="7 7"
                className={busy ? undefined : "animate-trace"}
              />
            );
          })}

          {model?.dots.map((dot, index) => (
            <g key={index} className="animate-s-pop">
              <circle
                cx={dot.x}
                cy={dot.y}
                r={dot.r}
                fill={`color-mix(in srgb, ${toneVar(dot.tone)} 15%, transparent)`}
                stroke={toneVar(dot.tone)}
                strokeWidth="2.4"
              />
              {dot.label ? (
                <>
                  <text
                    x={dot.x}
                    y={dot.y + dot.r + 24}
                    fill="var(--fg)"
                    fontFamily="var(--font-mono)"
                    fontSize="17"
                    fontWeight="600"
                    textAnchor="middle"
                  >
                    {dot.label}
                  </text>
                  <text
                    x={dot.x}
                    y={dot.y + dot.r + 42}
                    fill="var(--fg-subtle)"
                    fontFamily="var(--font-mono)"
                    fontSize="14.5"
                    textAnchor="middle"
                  >
                    {dot.sub}
                  </text>
                </>
              ) : null}
            </g>
          ))}

          {/* The two-hop boundary. Dashed because it is a measurement, not a
              finding, and turning because the sweep is what drew it. */}
          <circle
            cx={CX}
            cy={CY}
            r={found ? 76 : 292}
            fill="none"
            stroke={found ? "var(--danger)" : "var(--border-strong)"}
            strokeWidth="1.4"
            strokeDasharray="7 9"
            opacity="0.55"
            className="animate-spin-sweep"
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
                this is the second hop — {data.two_hop_reach.toLocaleString()} cards, one component
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
        {!found && data.examined.length > 0 ? (
          <p className="mt-2.5 text-[12px] leading-relaxed text-fg-muted">
            At one hop the twenty seeds share no device with each other at all, so there is
            nothing to draw there. Drawn instead is the <b>second</b> hop:{" "}
            {Math.min(data.examined.length, MAX_DEVICES)} of {data.examined.length} recorded
            device profiles, {MAX_CARDS_PER_DEVICE} cards each, sampled from a component of{" "}
            {data.two_hop_reach.toLocaleString()}. The sample is for legibility — the numbers
            below are the whole thing.
          </p>
        ) : null}

        <div className="mt-3.5 grid grid-cols-2 gap-2">
          <StatTile label="Seeds" value={String(data.seeds)} />
          <StatTile
            label="Rings found"
            value={String(data.rings_found)}
            tone={found ? "danger" : "success"}
          />
          <StatTile label="Components" value={String(data.components_found)} />
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

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-x-0 bottom-0 top-0 z-view flex items-center justify-center bg-bg p-8">
      {children}
    </div>
  );
}
