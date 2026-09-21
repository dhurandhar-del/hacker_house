"use client";

/**
 * One case, whole: what was decided, what it rests on, and what to do now.
 *
 * Three columns at width, because those are three different questions and an
 * analyst moves between them rather than through them. Below 1024px they
 * become tabs ordered case → actions → investigation, because on a phone the
 * decision matters more than how it was reached.
 *
 * The screen renders for a case with no answer. That is not a courtesy: for
 * most of a benchmark run most cases are in that state, and the button that
 * starts the investigation lives here.
 */

import { useState } from "react";

import { ActionPanel } from "@/components/case/ActionPanel";
import { CasePane } from "@/components/case/CasePane";
import { InvestigationPane } from "@/components/case/InvestigationPane";
import { EmptyState, ErrorNote, Skeleton } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { useCase, useStartInvestigation } from "@/lib/hooks";
import { cn } from "@/lib/cn";

type Pane = "case" | "actions" | "investigation";

const TABS: { id: Pane; label: string }[] = [
  { id: "case", label: "Case" },
  { id: "actions", label: "Actions" },
  { id: "investigation", label: "Investigation" },
];

export function CaseDetail({ caseId }: { caseId: string }) {
  const { data, isLoading, error } = useCase(caseId);
  const [tab, setTab] = useState<Pane>("case");
  const [runId, setRunId] = useState<string | null>(null);
  const start = useStartInvestigation();

  if (error) {
    return <ErrorNote title={`Could not load ${caseId}`} detail={(error as Error).message} />;
  }
  if (isLoading || !data) return <Skeleton rows={10} />;

  const { alert, answer } = data;

  const onStart = () =>
    start.mutate(caseId, {
      onSuccess: (accepted) => {
        setRunId(accepted.run_id);
        setTab("investigation");
      },
    });

  return (
    <section aria-labelledby="case-heading" className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 id="case-heading" className="font-mono text-h1 text-fg">
            {caseId}
          </h1>
          <p className="mt-0.5 max-w-3xl text-small text-fg-muted">{alert.trigger_text}</p>
        </div>
        <Button onClick={onStart} loading={start.isPending} variant="primary">
          {answer ? "Re-investigate" : "Investigate"}
        </Button>
      </header>

      {start.error ? (
        <ErrorNote title="Could not start the run" detail={(start.error as Error).message} />
      ) : null}

      {/* Tabs below 1024px; three columns above it. */}
      <div role="tablist" aria-label="Case sections" className="flex gap-1 lg:hidden">
        {TABS.map((item) => (
          <button
            key={item.id}
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={cn(
              "rounded-md px-3 py-1.5 text-small transition-colors duration-fast",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              tab === item.id
                ? "bg-accent-tint font-semibold text-accent"
                : "text-fg-muted hover:bg-surface-2",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(320px,360px)_minmax(0,1fr)] xl:grid-cols-[360px_minmax(0,1fr)_400px]">
        <div className={cn("min-w-0", tab === "case" ? "" : "hidden lg:block")}>
          <CasePane detail={data} />
        </div>
        <div className={cn("min-w-0", tab === "investigation" ? "" : "hidden lg:block")}>
          <InvestigationPane caseId={caseId} runId={runId} hasAnswer={Boolean(answer)} />
        </div>
        <div className={cn("min-w-0", tab === "actions" ? "" : "hidden xl:block")}>
          {answer ? (
            <ActionPanel caseId={caseId} />
          ) : (
            <EmptyState
              title="No recommendation yet"
              hint="Run the investigation to produce one."
            />
          )}
        </div>
      </div>
    </section>
  );
}
