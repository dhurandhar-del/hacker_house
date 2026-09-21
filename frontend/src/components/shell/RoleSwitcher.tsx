"use client";

/**
 * The control surface of the permission story.
 *
 * Switching role changes one request header. Everything else — which actions
 * may be executed, which approvals may be decided — is recomputed by the
 * server from that header and the routing table. The change is announced
 * politely because a permission boundary that moves silently is one a
 * screen-reader user cannot follow.
 */

import { ROLE_LABELS, useRole } from "@/lib/role";
import type { Role } from "@/lib/generated/contract";

const ROLES: Role[] = ["analyst", "team_lead", "fraud_manager"];

export function RoleSwitcher() {
  const { role, setRole } = useRole();
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="role" className="text-caption text-fg-muted">
        Acting as
      </label>
      <select
        id="role"
        value={role}
        onChange={(event) => setRole(event.target.value as Role)}
        className="h-8 rounded-md border border-border-strong bg-surface px-2 text-small text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
      >
        {ROLES.map((value) => (
          <option key={value} value={value}>
            {ROLE_LABELS[value]}
          </option>
        ))}
      </select>
      <span aria-live="polite" className="sr-only">
        Acting as {ROLE_LABELS[role]}
      </span>
    </div>
  );
}
