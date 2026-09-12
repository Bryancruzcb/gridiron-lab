import { Link, useRouterState } from "@tanstack/react-router";
import { Binary, House, LayoutDashboard, Menu, Radio, ScrollText } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Home" },
  { to: "/live", label: "Live" },
  { to: "/qb", label: "QB" },
  { to: "/optimizer", label: "Lineup" },
  { to: "/study", label: "Study" },
  { to: "/play-calling", label: "Play-calling" },
  { to: "/guide", label: "Guide" },
] as const;

const DOCK = [
  { to: "/", label: "Home", icon: House },
  { to: "/live", label: "Live", icon: Radio },
  { to: "/qb", label: "QB", icon: LayoutDashboard },
  { to: "/optimizer", label: "Lineup", icon: Binary },
  { to: "/study", label: "Study", icon: ScrollText },
] as const;

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
              "rounded-sm px-3 py-2 text-[13px] font-medium tracking-wide uppercase transition-colors duration-150",
              stacked ? "flex h-12 items-center" : "h-10",
              active ? "bg-elevated text-fg" : "text-muted hover:text-fg",
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

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <header className="sticky top-0 z-40 border-b border-border bg-bg/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-3">
            <span className="grid size-8 place-items-center rounded-[6px] bg-elevated shadow-[var(--shadow-border)]">
              <span className="block h-4 w-[3px] bg-sage" />
            </span>
            <span className="font-display text-lg uppercase tracking-[0.18em]">Gridiron Lab</span>
          </Link>
          <div className="hidden md:block">
            <NavLinks />
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="text-fg md:hidden"
            aria-label="Open menu"
            onClick={() => setOpen(true)}
          >
            <Menu />
          </Button>
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
      <main className="flex-1 pb-20 md:pb-0">{children}</main>
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
        aria-label="Primary"
      >
        <ul className="mx-auto grid max-w-lg grid-cols-5 px-2 pt-1">
          {DOCK.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.to || (item.to !== "/" && pathname.startsWith(item.to));
            return (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className={cn(
                    "flex min-h-12 flex-col items-center justify-center gap-0.5 text-[10px] font-medium tracking-wide uppercase",
                    active ? "text-fg" : "text-muted",
                  )}
                >
                  <Icon className="size-5" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <footer className="hidden border-t border-border md:block">
        <div className="mx-auto flex max-w-6xl px-4 py-6 text-xs text-subtle sm:px-6">
          <p>ESPN box scores. nflverse EPA / CPOE. Not the NFL.</p>
        </div>
      </footer>
    </div>
  );
}
