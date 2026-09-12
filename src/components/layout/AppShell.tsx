import { Link, useRouterState } from "@tanstack/react-router";
import { Binary, House, LayoutDashboard, Menu, Radio, Users } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { LiquidChrome } from "@/components/LiquidChrome";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Home" },
  { to: "/live", label: "Live" },
  { to: "/qb", label: "QB" },
  { to: "/players", label: "Players" },
  { to: "/optimizer", label: "Lineup" },
  { to: "/study", label: "Study" },
  { to: "/play-calling", label: "Play-calling" },
  { to: "/guide", label: "Guide" },
] as const;

const DOCK = [
  { to: "/", label: "Home", icon: House },
  { to: "/live", label: "Live", icon: Radio },
  { to: "/players", label: "Players", icon: Users },
  { to: "/optimizer", label: "Lineup", icon: Binary },
  { to: "/qb", label: "QB", icon: LayoutDashboard },
] as const;

/** Home-screen / installed PWA only. Desktop and phone browsers stay the website chrome. */
function useStandaloneApp() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(
      "(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)",
    );
    const ios =
      typeof navigator !== "undefined" &&
      "standalone" in navigator &&
      Boolean((navigator as { standalone?: boolean }).standalone);
    const sync = () => setOn(mq.matches || ios);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return on;
}

function NavLinks({ onClick, stacked }: { onClick?: () => void; stacked?: boolean }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav className={cn("flex", stacked ? "flex-col gap-1" : "items-center gap-1")}>
      {NAV.map((item) => {
        const active = pathname === item.to || (item.to !== "/" && pathname.startsWith(item.to));
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={onClick}
            className={cn(
              "hit-shine rounded-sm px-3 py-2 text-[13px] font-medium tracking-wide uppercase transition-colors duration-150",
              stacked ? "flex h-12 items-center" : "h-10",
              active ? "bg-fg/10 text-fg" : "text-muted hover:text-fg",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const app = useStandaloneApp();

  return (
    <div className="relative z-10 flex min-h-dvh flex-col bg-transparent text-fg">
      <LiquidChrome as="header" className="glass-bar sticky top-0 z-40 w-full">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-3">
            <span className="grid size-8 place-items-center rounded-[6px] bg-elevated shadow-[var(--shadow-border)]">
              <span className="block h-4 w-[3px] bg-sage" />
            </span>
            <span className="font-display text-lg uppercase tracking-[0.18em]">Gridiron Lab</span>
          </Link>
          <div className={cn(app ? "hidden" : "hidden md:block")}>
            <NavLinks />
          </div>
          {!app ? (
            <Button
              variant="ghost"
              size="icon"
              className="text-fg md:hidden"
              aria-label="Open menu"
              onClick={() => setOpen(true)}
            >
              <Menu />
            </Button>
          ) : null}
        </div>
      </LiquidChrome>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-[280px]">
          <SheetHeader>
            <SheetTitle>Labs</SheetTitle>
          </SheetHeader>
          <div className="px-4">
            <NavLinks stacked onClick={() => setOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>
      <main className={cn("flex-1", app && "pb-24")}>{children}</main>
      {app ? (
        <nav
          className="pointer-events-none fixed inset-x-0 bottom-0 z-40 pb-[max(1rem,env(safe-area-inset-bottom))]"
          aria-label="Primary"
        >
        <div className="pointer-events-auto mx-auto max-w-sm px-4">
          <LiquidChrome className="rounded-full px-3 py-2">
            <ul className="flex items-center justify-center gap-3">
            {DOCK.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.to || (item.to !== "/" && pathname.startsWith(item.to));
              return (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    aria-label={item.label}
                    className={cn(
                      "hit-shine grid size-14 place-items-center rounded-full transition-colors duration-150",
                      active ? "bg-fg text-bg" : "text-fg/80 hover:bg-fg/10",
                    )}
                  >
                    <Icon className="size-6" />
                  </Link>
                </li>
              );
            })}
            </ul>
          </LiquidChrome>
        </div>
        </nav>
      ) : (
        <footer className="hidden border-t border-border md:block">
          <div className="mx-auto flex max-w-6xl px-4 py-6 text-xs text-subtle sm:px-6">
            <p>ESPN box scores. nflverse EPA / CPOE. Not the NFL.</p>
          </div>
        </footer>
      )}
    </div>
  );
}
