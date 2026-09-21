"use client";

/**
 * The work queue: all twenty alerts, answered or not.
 *
 * The list comes from the case pack rather than the answer directory, so
 * every case is here from the first request and a row renders whether or not
 * an investigation has run. During a batch run that is the whole point — the
 * six minutes while answers appear one by one is the most interesting thing
 * the console shows, and a queue that only listed finished cases would be
 * empty for all of it.
 *
 * Nothing is colour-only. Each verdict carries its word, each route its
 * letter, and the probability its numeral.
 */

import Link from "next/link";
import { useMemo, useState } from "react";

import { EmptyState, ErrorNote, Skeleton } from "@/components/ui/EmptyState";
import { ProbabilityMeter } from "@/components/ui/ProbabilityMeter";
import { StatusChip } from "@/components/ui/StatusChip";
import { VerdictChip } from "@/components/ui/VerdictChip";
import { useCases } from "@/lib/hooks";
import { cn } from "@/lib/cn";
import { usd } from "@/lib/format";
import type { CaseSummary, TriggerType, Verdict } from "@/lib/generated/contract";

const TRIGGERS: { value: "" | TriggerType; label: string }[] = [
  { value: "", label: "Any trigger" },
  { value: "risk_score", label: "Risk score" },
  { value: "customer_report", label: "Customer report" },
  { value: "analyst_request", label: "Analyst request" },
];

const VERDICTS: { value: "" | Verdict; label: string }[] = [
  { value: "", label: "Any verdict" },
  { value: "fraud", label: "Fraud" },
  { value: "uncertain", label: "Uncertain" },
  { value: "legitimate", label: "Legitimate" },
];

export function CaseQueue() {
  const [verdict, setVerdict] = useState<"" | Verdict>("");
  const [trigger, setTrigger] = useState<"" | TriggerType>("");
  const [q, setQ] = useState("");

  const { data, isLoading, error } = useCases(
    useMemo(
      () => ({
        verdict: verdict || undefined,
        trigger_type: trigger || undefined,
        q: q.trim() || undefined,
        limit: 100,
      }),
      [verdict, trigger, q],
    ),
  );

  const rows = data?.items ?? [];
  const answered = rows.filter((row) => row.has_answer).length;

  return (
    <section aria-labelledby="queue-heading" className="flex flex-col gap-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 id="queue-heading" className="text-h1 text-fg">
            Case queue
          </h1>
          <p className="mt-0.5 text-small text-fg-muted">
            {rows.length} alert{rows.length === 1 ? "" : "s"} · {answered} investigated
          </p>
        </div>
        <Summary rows={rows} />
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="q">
          Search by case, card, customer or transaction
        </label>
        <input
          id="q"
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Search case, card, customer, transaction…"
          className="h-8 min-w-0 flex-1 rounded-md border border-border-strong bg-surface px-2.5 text-small text-fg placeholder:text-fg-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent sm:max-w-xs"
        />
        <Select label="Verdict" value={verdict} onChange={setVerdict} options={VERDICTS} />
        <Select label="Trigger" value={trigger} onChange={setTrigger} options={TRIGGERS} />
      </div>

      {error ? (
        <ErrorNote
          title="The queue could not be loaded"
          detail={`${(error as Error).message}. Is the API running on ${
            process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:8000"
          }?`}
        />
      ) : isLoading ? (
        <Skeleton rows={8} />
      ) : rows.length === 0 ? (
        <EmptyState title="No case matches those filters" hint="Clear the search or the filters." />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {rows.map((row) => (
            <QueueRow key={row.case_id} row={row} />
          ))}
        </ul>
      )}
    </section>
  );
}

function QueueRow({ row }: { row: CaseSummary }) {
  return (
    <li>
      <Link
        href={`/cases/${row.case_id}`}
        className={cn(
          "grid grid-cols-[auto_1fr] items-start gap-x-3 gap-y-1 rounded-lg border border-border bg-surface p-3",
          "transition-colors duration-fast hover:border-border-strong hover:bg-surface-2",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
          "md:grid-cols-[112px_1fr_auto] md:items-center",
        )}
      >
        <span className="font-mono text-small font-semibold text-fg">{row.case_id}</span>

        <span className="col-span-2 min-w-0 md:col-span-1">
          <span className="block truncate text-small text-fg" title={row.trigger_text}>
            {row.trigger_text}
          </span>
          <span className="mt-0.5 block text-caption text-fg-subtle">
            {row.trigger_type.replace("_", " ")} · card{" "}
            <span className="font-mono">{row.card_id}</span>
            {row.exposure_usd ? <> · exposure {usd(row.exposure_usd)}</> : null}
            {row.written_to_graph ? <> · in the graph</> : null}
          </span>
        </span>

        <span className="col-start-2 flex flex-wrap items-center justify-end gap-2 md:col-start-3">
          {row.has_answer && row.verdict ? (
            <>
              <VerdictChip verdict={row.verdict} />
              {row.status ? <StatusChip status={row.status} /> : null}
              <span className="w-24">
                <ProbabilityMeter value={row.fraud_probability ?? 0} />
              </span>
            </>
          ) : (
            <span className="rounded-full border border-dashed border-border-strong px-2 py-0.5 text-caption text-fg-muted">
              not investigated
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}

function Summary({ rows }: { rows: CaseSummary[] }) {
  const answered = rows.filter((r) => r.has_answer);
  if (answered.length === 0) return null;
  const mix = answered.reduce<Record<string, number>>((acc, row) => {
    if (row.verdict) acc[row.verdict] = (acc[row.verdict] ?? 0) + 1;
    return acc;
  }, {});
  const blocked = answered.filter((r) => r.final_actions?.some((a) => a.startsWith("BLOCK_"))).length;
  return (
    <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-fg-muted">
      {(["fraud", "uncertain", "legitimate"] as const).map((verdict) => (
        <div key={verdict} className="flex items-baseline gap-1">
          <dt className="capitalize">{verdict}</dt>
          <dd className="font-mono text-fg">{mix[verdict] ?? 0}</dd>
        </div>
      ))}
      <div className="flex items-baseline gap-1">
        <dt>Blocked</dt>
        <dd className="font-mono text-fg">
          {blocked}/{answered.length}
        </dd>
      </div>
    </dl>
  );
}

function Select<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
}) {
  const id = `filter-${label.toLowerCase()}`;
  return (
    <>
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="h-8 rounded-md border border-border-strong bg-surface px-2 text-small text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </>
  );
}
