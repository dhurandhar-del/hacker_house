/**
 * The frame, which is now almost nothing.
 *
 * The console owns its own masthead, its own navigation and its own full
 * height, because it is one screen rather than a page inside a chrome. What
 * is left here is the seam every route still passes through, kept so that a
 * future page that is *not* the console has somewhere to hang.
 */

export function AppShell({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh">{children}</div>;
}
