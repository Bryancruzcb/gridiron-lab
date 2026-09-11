import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight, Binary, LayoutDashboard, Radio, Waypoints } from "lucide-react";
import { useEffect, useState } from "react";
import qbsFile from "@/data/qbs.json";
import playFile from "@/data/playcalling.json";
import snapFile from "@/data/season2026.json";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { getScoreboard, getSeasonLabs } from "@/lib/live/functions";
import type { Scoreboard, SeasonLabs } from "@/lib/live/types";
import { formatEpa, formatPct } from "@/lib/utils";
import { teamNick } from "@/lib/nfl";
import type { QbFile, PlaycallingFile, QbSeason, TeamSeason } from "@/data/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({ component: Home });

const qbData = qbsFile as QbFile;
const pcData = playFile as unknown as PlaycallingFile;
const snap = snapFile as unknown as SeasonLabs;

const LABS = [
  {
    to: "/live" as const,
    kicker: "00",
    title: "Live wire",
    icon: Radio,
    tools: "In-game · Final · Advanced",
    blurb:
      "Watch a 2026 game through every stage: live box and PPR during the play clock, play-calling at the whistle, EPA and CPOE when nflverse posts.",
  },
  {
    to: "/qb" as const,
    kicker: "01",
    title: "QB comparison",
    icon: LayoutDashboard,
    tools: "Dashboard · EPA · CPOE",
    blurb:
      "Rank and overlay quarterbacks on EPA per dropback, completion percentage over expected, and pressure rate. 2023–2025 plus 2026 as it posts.",
  },
  {
    to: "/optimizer" as const,
    kicker: "02",
    title: "Fantasy optimizer",
    icon: Binary,
    tools: "Integer program · PPR",
    blurb:
      "A salary-cap lineup solver with lock / exclude, a QB stack, and this week’s live PPR so you can score the lineup — or solve the hindsight roster.",
  },
  {
    to: "/play-calling" as const,
    kicker: "03",
    title: "Play-calling",
    icon: Waypoints,
    tools: "Tendencies · 4th down",
    blurb:
      "Who throws on 2nd-and-short, who goes for it on 4th, and which staffs out-pass expectation. 2023–2025, with 2026 filling in after each dump.",
  },
];

