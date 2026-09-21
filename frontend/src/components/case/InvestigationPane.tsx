"use client";

/**
 * How the answer was reached: the ten steps, live or replayed.
 *
 * When a run is in flight this subscribes to the SSE stream and appends; when
 * it is not, it reads the journalled trace of the last run. The two render
 * through the same rows, because the journal is written before each event is
 * published — so a replay and a live view cannot disagree about what
 * happened, and a reconnect resumes at the sequence number it stopped on.
 *
 * The trajectory above the timeline is the thing worth watching. It starts at
 * the trigger's prior — 0.25 for a model score, 0.75 for a customer report —
 * and every posting moves it. An analyst can see the case being argued in
 * both directions rather than only its conclusion.
 */

import { useMemo } from "react";

import { ConnectionBadge } from "@/components/ui/ConnectionBadge";
import { EmptyState, Skeleton } from "@/components/ui/EmptyState";
import { EvidenceItem } from "@/components/case/EvidenceItem";
import { Panel } from "@/components/ui/Panel";
import { ProbabilityTrajectory } from "@/components/case/ProbabilityTrajectory";
import { useInvestigationStream, useTrace, useTrajectory } from "@/lib/hooks";
import { cn } from "@/lib/cn";
import type { EventEnvelope, EvidencePostedPayload } from "@/lib/generated/contract";

export function InvestigationPane({
  caseId,
  runId,
  hasAnswer,
}: {
  caseId: string;
  runId: string | null;
  hasAnswer: boolean;
}) {
  const stream = useInvestigationStream(runId);
  const live = runId !== null;
  const trace = useTrace(caseId, !live && hasAnswer);
  const liveTrajectory = useTrajectory(stream.events);

  const trajectory = live ? liveTrajectory : (trace.data?.trajectory ?? []);
  const postings: EvidencePostedPayload[] = live
    ? stream.events
        .filter((event) => event.type === "evidence.posted")
        .map((event) => event.payload as unknown as EvidencePostedPayload)
    : ((trace.data?.postings ?? []) as unknown as EvidencePostedPayload[]);

  const steps = useMemo(() => (live ? stepsFromEvents(stream.events) : traceSteps(trace)), [
    live,
    stream.events,
    trace,
  ]);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Panel
        title="Probability"
        actions={live ? <ConnectionBadge state={stream.connection} seq={stream.lastSeq} /> : null}
      >
        {trajectory.length > 0 ? (
          <ProbabilityTrajectory values={trajectory} />
        ) : (
          <EmptyState
            title={live ? "Waiting for the first posting" : "No trajectory recorded"}
            hint={live ? undefined : "Run the investigation to produce one."}
          />
        )}
      </Panel>

      <Panel title={`Steps${steps.length ? ` (${steps.length})` : ""}`}>
        {!live && trace.isLoading ? (
          <Skeleton rows={6} />
        ) : steps.length === 0 ? (
          <EmptyState
            title="No run recorded"
            hint="Press Investigate to watch one happen."
          />
        ) : (
          <ol className="flex flex-col gap-1" aria-live={live ? "polite" : "off"}>
            {steps.map((step) => (
              <li
                key={step.step}
                className="grid grid-cols-[28px_1fr_auto] items-baseline gap-2 rounded-md px-1.5 py-1.5 odd:bg-surface-2"
              >
                <span className="font-mono text-caption tabular-nums text-fg-subtle">
                  {step.step}
                </span>
                <span className="min-w-0">
                  <span className="text-small text-fg">{step.title || step.name}</span>
                  {step.detail ? (
                    <span className="ml-1.5 text-caption text-fg-subtle">{step.detail}</span>
                  ) : null}
                </span>
                <span
                  className={cn(
                    "text-caption",
                    step.completed ? "text-success" : "animate-pulse text-warning",
                  )}
                >
                  {step.completed ? "done" : "running"}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      <Panel title={`Postings${postings.length ? ` (${postings.length})` : ""}`}>
        {postings.length === 0 ? (
          <EmptyState title="Nothing posted yet" />
        ) : (
          <ul className="flex flex-col">
            {postings.map((posting, index) => (
              <EvidenceItem key={`${posting.feature}-${index}`} posting={posting} />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

interface StepRow {
  step: number;
  name: string;
  title: string;
  detail: string;
  completed: boolean;
}

/** Fold the live event list into one row per step. */
function stepsFromEvents(events: EventEnvelope[]): StepRow[] {
  const rows = new Map<number, StepRow>();
  for (const event of events) {
    const payload = event.payload as Record<string, unknown>;
    const number = typeof payload.step === "number" ? payload.step : event.step;
    if (number === null || number === undefined) continue;
    if (event.type === "step.started") {
      rows.set(number, {
        step: number,
        name: String(payload.name ?? ""),
        title: String(payload.title ?? ""),
        detail: "",
        completed: false,
      });
    }
    if (event.type === "step.completed") {
      const existing = rows.get(number);
      const calls = Number(payload.tool_calls_in_step ?? 0);
      const posts = Number(payload.postings_in_step ?? 0);
      rows.set(number, {
        step: number,
        name: String(payload.name ?? existing?.name ?? ""),
        title: existing?.title ?? "",
        detail: [
          calls ? `${calls} call${calls === 1 ? "" : "s"}` : "",
          posts ? `${posts} posting${posts === 1 ? "" : "s"}` : "",
        ]
          .filter(Boolean)
          .join(" · "),
        completed: true,
      });
    }
  }
  return [...rows.values()].sort((a, b) => a.step - b.step);
}

function traceSteps(trace: ReturnType<typeof useTrace>): StepRow[] {
  return (trace.data?.steps ?? []).map((step) => ({
    step: step.step,
    name: step.name,
    title: step.title,
    detail: [
      step.tool_calls_in_step ? `${step.tool_calls_in_step} calls` : "",
      step.postings_in_step ? `${step.postings_in_step} postings` : "",
    ]
      .filter(Boolean)
      .join(" · "),
    completed: step.completed,
  }));
}
