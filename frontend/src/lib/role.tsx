"use client";

/**
 * Who the console says it is.
 *
 * Authorization is real and lives on the server; this is only the claim. The
 * switcher exists because the permission boundary is a thing to *demonstrate*
 * — an analyst is refused, a fraud manager approves, and the difference has
 * to be one click apart or nobody will look at it.
 *
 * Changing the role invalidates every query, because `may_execute` is
 * computed for a role and a cached answer for the previous one is a lie about
 * what this person can do.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { DEFAULT_ROLE, readRole, writeRole } from "@/lib/api";
import type { Role } from "@/lib/generated/contract";

interface RoleContext {
  role: Role;
  setRole: (role: Role) => void;
}

const Context = createContext<RoleContext>({ role: DEFAULT_ROLE, setRole: () => {} });

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const [role, setRoleState] = useState<Role>(DEFAULT_ROLE);
  const client = useQueryClient();

  // Read after mount, not during render: the server has no localStorage and a
  // role read during SSR would hydrate to a different tree.
  useEffect(() => setRoleState(readRole()), []);

  const setRole = useCallback(
    (next: Role) => {
      setRoleState(next);
      writeRole(next);
      void client.invalidateQueries();
    },
    [client],
  );

  const value = useMemo(() => ({ role, setRole }), [role, setRole]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export const useRole = () => useContext(Context);

/** How each role reads in the interface. */
export const ROLE_LABELS: Record<Role, string> = {
  analyst: "Analyst",
  team_lead: "Team lead",
  fraud_manager: "Fraud manager",
};
