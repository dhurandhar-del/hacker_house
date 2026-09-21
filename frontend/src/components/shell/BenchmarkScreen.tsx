"use client";

/**
 * The pack, scored — and the four ratios that say whether it is defensible.
 *
 * Half the benchmark is legitimate activity and the documented failure mode
 * is an agent that blocks everything, so the warnings are the point of the
 * screen and are shown first. A console that reported only what the agent
 * found would not notice the agent becoming that agent.
 *
 * The histogram is here for one reason: bimodality. An agent whose
 * probabilities pile up at 0.02 and 0.99 is not calibrated, it is classifying,
 * and that is visible in the shape long before it is visible in a mean.
 */

import { EmptyState, ErrorNote, Skeleton } from "@/components/ui/EmptyState";
import { Panel } from "@/components/ui/Panel";
import { useBenchmark } from "@/lib/hooks";
import { cn } from "@/lib/cn";

/** The ceilings the batch report warns above. */
const CEILINGS = { block: 0.5, sar: 0.2 } as const;

export function BenchmarkScreen() {
  const { data, isLoading, error } = useBenchmark();

  if (error) return <ErrorNote title="Could not score the pack" detail={(error as Error).message} />;
  if (isLoading || !data) return <Skeleton rows={8} />;

  const peak = Math.max(1, ...data.probability_histogram.map((bin) => bin.count));

  return (
    <section aria-labelledby="benchmark-heading" className="flex flex-col gap-4">
      <header>
        <h1 id="benchmark-heading" className="text-h1 text-fg">
          Benchmark
        </h1>
        <p className="mt-0.5 text-small text-fg-muted">
          {data.valid} of {data.total} cases have a valid answer.
        </p>
      </header>

      {data.warnings.length > 0 ? (
        <div role="alert" className="rounded-lg border border-warning bg-warning-tint p-3">
          <p className="text-small font-semibold text-warning">
            {data.warnings.length} thing{data.warnings.length === 1 ? "" : "s"} to look at
          </p>
          <ul className="mt-1 list-disc pl-5 text-small text-fg">
            {data.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="rounded-lg border border-success bg-success-tint p-3">
          <p className="text-small text-fg">
            <span className="font-semibold text-success">No warnings. </span>
            Block and SAR rates are inside their ceilings, no verdict dominates the pack, and the
            recommendation moved on enough cases.
          </p>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Rates">
          <dl className="flex flex-col gap-3">
            <Rate label="Block rate" value={data.block_rate} ceiling={CEILINGS.block} />
            <Rate label="SAR rate" value={data.sar_rate} ceiling={CEILINGS.sar} />
            <Rate label="Changed after evidence" value={data.changed_rate} />
          </dl>
        </Panel>

        <Panel title="Verdicts">
          {Object.keys(data.verdict_mix).length === 0 ? (
            <EmptyState title="No verdicts yet" />
          ) : (
            <dl className="flex flex-col gap-2">
              {Object.entries(data.verdict_mix).map(([verdict, count]) => (
                <div key={verdict} className="flex items-center gap-2">
                  <dt className="w-24 text-small capitalize text-fg">{verdict}</dt>
                  <dd className="flex flex-1 items-center gap-2">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-meter-track">
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{ width: `${(count / Math.max(data.valid, 1)) * 100}%` }}
                      />
                    </div>
                    <span className="w-6 text-right font-mono text-caption tabular-nums text-fg">
                      {count}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </Panel>
      </div>

      <Panel title="Probability histogram">
        <div className="flex h-32 items-end gap-1" role="img" aria-label="Distribution of fraud probability across the pack">
          {data.probability_histogram.map((bin) => (
            <div key={bin.lower} className="flex flex-1 flex-col items-center gap-1">
              <div
                className="w-full rounded-t bg-accent"
                style={{ height: `${(bin.count / peak) * 100}%`, minHeight: bin.count ? 3 : 0 }}
                title={`${bin.lower.toFixed(1)}–${bin.upper.toFixed(1)}: ${bin.count}`}
              />
              <span className="text-caption tabular-nums text-fg-subtle">{bin.count}</span>
              <span className="text-caption text-fg-subtle">{bin.lower.toFixed(1)}</span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Cases">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-caption">
            <thead>
              <tr className="border-b border-border text-left text-fg-subtle">
                <th scope="col" className="py-1.5 pr-3 font-medium">Case</th>
                <th scope="col" className="py-1.5 pr-3 font-medium">Verdict</th>
                <th scope="col" className="py-1.5 pr-3 font-medium">p</th>
                <th scope="col" className="py-1.5 pr-3 font-medium">Pattern</th>
                <th scope="col" className="py-1.5 pr-3 font-medium">SAR</th>
                <th scope="col" className="py-1.5 font-medium">Final actions</th>
              </tr>
            </thead>
            <tbody>
              {data.cases.map((row) => (
                <tr key={row.case_id} className="border-b border-border last:border-0">
                  <td className="py-1.5 pr-3 font-mono text-fg">{row.case_id}</td>
                  <td className="py-1.5 pr-3">{row.verdict ?? "—"}</td>
                  <td className="py-1.5 pr-3 font-mono tabular-nums text-fg">
                    {row.fraud_probability?.toFixed(4) ?? "—"}
                  </td>
                  <td className="py-1.5 pr-3">{row.pattern ?? "—"}</td>
                  <td className="py-1.5 pr-3">{row.sar ? "filed" : "·"}</td>
                  <td className="py-1.5 font-mono text-fg-muted">{row.actions.join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </section>
  );
}

function Rate({ label, value, ceiling }: { label: string; value: number; ceiling?: number }) {
  const over = ceiling !== undefined && value > ceiling;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <dt className="text-small text-fg">{label}</dt>
        <dd className={cn("font-mono tabular-nums", over ? "text-danger" : "text-fg")}>
          {(value * 100).toFixed(0)}%
          {ceiling !== undefined ? (
            <span className="ml-1 text-caption text-fg-subtle">
              of {(ceiling * 100).toFixed(0)}%
            </span>
          ) : null}
        </dd>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-meter-track">
        <div
          className={cn("h-full rounded-full", over ? "bg-danger" : "bg-success")}
          style={{ width: `${Math.min(value, 1) * 100}%` }}
        />
      </div>
    </div>
  );
}
