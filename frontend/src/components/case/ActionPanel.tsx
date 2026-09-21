"use client";

/**
 * What to do now, who has to approve it, and what changed after the evidence.
 *
 * Two things this panel exists to make visible.
 *
 * **The diff.** `initial` is what was recommended before the agent asked for
 * anything; `final` is after the answer came back. They are shown side by
 * side with what changed beneath, because a recommendation that updates as
 * evidence arrives is a quarter of what this system is judged on and a single
 * list would hide it entirely.
 *
 * **The boundary.** Every route here is the one the server recomputed from
 * the routing table at this case's exposure — never the one in the answer
 * file, which is badged when the two differ. Pressing execute on an `L1` or
 * `L2` action returns 403, and that 403 is rendered as the *next step* rather
 * than as an error: it names who can approve and carries the approval it just
 * enqueued.
 */

import { useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/Button";
import { EmptyState, ErrorNote, Skeleton } from "@/components/ui/EmptyState";
import { Panel } from "@/components/ui/Panel";
import { RouteBadge } from "@/components/ui/RouteBadge";
import { ApiProblem } from "@/lib/api";
import { useActions, useExecute } from "@/lib/hooks";
import { ROLE_LABELS } from "@/lib/role";
import { cn } from "@/lib/cn";
import { usd } from "@/lib/format";
import type { ActionRow, Role } from "@/lib/generated/contract";

export function ActionPanel({ caseId }: { caseId: string }) {
  const { data, isLoading, error } = useActions(caseId);
  const execute = useExecute(caseId);
  const [pressed, setPressed] = useState<string>("");

  if (error) {
    return <ErrorNote title="No action plan" detail={(error as Error).message} />;
  }
  if (isLoading || !data) return <Skeleton rows={6} />;

  const denial = execute.error instanceof ApiProblem ? execute.error : null;
  const added = new Set(
    data.final.filter((row) => !data.initial.some((i) => i.action === row.action)).map((r) => r.action),
  );
  const removed = data.initial.filter((row) => !data.final.some((f) => f.action === row.action));

  const run = (row: ActionRow) => {
    setPressed(row.action);
    execute.reset();
    execute.mutate({
      case_id: caseId,
      action: row.action,
      phase: "final",
      payload: {},
      on_denied: "enqueue",
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="Next best action"
        actions={
          <span className="text-caption text-fg-subtle">
            exposure {usd(data.exposure_usd)} · as {ROLE_LABELS[data.role as Role]}
          </span>
        }
      >
        {data.final.length === 0 ? (
          <EmptyState title="No action recommended" />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {data.final.map((row) => (
              <Row
                key={row.action}
                row={row}
                added={added.has(row.action)}
                busy={execute.isPending && pressed === row.action}
                onExecute={() => run(row)}
              />
            ))}
          </ul>
        )}

        {removed.length > 0 || data.what_changed !== "nothing" ? (
          <div className="mt-3 border-t border-border pt-3">
            <h3 className="text-overline uppercase text-fg-subtle">What changed</h3>
            {removed.length > 0 ? (
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {removed.map((row) => (
                  <li
                    key={row.action}
                    className="rounded-md bg-danger-tint px-2 py-0.5 font-mono text-caption text-fg line-through"
                    title="Recommended before the evidence round, withdrawn after it"
                  >
                    {row.action}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="mt-1.5 text-small text-fg">{data.what_changed}</p>
          </div>
        ) : null}
      </Panel>

      {denial ? <Denial problem={denial} /> : null}

      {execute.isSuccess ? (
        <div role="status" className="rounded-lg border border-success bg-success-tint p-3">
          <p className="text-small text-fg">
            <span className="font-semibold text-success">Executed. </span>
            Simulated, recorded in the audit log.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function Row({
  row,
  added,
  busy,
  onExecute,
}: {
  row: ActionRow;
  added: boolean;
  busy: boolean;
  onExecute: () => void;
}) {
  return (
    <li
      className={cn(
        "flex flex-col gap-1.5 rounded-lg border border-border p-2.5",
        added && "border-success bg-success-tint",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-small font-semibold text-fg">{row.action}</span>
        <RouteBadge route={row.route} />
        {row.route_changed ? (
          <span
            className="rounded-full bg-warning-tint px-2 py-0.5 text-caption text-warning"
            title={`The answer file recorded ${row.answer_route}; the routing table returns ${row.route} at this exposure now.`}
          >
            route moved from {row.answer_route}
          </span>
        ) : null}
        {added ? <span className="text-caption text-success">added after evidence</span> : null}
      </div>
      <p className="text-caption text-fg-muted">{row.reason}</p>
      <div className="flex items-center justify-between gap-2">
        <span className="text-caption text-fg-subtle">
          {row.may_execute
            ? "Executable now"
            : `Needs ${row.approvers.map((r) => ROLE_LABELS[r as Role]).join(" or ")}`}
        </span>
        <Button
          size="sm"
          variant={row.may_execute ? "primary" : "secondary"}
          loading={busy}
          onClick={onExecute}
        >
          Execute
        </Button>
      </div>
    </li>
  );
}

/**
 * A refusal, rendered as the next step.
 *
 * The 403 body carries everything needed to continue, so this asks for no
 * second request: the route, the roles that can approve, and a link to the
 * approval the denial just enqueued.
 */
function Denial({ problem }: { problem: ApiProblem }) {
  if (problem.status !== 403) {
    return <ErrorNote title={problem.title} detail={problem.detail} />;
  }
  const approval = problem.approval;
  return (
    <div role="alert" className="rounded-lg border border-authority bg-authority-tint p-3">
      <p className="text-small font-semibold text-authority">{problem.title}</p>
      <p className="mt-1 text-small text-fg">{problem.detail}</p>
      <p className="mt-1.5 text-caption text-fg-muted">
        Approvable by {problem.approvers.map((r) => ROLE_LABELS[r as Role]).join(" or ")}. Switch
        role in the top bar, then decide it in the inbox.
      </p>
      {approval ? (
        <Link
          href="/approvals"
          className="mt-2 inline-block rounded-md bg-authority px-2.5 py-1 text-caption text-authority-contrast focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Go to approval <span className="font-mono">{approval.approval_id.slice(0, 12)}…</span>
        </Link>
      ) : null}
    </div>
  );
}
