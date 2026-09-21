"use client";

/**
 * Actions waiting on a human, and the record of every one that was decided.
 *
 * The route on each card is re-asserted by the server when the decision is
 * made, not trusted from the row — so a card that says `L2` and a team lead
 * who presses approve get a 403 rather than a block. That refusal is shown
 * here rather than swallowed, because the whole point of the screen is that
 * the boundary is real.
 *
 * The audit table beneath includes denials and failures. An audit log that
 * recorded only successes could not answer "did anyone try to block this
 * card?", which is the question an auditor asks first.
 */

import { useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/Button";
import { EmptyState, ErrorNote, Skeleton } from "@/components/ui/EmptyState";
import { Panel } from "@/components/ui/Panel";
import { RouteBadge } from "@/components/ui/RouteBadge";
import { ApiProblem } from "@/lib/api";
import { useApprovals, useAudit, useDecideApproval } from "@/lib/hooks";
import { ROLE_LABELS, useRole } from "@/lib/role";
import { cn } from "@/lib/cn";
import { usd } from "@/lib/format";
import type { ApprovalItem, Role } from "@/lib/generated/contract";

export function ApprovalsInbox() {
  const { data, isLoading, error } = useApprovals();
  const audit = useAudit();
  const decide = useDecideApproval();
  const { role } = useRole();
  const [acting, setActing] = useState("");

  const items = data?.items ?? [];
  const pending = items.filter((item) => item.status === "pending");
  const decided = items.filter((item) => item.status !== "pending");
  const problem = decide.error instanceof ApiProblem ? decide.error : null;

  const act = (item: ApprovalItem, approve: boolean) => {
    setActing(item.approval_id);
    decide.reset();
    decide.mutate({ id: item.approval_id, approve, note: "" });
  };

  return (
    <section aria-labelledby="approvals-heading" className="flex flex-col gap-4">
      <header>
        <h1 id="approvals-heading" className="text-h1 text-fg">
          Approvals
        </h1>
        <p className="mt-0.5 text-small text-fg-muted">
          You are acting as <strong className="text-fg">{ROLE_LABELS[role]}</strong>. The route is
          re-checked when you decide, not when the approval was raised.
        </p>
      </header>

      {problem ? (
        <div role="alert" className="rounded-lg border border-danger bg-danger-tint p-3">
          <p className="text-small font-semibold text-danger">{problem.title}</p>
          <p className="mt-1 text-small text-fg">{problem.detail}</p>
        </div>
      ) : null}

      <Panel title={`Pending (${pending.length})`}>
        {error ? (
          <ErrorNote title="Could not load approvals" detail={(error as Error).message} />
        ) : isLoading ? (
          <Skeleton rows={3} />
        ) : pending.length === 0 ? (
          <EmptyState
            title="Nothing waiting"
            hint="Try executing an L1 or L2 action on a case as an analyst."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {pending.map((item) => (
              <li
                key={item.approval_id}
                className="flex flex-col gap-2 rounded-lg border border-authority bg-authority-tint p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/cases/${item.case_id}`}
                    className="font-mono text-small font-semibold text-fg underline-offset-2 hover:underline"
                  >
                    {item.case_id}
                  </Link>
                  <span className="font-mono text-small text-fg">{item.action}</span>
                  <RouteBadge route={item.route} />
                  <span className="text-caption text-fg-muted">
                    exposure {usd(item.exposure_usd)} · asked by {item.requested_by}
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-caption text-fg-muted">
                    Approvable by {item.approvers.map((r) => ROLE_LABELS[r as Role]).join(" or ")}
                  </span>
                  <span className="flex gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={decide.isPending && acting === item.approval_id}
                      onClick={() => act(item, false)}
                    >
                      Reject
                    </Button>
                    <Button
                      size="sm"
                      variant="authority"
                      loading={decide.isPending && acting === item.approval_id}
                      onClick={() => act(item, true)}
                    >
                      Approve and execute
                    </Button>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {decided.length > 0 ? (
        <Panel title={`Decided (${decided.length})`}>
          <ul className="flex flex-col gap-1">
            {decided.map((item) => (
              <li
                key={item.approval_id}
                className="flex flex-wrap items-center gap-2 rounded-md px-2 py-1.5 text-caption odd:bg-surface-2"
              >
                <span className="font-mono text-fg">{item.case_id}</span>
                <span className="font-mono text-fg">{item.action}</span>
                <RouteBadge route={item.route} />
                <span
                  className={cn(
                    "font-semibold",
                    item.status === "approved" ? "text-success" : "text-danger",
                  )}
                >
                  {item.status}
                </span>
                <span className="text-fg-muted">by {item.decided_by ?? "—"}</span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel title="Audit">
        {audit.isLoading ? (
          <Skeleton rows={4} />
        ) : (audit.data?.items.length ?? 0) === 0 ? (
          <EmptyState title="Nothing has been attempted yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-caption">
              <thead>
                <tr className="border-b border-border text-left text-fg-subtle">
                  <th scope="col" className="py-1.5 pr-3 font-medium">Outcome</th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">Case</th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">Action</th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">Route</th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">Actor</th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">Approval</th>
                  <th scope="col" className="py-1.5 font-medium">Simulated</th>
                </tr>
              </thead>
              <tbody>
                {audit.data?.items.map((row) => (
                  <tr key={row.audit_id} className="border-b border-border last:border-0">
                    <td className="py-1.5 pr-3">
                      <span
                        className={cn(
                          "font-semibold",
                          row.outcome === "executed" && "text-success",
                          row.outcome === "denied" && "text-warning",
                          row.outcome === "failed" && "text-danger",
                        )}
                      >
                        {row.outcome}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-fg">{row.case_id}</td>
                    <td className="py-1.5 pr-3 font-mono text-fg">{row.action}</td>
                    <td className="py-1.5 pr-3">{row.route}</td>
                    <td className="py-1.5 pr-3">{row.actor_role}</td>
                    <td className="py-1.5 pr-3 font-mono text-fg-subtle">
                      {row.approval_ref ? `${row.approval_ref.slice(0, 10)}…` : "—"}
                    </td>
                    <td className="py-1.5">{row.simulated ? "yes" : "no"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </section>
  );
}
