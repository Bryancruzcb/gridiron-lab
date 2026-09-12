import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight, Binary, LayoutDashboard, Radio, ScrollText, Waypoints } from "lucide-react";
import { useEffect, useState } from "react";
import qbsFile from "@/data/qbs.json";
import playFile from "@/data/playcalling.json";
import { AppShell } from "@/components/layout/AppShell";
import { Headshot } from "@/components/Headshot";
import { SampleN } from "@/components/SampleN";
import { Button } from "@/components/ui/button";
import { getScoreboard } from "@/lib/live/functions";
import type { Scoreboard } from "@/lib/live/types";
import { formatEpa, formatPct } from "@/lib/utils";
import { teamNick } from "@/lib/nfl";
import { isThin } from "@/lib/season";
import { useSeason } from "@/lib/season-provider";
import type { QbFile, PlaycallingFile, QbSeason, TeamSeason } from "@/data/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({ component: Home });

const qbData = qbsFile as QbFile;
const pcData = playFile as unknown as PlaycallingFile;

const LABS = [
  {
    to: "/live" as const,
    title: "Live",
    icon: Radio,
    blurb: "Box score while the game is on. EPA the next morning.",
  },
  {
    to: "/qb" as const,
    title: "QB",
    icon: LayoutDashboard,
    blurb: "EPA and CPOE, with down and distance filters.",
  },
  {
    to: "/optimizer" as const,
    title: "Lineup",
    icon: Binary,
    blurb: "$50k roster. Lock, bench, solve. Hindsight after games.",
  },
  {
    to: "/study" as const,
    title: "Study",
    icon: ScrollText,
    blurb: "2025 holdout. Solver vs greedy. EPA this week vs next.",
  },
  {
    to: "/play-calling" as const,
    title: "Play-calling",
    icon: Waypoints,
    blurb: "4th-down goes, 2nd-and-short, down × distance heatmap.",
  },
];

function Home() {
  const { labs } = useSeason();

  const histLeaders = (qbData.qbs as QbSeason[])
    .filter((q) => q.season === 2025 && q.overall.plays >= 250)
    .slice()
    .sort((a, b) => (b.overall.epa ?? -99) - (a.overall.epa ?? -99))
    .slice(0, 5);
  const overlay = labs;
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
            <h1 className="mt-4 font-display text-[clamp(3rem,10vw,6.5rem)] leading-[0.9] tracking-[0.02em] uppercase">
              Gridiron Lab
            </h1>
            <p className="mt-6 max-w-lg text-base leading-relaxed text-muted sm:text-lg">
              QB stats, a $50k lineup, play-calling, and a live box. 2023–2026.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild>
                <Link to="/live">
                  Live
                  <ArrowUpRight className="size-4" />
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/qb">QB</Link>
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
                    <Headshot src={q.headshot} name={q.name} team={q.team} className="size-10" />
                    <div>
                      <p className="text-sm font-medium">{q.name}</p>
                      <p className="text-xs text-muted">{teamNick(q.team)}</p>
                    </div>
                  </div>
                  <span className="text-right">
                    <span
                      className={cn(
                        "font-mono text-sm tabular-nums",
                        isThin(q.overall.plays) ? "text-muted" : "text-sage",
                      )}
                    >
                      {formatEpa(q.overall.epa)}
                    </span>
                    <div>
                      <SampleN n={q.overall.plays} unit="dropbacks" />
                    </div>
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
                  <Icon className="size-4 text-muted" />
                </div>
                <h2 className="mt-6 font-display text-3xl uppercase tracking-[0.04em]">
                  {lab.title}
                </h2>
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
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          <div className="max-w-md rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]">
            <p className="text-[11px] tracking-[0.16em] text-subtle uppercase">
              {use26 ? `2026 4th-down go · week ${overlay.throughWeek}` : "2025 4th-down go"}
            </p>
            <ul className="mt-4 space-y-3">
              {goers.map((t) => (
                <li key={t.team} className="flex items-center justify-between gap-3">
                  <span className="text-sm">{teamNick(t.team)}</span>
                  <span className="text-right">
                    <span
                      className={cn(
                        "font-mono text-sm tabular-nums",
                        isThin(t.fourthDown.opps) && "text-muted",
                      )}
                    >
                      {formatPct(t.fourthDown.goRate)}
                    </span>
                    <div>
                      <SampleN n={t.fourthDown.opps} unit="4th downs" />
                    </div>
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
              <div className="mt-3 space-y-1.5">
                <StripSide side={g.away} />
                <StripSide side={g.home} />
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function StripSide({ side }: { side: Scoreboard["games"][number]["away"] }) {
  return (
    <p className="flex items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-2">
        {side.logo ? (
          <img src={side.logo} alt="" className="size-6 object-contain" />
        ) : null}
        <span className="truncate text-sm">{side.nick}</span>
      </span>
      <span className={cn("font-mono text-sm tabular-nums", side.winner && "text-sage")}>
        {side.score}
      </span>
    </p>
  );
}
