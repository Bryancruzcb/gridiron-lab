import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight, Binary, LayoutDashboard, Radio, ScrollText, Users, Waypoints } from "lucide-react";
import { useEffect, useState } from "react";
import qbsFile from "@/data/qbs.json";
import playFile from "@/data/playcalling.json";
import { AppShell } from "@/components/layout/AppShell";
import { Headshot } from "@/components/Headshot";
import { SampleN } from "@/components/SampleN";
import { MatchHero, MatchTile } from "@/components/match/MatchFace";
import { getScoreboard } from "@/lib/live/functions";
import type { Scoreboard } from "@/lib/live/types";
import { formatEpa, formatPct } from "@/lib/utils";
import { teamLogo, teamNick } from "@/lib/nfl";
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
    to: "/players" as const,
    title: "Players",
    icon: Users,
    blurb: "This week’s box and last season’s line. Search, tap a name.",
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
      <section className="px-4 pt-8 sm:px-6 sm:pt-10">
        <div className="mx-auto max-w-6xl">
          <h1 className="font-display text-5xl uppercase tracking-[0.04em] sm:text-6xl">Gridiron</h1>
          <p className="mt-2 text-sm text-muted">NFL. Live box. EPA when the file posts.</p>
        </div>
      </section>

      <LiveStrip />

      <section className="border-t border-border">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-10 sm:px-6 lg:grid-cols-2">
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
                      <p className="flex items-center gap-1.5 text-xs text-muted">
                        <img src={teamLogo(q.team)} alt="" className="size-3.5 object-contain" />
                        {teamNick(q.team)}
                      </p>
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
            <Link to="/qb" className="mt-4 inline-flex items-center gap-1 text-sm">
              QB lab
              <ArrowUpRight className="size-3.5" />
            </Link>
          </div>
          <div className="rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]">
            <p className="text-[11px] tracking-[0.16em] text-subtle uppercase">
              {use26 ? `2026 4th-down go · week ${overlay.throughWeek}` : "2025 4th-down go"}
            </p>
            <ul className="mt-4 space-y-3">
              {goers.map((t) => (
                <li key={t.team} className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2 text-sm">
                    <img src={teamLogo(t.team)} alt="" className="size-5 object-contain" />
                    {teamNick(t.team)}
                  </span>
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
  ];
  const hero = featured[0];
  const rest = featured.slice(1, 5);

  const days = [...new Map(
    board.games.map((g) => {
      const d = new Date(g.start);
      const key = d.toISOString().slice(0, 10);
      return [key, d] as const;
    }),
  ).values()].sort((a, b) => a.getTime() - b.getTime());
  const today = new Date().toISOString().slice(0, 10);

  return (
    <section className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {days.map((d) => {
          const key = d.toISOString().slice(0, 10);
          const on = key === today;
          return (
            <span
              key={key}
              className={cn(
                "grid size-11 shrink-0 place-items-center rounded-full text-xs font-medium",
                on ? "bg-fg text-bg" : "bg-elevated text-muted",
              )}
            >
              {d.getDate()}
            </span>
          );
        })}
      </div>
      {hero ? (
        <Link to="/live" search={{ game: hero.id }} className="block">
          <MatchHero game={hero} />
        </Link>
      ) : null}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {rest.map((g) => (
          <Link key={g.id} to="/live" search={{ game: g.id }}>
            <MatchTile game={g} />
          </Link>
        ))}
      </div>
      <Link to="/live" className="mt-4 inline-flex items-center gap-1 text-sm">
        Full slate
        <ArrowUpRight className="size-3.5" />
      </Link>
    </section>
  );
}
