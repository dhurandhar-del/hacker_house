"use client";

/**
 * The frame every screen sits in: a sidebar, a top bar, and a scroll region.
 *
 * The top bar carries the two controls the permission story needs to be one
 * click apart — the role switcher and the connection badge — because a
 * boundary you have to navigate to demonstrate is a boundary nobody sees.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

import { RoleSwitcher } from "@/components/shell/RoleSwitcher";
import { cn } from "@/lib/cn";

const NAV = [
  { href: "/", label: "Queue", hint: "All twenty cases" },
  { href: "/approvals", label: "Approvals", hint: "Actions waiting on a human" },
  { href: "/benchmark", label: "Benchmark", hint: "The pack, scored" },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <div className="flex min-h-dvh">
      <nav
        aria-label="Sections"
        className="hidden w-56 shrink-0 flex-col border-r border-border bg-surface md:flex"
      >
        <Link href="/" className="flex h-[52px] items-center gap-2 px-4 text-h3">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full bg-accent" />
          Sentinel
        </Link>
        <ul className="flex flex-col gap-0.5 p-2">
          {NAV.map((item) => {
            const active = item.href === "/" ? path === "/" : path.startsWith(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  title={item.hint}
                  className={cn(
                    "block rounded-md px-3 py-2 text-body transition-colors duration-fast",
                    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                    active
                      ? "bg-accent-tint font-semibold text-accent"
                      : "text-fg-muted hover:bg-surface-2 hover:text-fg",
                  )}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
        <p className="mt-auto px-4 pb-4 text-caption text-fg-subtle">
          Every action but <span className="font-mono">CREATE_CASE</span> is simulated.
        </p>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
          <Link href="/" className="text-h3 md:hidden">
            Sentinel
          </Link>
          <div className="ml-auto flex items-center gap-3">
            <RoleSwitcher />
          </div>
        </header>
        <main className="min-w-0 flex-1 overflow-x-hidden px-4 py-5 md:px-6">{children}</main>
      </div>
    </div>
  );
}
