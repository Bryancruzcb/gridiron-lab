import { Link, useRouterState } from "@tanstack/react-router";
import { Binary, House, LayoutDashboard, Menu, Radio, Users } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./ThemeToggle";

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
    <nav aria-label="Labs" className={cn("flex", stacked ? "flex-col gap-1" : "items-center gap-0.5")}>
      {NAV.map((item) => {
        const active = pathname === item.to || (item.to !== "/" && pathname.startsWith(item.to));
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={onClick}
            aria-current={active ? "page" : undefined}
            className={cn(
              "hit-shine rounded-full px-2.5 text-sm transition-colors duration-150",
              stacked ? "flex h-12 items-center px-4 text-base" : "inline-flex h-9 items-center",
              active ? "bg-surface text-fg shadow-[var(--shadow-border)]" : "text-muted hover:text-fg",
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
    <div className="relative flex min-h-dvh flex-col bg-bg text-fg">
      <header className="sticky top-0 z-40 w-full border-b border-border bg-bg/95 backdrop-blur-sm">
        <div className="mx-auto flex min-h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <Link to="/" className="mr-auto rounded-sm font-display text-[22px] font-semibold tracking-normal">
            Gridiron Lab
          </Link>
          <div className={cn(app ? "hidden" : "hidden lg:block")}>
            <NavLinks />
          </div>
          {!app ? (
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={open}
              onClick={() => setOpen(true)}
              className="hit-shine inline-flex h-10 items-center gap-2 rounded-full px-3.5 text-sm text-fg shadow-[var(--shadow-border)] lg:hidden"
            >
              <Menu className="size-4" aria-hidden />
              Labs
            </button>
          ) : null}
          <ThemeToggle />
        </div>
      </header>
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
            <div className="rounded-full bg-surface px-3 py-2 shadow-[var(--shadow-border),var(--shadow-float)]">
              <ul className="flex items-center justify-center gap-3">
                {DOCK.map((item) => {
                  const Icon = item.icon;
                  const active = pathname === item.to || (item.to !== "/" && pathname.startsWith(item.to));
                  return (
                    <li key={item.to}>
                      <Link
                        to={item.to}
                        aria-label={item.label}
                        aria-current={active ? "page" : undefined}
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
            </div>
          </div>
        </nav>
      ) : (
        <footer className="border-t border-border">
          <div className="mx-auto flex max-w-6xl px-4 py-8 text-sm text-muted sm:px-6">
            <p>2023–2025 projection study. The $50k lineup is a demo with synthetic salaries.</p>
          </div>
        </footer>
      )}
    </div>
  );
}
