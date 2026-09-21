"use client";

/**
 * What was concluded, and what it rests on.
 *
 * The evidence list is the point of the screen. It is grouped by source
 * because the three sources answer different questions — the graph says what
 * happened, a `document` item says which written rule governs it, and a
 * `customer` item says what the simulated round assumed — and every item
 * carries a `ref` an analyst can re-run. Anything without one would be an
 * assertion.
 */

import { useState } from "react";

import { EmptyState, Skeleton } from "@/components/ui/EmptyState";
import { AnswerEvidence } from "@/components/case/AnswerEvidence";
import { Panel } from "@/components/ui/Panel";
import { PatternChip } from "@/components/ui/PatternChip";
import { ProbabilityMeter } from "@/components/ui/ProbabilityMeter";
import { StatusChip } from "@/components/ui/StatusChip";
import { VerdictChip } from "@/components/ui/VerdictChip";
import { useMemoryTab, useSar } from "@/lib/hooks";
import { cn } from "@/lib/cn";
import { usd } from "@/lib/format";
import type { CaseDetail as CaseDetailBody, Evidence, EvidenceSource } from "@/lib/generated/contract";

type Tab = "evidence" | "sar" | "memory";

const SOURCE_ORDER: EvidenceSource[] = ["graph", "document", "customer", "external"];

const SOURCE_TITLE: Record<EvidenceSource, string> = {
  graph: "From the graph",
  document: "From the fraud policy",
  customer: "From the requested evidence",
  external: "From outside",
};

export function CasePane({ detail }: { detail: CaseDetailBody }) {
  const [tab, setTab] = useState<Tab>("evidence");
  const answer = detail.answer;

  if (!answer) {
    return (
      <Panel title="Case">
        <EmptyState
          title="Not investigated yet"
          hint="The alert is in the queue; nothing has been decided."
        />
      </Panel>
    );
  }

  const c = answer.case;
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Conclusion">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <VerdictChip verdict={c.verdict} />
            <StatusChip status={c.status} />
            <PatternChip pattern={c.pattern} description={c.pattern_description} />
          </div>
          <ProbabilityMeter value={c.fraud_probability} verdictLabel={c.verdict} />
          <p className="text-small text-fg">{c.summary}</p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-caption">
            <Fact label="Exposure" value={usd(c.exposure_usd)} />
            <Fact label="Transactions" value={String(c.affected_txn_ids.length)} />
            <Fact
              label="Written to graph"
              value={c.written_to_graph ? c.graph_case_id : "no"}
              mono={c.written_to_graph}
            />
            <Fact label="Tool calls" value={String(answer.tool_calls)} />
            <Fact label="Tokens" value={answer.tokens.toLocaleString("en-US")} />
            <Fact label="Latency" value={`${answer.latency_s.toFixed(1)}s`} />
          </dl>
          <p className="border-t border-border pt-2 text-caption text-fg-muted">
            <span className="font-semibold text-fg">Stopped because </span>
            {answer.stop_reason}
          </p>
        </div>
      </Panel>

      <Panel
        title={
          <div role="tablist" aria-label="Case evidence" className="flex gap-1">
            {(
              [
                ["evidence", `Evidence (${c.evidence.length})`],
                ["sar", answer.sar.file ? "SAR — filed" : "SAR — not filed"],
                ["memory", "Memory"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={cn(
                  "rounded-md px-2 py-1 text-caption transition-colors duration-fast",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                  tab === id
                    ? "bg-accent-tint font-semibold text-accent"
                    : "text-fg-muted hover:bg-surface-2",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        }
      >
        {tab === "evidence" ? <EvidenceList evidence={c.evidence} /> : null}
        {tab === "sar" ? <SarTab caseId={answer.case_id} /> : null}
        {tab === "memory" ? <MemoryTab caseId={answer.case_id} /> : null}
      </Panel>
    </div>
  );
}

function EvidenceList({ evidence }: { evidence: Evidence[] }) {
  const grouped = SOURCE_ORDER.map((source) => ({
    source,
    items: evidence.filter((item) => item.source === source),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="flex flex-col gap-4">
      {grouped.map((group) => (
        <div key={group.source}>
          <h3 className="mb-1.5 text-overline uppercase text-fg-subtle">
            {SOURCE_TITLE[group.source]} · {group.items.length}
          </h3>
          <ul className="flex flex-col gap-1">
            {group.items.map((item, index) => (
              <li key={`${item.ref}-${index}`}>
                <AnswerEvidence item={item} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function SarTab({ caseId }: { caseId: string }) {
  const { data, isLoading } = useSar(caseId, true);
  if (isLoading) return <Skeleton rows={4} />;
  if (!data) return <EmptyState title="No report on file" />;
  const sar = data.sar;
  return (
    <div className="flex flex-col gap-3">
      <p
        className={cn(
          "rounded-md px-3 py-2 text-small",
          sar.file ? "bg-danger-tint text-fg" : "bg-surface-2 text-fg",
        )}
      >
        <span className="font-semibold">{sar.file ? "Filing. " : "Not filing. "}</span>
        {sar.reason}
      </p>
      {sar.file ? (
        <>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-caption">
            <Fact label="Total" value={usd(sar.total_amount_usd)} />
            <Fact label="Activity" value={sar.activity_dates.join(" → ") || "—"} />
            <Fact label="Subjects" value={sar.subjects.join(", ") || "—"} mono />
          </dl>
          <p className="max-w-[68ch] whitespace-pre-wrap text-small leading-relaxed text-fg">
            {sar.narrative}
          </p>
        </>
      ) : null}
    </div>
  );
}

function MemoryTab({ caseId }: { caseId: string }) {
  const { data, isLoading } = useMemoryTab(caseId, true);
  if (isLoading) return <Skeleton rows={4} />;
  if (!data) return <EmptyState title="Nothing retrieved" />;

  const sections: { title: string; hits: typeof data.prior_closed_cases }[] = [
    { title: "The bank's closed cases", hits: data.prior_closed_cases },
    { title: "Cases Sentinel wrote earlier in this run", hits: data.sentinel_cases },
  ];

  return (
    <div className="flex flex-col gap-4">
      {sections
        .filter((section) => section.hits.length > 0)
        .map((section) => (
          <div key={section.title}>
            <h3 className="mb-1.5 text-overline uppercase text-fg-subtle">{section.title}</h3>
            <ul className="flex flex-col gap-1">
              {section.hits.map((hit) => (
                <li
                  key={hit.id}
                  className="rounded-md border border-border bg-surface-2 px-2.5 py-1.5"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-small text-fg">{hit.id}</span>
                    <span className="text-caption text-fg-subtle">
                      {String(hit.provenance?.strategy ?? "structural")}
                    </span>
                  </div>
                  {hit.snippet ? (
                    <p className="mt-0.5 line-clamp-2 text-caption text-fg-muted">{hit.snippet}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ))}
      {data.cited.length > 0 ? (
        <div>
          <h3 className="mb-1.5 text-overline uppercase text-fg-subtle">Policy cited</h3>
          <ul className="flex flex-wrap gap-1">
            {data.cited.map((ref) => (
              <li
                key={ref}
                className="rounded-full bg-surface-3 px-2 py-0.5 font-mono text-caption text-fg"
              >
                {ref}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {data.prior_closed_cases.length === 0 && data.sentinel_cases.length === 0 ? (
        <EmptyState title="No prior case was retrieved" />
      ) : null}
    </div>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-fg-subtle">{label}</dt>
      <dd className={cn("truncate text-fg", mono && "font-mono")} title={value}>
        {value}
      </dd>
    </div>
  );
}
