import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { resetSeen } from "@/lib/first-look";

export const Route = createFileRoute("/guide")({ component: GuidePage });

function GuidePage() {
  return (
    <AppShell>
      <article className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <p className="text-sm text-muted">
          <Link to="/" className="hover:text-fg">
            Home
          </Link>
        </p>
        <h1 className="mt-3 font-display text-5xl uppercase tracking-[0.03em]">Guide</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Short definitions. The 2025 holdout is on{" "}
          <Link to="/study" className="text-fg">
            Study
          </Link>
          .
        </p>

        <section className="mt-10">
          <h2 className="font-display text-2xl uppercase tracking-[0.04em]">QB lab</h2>
          <dl className="mt-4 space-y-4 text-sm leading-relaxed">
            <Item term="EPA">
              Expected points added per dropback versus a typical play in that down, distance, and
              field position. Above zero means the offense gained ground.
            </Item>
            <Item term="CPOE">
              Completion percentage over expected. +5 means five points above a throw of that
              difficulty.
            </Item>
            <Item term="The scatter">
              Each dot is one quarterback. Right = more accurate. Up = more EPA. Tap a dot to pin.
              Names live in the tooltip and the pin list — not on the plot.
            </Item>
            <Item term="Min dropbacks">
              Resets when you change down. 3rd down is ~40, 4th down is ~8. A 200-play floor hides
              everyone on those slices.
            </Item>
            <Item term="n">
              Play count. Under 30 is a thin sample — the number is dimmed. Week 1 2026 is almost
              all thin.
            </Item>
            <Item term="Week strip">
              On a pinned 2026 QB, each week’s EPA and n. One week is not a season.
            </Item>
          </dl>
        </section>

        <section className="mt-10">
          <h2 className="font-display text-2xl uppercase tracking-[0.04em]">Lineup</h2>
          <dl className="mt-4 space-y-4 text-sm leading-relaxed">
            <Item term="The roster">
              1 QB, 2 RB, 3 WR, 1 TE, 1 FLEX, 1 D/ST. Cap is $50,000.
            </Item>
            <Item term="Salary">DraftKings-style price.</Item>
            <Item term="Pts / $1k">Projected points per $1,000 of salary.</Item>
            <Item term="Lock">Force that player into the lineup.</Item>
            <Item term="Bench">Never pick that player.</Item>
            <Item term="Hindsight">
              Rebuilds the lineup on this week’s actual PPR after games go final.
            </Item>
            <Item term="Backtest">
              This week on Lineup; 2025 weeks 2–18 on Study. Exact DP vs greedy, scored on actuals.
            </Item>
          </dl>
        </section>

        <section className="mt-10">
          <h2 className="font-display text-2xl uppercase tracking-[0.04em]">Play-calling</h2>
          <dl className="mt-4 space-y-4 text-sm leading-relaxed">
            <Item term="The list">
              All teams, ranked. It scrolls. Tap a row for the heatmap.
            </Item>
            <Item term="4th-down go">
              Share of 4th downs the offense ran or passed instead of punting or kicking.
            </Item>
            <Item term="2nd & short">Pass rate on 2nd-and-1 to 3.</Item>
            <Item term="PROE">Called pass rate minus expected pass rate.</Item>
            <Item term="Heatmap dash">No plays in that down × distance bucket yet.</Item>
          </dl>
        </section>

        <section className="mt-10">
          <h2 className="font-display text-2xl uppercase tracking-[0.04em]">Live</h2>
          <dl className="mt-4 space-y-4 text-sm leading-relaxed">
            <Item term="Live / final">ESPN box: yards, TDs, PPR, 4th-down goes.</Item>
            <Item term="Advanced">
              EPA, CPOE, PROE from nflverse. That file posts the morning after, not during the game.
            </Item>
          </dl>
        </section>

        <section className="mt-10">
          <h2 className="font-display text-2xl uppercase tracking-[0.04em]">First-visit tips</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            Each lab shows a one-time card the first time you open it. That flag lives in this
            browser only — no account.
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-4"
            onClick={() => {
              resetSeen();
              window.location.assign("/");
            }}
          >
            Show tips again
          </Button>
        </section>
      </article>
    </AppShell>
  );
}

function Item({ term, children }: { term: string; children: string }) {
  return (
    <div>
      <dt className="font-medium">{term}</dt>
      <dd className="mt-1 text-muted">{children}</dd>
    </div>
  );
}