function Home() {
  const [y26, setY26] = useState<SeasonLabs | null>(null);
  useEffect(() => {
    getSeasonLabs()
      .then(setY26)
      .catch(() => {
        /* historical boards still work */
      });
  }, []);

  const histLeaders = (qbData.qbs as QbSeason[])
    .filter((q) => q.season === 2025 && q.overall.plays >= 250)
    .slice()
    .sort((a, b) => (b.overall.epa ?? -99) - (a.overall.epa ?? -99))
    .slice(0, 5);
  const overlay = y26?.qbs.length ? y26 : snap;
  const liveLeaders = overlay.qbs
    .slice()
    .sort((a, b) => (b.overall.epa ?? -99) - (a.overall.epa ?? -99))
    .slice(0, 5);
  const use26 = liveLeaders.length > 0;
  const leaders = use26 ? liveLeaders : histLeaders;
  const goers = (
    use26 && overlay.teams.length
      ? overlay.teams
      : (pcData.teams as TeamSeason[]).filter((t) => t.season === 2025)
  )
    .slice()
    .sort((a, b) => (b.fourthDown.goRate ?? 0) - (a.fourthDown.goRate ?? 0))
    .slice(0, 3);

  return (
    <AppShell>
      <section className="relative overflow-hidden hash-mark">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
          <div className="stagger-in max-w-2xl">
            <p className="text-[11px] font-medium tracking-[0.22em] text-sage uppercase">
              NFL analytics portfolio
            </p>
            <h1 className="mt-4 font-display text-[clamp(3rem,10vw,6.5rem)] leading-[0.9] tracking-[0.02em] uppercase">
              Three labs.
              <br />
              A live wire.
            </h1>
            <p className="mt-6 max-w-lg text-base leading-relaxed text-muted sm:text-lg">
              The three portfolio labs stay current with 2026: EPA and CPOE in the QB lab,
              play-calling after each dump, and this week’s PPR on the optimizer. Live wire is the
              in-game feed.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild>
                <Link to="/live">
                  Open live wire
                  <ArrowUpRight className="size-4" />
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/qb">QB lab</Link>
              </Button>
            </div>
          </div>
          <div className="rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]">
            <p className="text-[11px] tracking-[0.16em] text-subtle uppercase">
              {use26 ? `2026 EPA / dropback · week ${overlay.throughWeek}` : "2025 EPA / dropback"}
            </p>
            <ol className="mt-4 divide-y divide-border">
              {leaders.map((q, i) => (
                <li key={q.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="flex items-center gap-3">
                    <span className="w-5 font-mono text-xs text-subtle">{i + 1}</span>
                    <div>
                      <p className="text-sm font-medium">{q.name}</p>
                      <p className="text-xs text-muted">{teamNick(q.team)}</p>
                    </div>
                  </div>
                  <span className="font-mono text-sm tabular-nums text-sage">
                    {formatEpa(q.overall.epa)}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <LiveStrip />

      <section className="border-t border-border">
        <div className="mx-auto grid max-w-6xl gap-4 px-4 py-12 sm:px-6 lg:grid-cols-2">
          {LABS.map((lab) => {
            const Icon = lab.icon;
            return (
              <Link
                key={lab.to}
                to={lab.to}
                className="group flex flex-col rounded-xl bg-surface p-5 shadow-[var(--shadow-border)] transition-[box-shadow,transform] duration-200 ease-out hover:shadow-[var(--shadow-border-hover)]"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-subtle">{lab.kicker}</span>
                  <Icon className="size-4 text-muted" />
                </div>
                <h2 className="mt-6 font-display text-3xl uppercase tracking-[0.04em]">
                  {lab.title}
                </h2>
                <p className="mt-1 text-[11px] tracking-[0.14em] text-sage uppercase">{lab.tools}</p>
                <p className="mt-4 flex-1 text-sm leading-relaxed text-muted">{lab.blurb}</p>
                <span className="mt-6 inline-flex items-center gap-1 text-sm text-fg">
                  Open lab
                  <ArrowUpRight className="size-4 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="border-t border-border">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-2">
          <div>
            <h2 className="font-display text-3xl uppercase tracking-[0.04em]">Why these three</h2>
            <p className="mt-4 text-sm leading-relaxed text-muted">
              Recruiters see a lot of Titanic notebooks. They do not see many people who can talk
              EPA, write a constraint set, and show a coach-level tendency chart without switching
              tools. Each lab here is a closed demo with the same stats you would pull from
              nflfastR — plus the filters that make the analysis feel like a product, not a
              screenshot.
            </p>
          </div>
          <div className="rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]">
            <p className="text-[11px] tracking-[0.16em] text-subtle uppercase">
              {use26 ? "2026 4th-down go rate" : "2025 4th-down go rate"}
            </p>
            <ul className="mt-4 space-y-3">
              {goers.map((t) => (
                <li key={t.team} className="flex items-center justify-between">
                  <span className="text-sm">
                    {teamNick(t.team)}
                    {t.coach ? <span className="ml-2 text-xs text-muted">{t.coach}</span> : null}
                  </span>
                  <span className="font-mono text-sm tabular-nums">
                    {formatPct(t.fourthDown.goRate)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </AppShell>
  );
}

function LiveStrip() {
  const [board, setBoard] = useState<Scoreboard | null>(null);

  useEffect(() => {
    let cancelled = false;
    getScoreboard()
      .then((b) => {
        if (!cancelled) setBoard(b);
      })
      .catch(() => {
        /* home still works without the live feed */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!board) return null;
  const featured = [
    ...board.games.filter((g) => g.status === "in"),
    ...board.games.filter((g) => g.status === "post"),
    ...board.games.filter((g) => g.status === "pre"),
  ].slice(0, 4);

  return (
    <section className="border-t border-border">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <p className="text-[11px] tracking-[0.16em] text-subtle uppercase">
            2026 week {board.week}
          </p>
          <Link to="/live" className="text-sm text-fg">
            Full slate
            <ArrowUpRight className="ml-1 inline size-3.5" />
          </Link>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {featured.map((g) => (
            <Link
              key={g.id}
              to="/live"
              search={{ game: g.id }}
              className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]"
            >
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    "text-[11px] font-medium tracking-wide uppercase",
                    g.status === "in" ? "text-sage" : "text-subtle",
                  )}
                >
                  {g.status === "in" ? "Live" : g.stage === "advanced" ? "Advanced" : g.statusText}
                </span>
                {g.status === "in" ? <span className="live-dot" /> : null}
              </div>
              <p className="mt-2 text-sm">
                {g.away.nick} {g.away.score}
              </p>
              <p className="text-sm">
                {g.home.nick} {g.home.score}
              </p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
