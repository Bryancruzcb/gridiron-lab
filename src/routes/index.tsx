import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight, Binary, LayoutDashboard, Radio, ScrollText, Users, Waypoints } from "lucide-react";
import qbsFile from "@/data/qbs.json";
import playFile from "@/data/playcalling.json";
import { AppShell } from "@/components/layout/AppShell";
import { FeedStatus } from "@/components/DataStatus";
import { Headshot } from "@/components/Headshot";
import { SampleN } from "@/components/SampleN";
import { formatEpa, formatPct } from "@/lib/utils";
import { teamLogo, teamNick } from "@/lib/nfl";
import { isThin } from "@/lib/season";
import { useSeason } from "@/lib/season-provider";
import type { Scoreboard } from "@/lib/live/types";
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
    blurb: "2023–2025 look back. Did the Lineup computer beat grabbing the top names?",
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
  const teams26 = use26 && overlay.teams.length > 0;
  const goers = (teams26 ? overlay.teams : (pcData.teams as TeamSeason[]).filter((t) => t.season === 2025))
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
              {use26 ? "2026 EPA / dropback" : "2025 EPA / dropback"}
            </p>
            {use26 ? <FeedStatus feed="labs" section="qbs" className="mt-2" /> : null}
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
              {teams26 ? "2026 4th-down go" : "2025 4th-down go"}
            </p>
            {teams26 ? <FeedStatus feed="labs" section="teams" className="mt-2" /> : null}
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
  const { scoreboard: board, feeds } = useSeason();
  if (!board) {
    return (
      <section className="border-t border-border">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <p className="text-[11px] tracking-[0.16em] text-subtle uppercase">This week’s slate</p>
          <FeedStatus feed="scoreboard" className="mt-3" />
          {feeds.scoreboard.error ? null : (
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-24 rounded-xl bg-surface" />
              ))}
            </div>
          )}
        </div>
      </section>
    );
  }
  const featured = [
    ...board.games.filter((g) => g.status === "in"),
    ...board.games.filter((g) => g.status === "post"),
    ...board.games.filter((g) => g.status === "pre"),
  ].slice(0, 4);

  return (
    <section className="border-t border-border">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <p className="text-[11px] tracking-[0.16em] text-subtle uppercase">
            2026 week {board.week}
          </p>
          <Link to="/live" className="text-sm text-fg">
            Full slate
            <ArrowUpRight className="ml-1 inline size-3.5" />
          </Link>
        </div>
        <FeedStatus feed="scoreboard" className="mb-4" />
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {featured.map((g) => (
            <Link
              key={g.id}
              to="/live"
              search={{ game: g.id }}
              className="rounded-xl bg-surface p-4"
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
        {side.logo ? <img src={side.logo} alt="" className="size-6 object-contain" /> : null}
        <span className="truncate text-sm">{side.nick}</span>
      </span>
      <span className={cn("font-mono text-sm tabular-nums", side.winner && "text-sage")}>
        {side.score}
      </span>
    </p>
  );
}


