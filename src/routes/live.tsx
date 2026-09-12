import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Headshot } from "@/components/Headshot";
import { FirstLook } from "@/components/FirstLook";
import { MatchHero, MatchTile } from "@/components/match/MatchFace";
import { StatTip } from "@/components/StatTip";
import { Badge } from "@/components/ui/badge";
import { getGameDetail, getScoreboard } from "@/lib/live/functions";
import type { GameDetail, GameStage, LiveGame, Scoreboard } from "@/lib/live/types";
import { teamNick } from "@/lib/nfl";
import { cn, formatCpoe, formatEpa, formatPct } from "@/lib/utils";

type Search = { game?: string };

export const Route = createFileRoute("/live")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    game: typeof s.game === "string" ? s.game : undefined,
  }),
  component: LiveLab,
});

const STAGES: { id: GameStage; label: string; blurb: string }[] = [
  { id: "pregame", label: "Pregame", blurb: "Kickoff window and broadcast." },
  { id: "live", label: "Live", blurb: "Box score ticks during the game." },
  { id: "final", label: "Final whistle", blurb: "Official box + play-calling from the ESPN play list." },
  { id: "advanced", label: "Advanced", blurb: "EPA, CPOE, PROE from nflverse — usually next morning." },
];

function prettyQb(short: string, detail: GameDetail | null) {
  const last = short.split(".").pop()?.toLowerCase();
  if (!last || !detail) return short;
  const hit = detail.players.find((p) => p.pos === "QB" && p.name.toLowerCase().endsWith(last));
  return hit?.name ?? short;
}

function stageIndex(s: GameStage) {
  return STAGES.findIndex((x) => x.id === s);
}

function LiveLab() {
  const { game: selectedId } = Route.useSearch();
  const navigate = useNavigate({ from: "/live" });
  const [board, setBoard] = useState<Scoreboard | null>(null);
  const [detail, setDetail] = useState<GameDetail | null>(null);
  const [boardErr, setBoardErr] = useState<string | null>(null);
  const [detailErr, setDetailErr] = useState<string | null>(null);

  const selected = useMemo(() => {
    if (!board) return null;
    if (selectedId) return board.games.find((g) => g.id === selectedId) ?? board.games[0] ?? null;
    return board.games.find((g) => g.status === "in") ?? board.games.find((g) => g.status === "post") ?? board.games[0] ?? null;
  }, [board, selectedId]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const next = await getScoreboard();
        if (!cancelled) {
          setBoard(next);
          setBoardErr(null);
        }
      } catch (err) {
        if (!cancelled) setBoardErr(err instanceof Error ? err.message : "Live feed unavailable");
      }
    };
    void tick();
    const ms = board?.anyLive ? 15000 : 60000;
    const id = window.setInterval(() => void tick(), ms);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [board?.anyLive]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    const load = async () => {
      try {
        const next = await getGameDetail({ data: { eventId: selected.id } });
        if (!cancelled) {
          setDetail(next);
          setDetailErr(null);
        }
      } catch (err) {
        if (!cancelled) setDetailErr(err instanceof Error ? err.message : "Couldn't load this game");
      }
    };
    void load();
    const live = selected.status === "in";
    const id = window.setInterval(() => void load(), live ? 15000 : 90000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [selected?.id, selected?.status]);

  const pick = (id: string) => {
    void navigate({ search: { game: id } });
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <header className="max-w-2xl">
          <h1 className="font-display text-5xl uppercase tracking-[0.03em] sm:text-6xl">Live</h1>
        </header>
        <FirstLook id="live" title="This page">
          <p>
            Pick a game. Live and final are the ESPN box. Advanced (EPA, CPOE) shows up the morning
            after, when nflverse posts.
          </p>
        </FirstLook>

        {boardErr && (
          <p className="mt-6 text-sm text-rust">Live feed is down. The 2023–2025 labs still work.</p>
        )}

        {board && (
          <p className="mt-6 text-[11px] tracking-[0.14em] text-subtle uppercase">
            Week {board.week} · {board.anyLive ? "polling every 15s" : "idle poll"} ·{" "}
            {board.games.filter((g) => g.stage === "advanced").length} with advanced
          </p>
        )}

        {selected && (
          <div className="mt-6">
            <MatchHero game={selected} />
          </div>
        )}

        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {(board?.games ?? []).map((g) => (
            <MatchTile key={g.id} game={g} active={selected?.id === g.id} onPick={() => pick(g.id)} />
          ))}
        </div>

        {selected && (
          <GamePanel
            game={selected}
            detail={detail?.game.id === selected.id ? detail : null}
            error={detailErr}
          />
        )}
      </div>
    </AppShell>
  );
}

function StageBadge({ stage }: { stage: GameStage }) {
  if (stage === "live") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-sage uppercase">
        <span className="live-dot" />
        Live
      </span>
    );
  }
  const variant = stage === "advanced" ? "sage" : stage === "final" ? "accent" : "outline";
  const label = stage === "pregame" ? "Pregame" : stage === "final" ? "Final" : "Advanced";
  return <Badge variant={variant}>{label}</Badge>;
}

function GamePanel({
  game,
  detail,
  error,
}: {
  game: LiveGame;
  detail: GameDetail | null;
  error: string | null;
}) {
  const idx = stageIndex(game.stage);
  const qbs = (detail?.players ?? []).filter((p) => p.pos === "QB");
  const skill = (detail?.players ?? []).filter((p) => p.pos !== "QB").slice(0, 8);

  return (
    <section className="mt-8 rounded-xl bg-surface p-5 shadow-[var(--shadow-border)] sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] tracking-[0.14em] text-subtle uppercase">
            {game.broadcast ?? "NFL"} · {game.venue ?? "Week " + game.week}
          </p>
          <h2 className="mt-1 font-display text-3xl uppercase tracking-[0.04em]">
            {game.away.nick} {game.away.score} · {game.home.nick} {game.home.score}
          </h2>
          <p className="mt-1 text-sm text-muted">{game.statusText}</p>
        </div>
        <StageBadge stage={game.stage} />
      </div>

      <ol className="mt-6 grid gap-2 sm:grid-cols-4">
        {STAGES.map((s, i) => {
          const done = i <= idx;
          const current = i === idx;
          return (
            <li
              key={s.id}
              className={cn(
                "rounded-lg px-3 py-3",
                current ? "bg-elevated shadow-[var(--shadow-border)]" : "bg-elevated/40",
              )}
            >
              <p className={cn("text-[11px] tracking-[0.14em] uppercase", done ? "text-sage" : "text-subtle")}>
                {s.label}
              </p>
              <p className="mt-1 text-xs text-muted">{s.blurb}</p>
            </li>
          );
        })}
      </ol>

      {game.lastPlay && (
        <p className="mt-5 text-sm text-muted">
          <span className="text-[11px] tracking-[0.14em] text-subtle uppercase">Last play </span>
          {game.lastPlay}
        </p>
      )}

      {error && <p className="mt-4 text-sm text-rust">{error}</p>}

      {detail && (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {detail.teamBox.map((t) => (
              <div key={t.abbr} className="rounded-lg bg-elevated p-4">
                <p className="font-display text-xl uppercase tracking-[0.04em]">{teamNick(t.abbr)}</p>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <Stat label="Yards" value={t.yards == null ? "—" : String(t.yards)} />
                  <Stat label="Plays" value={t.plays == null ? "—" : String(t.plays)} />
                  <Stat label="Pass / rush" value={`${t.passYds ?? "—"} / ${t.rushYds ?? "—"}`} />
                  <Stat label="3rd / 4th" value={`${t.thirdDown ?? "—"} · ${t.fourthDown ?? "—"}`} />
                </dl>
              </div>
            ))}
          </div>

          <h3 className="mt-8 font-display text-xl uppercase tracking-[0.06em]">Quarterbacks</h3>
          <p className="mt-1 text-xs text-subtle">Box line now. EPA / CPOE when Advanced is in.</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="text-[11px] tracking-[0.12em] text-subtle uppercase">
                <tr className="border-y border-border">
                  <th className="px-2 py-2 font-medium">QB</th>
                  <th className="px-2 py-2 text-right font-medium">C/ATT</th>
                  <th className="px-2 py-2 text-right font-medium">Yds</th>
                  <th className="px-2 py-2 text-right font-medium">TD/INT</th>
                  <th className="px-2 py-2 text-right font-medium">
                    <StatTip metric="ppr" />
                  </th>
                  <th className="px-2 py-2 text-right font-medium">
                    <StatTip metric="epa" />
                  </th>
                  <th className="px-2 py-2 text-right font-medium">
                    <StatTip metric="cpoe" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {qbs.map((p) => {
                  const adv = detail.advanced?.qbs.find((q) => prettyQb(q.name, detail) === p.name)
                    ?? detail.advanced?.qbs.find((q) => q.team === p.team);
                  return (
                    <tr key={p.id} className="border-b border-border/70">
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-2">
                          <Headshot src={p.headshot} name={p.name} team={p.team} className="size-8" />
                          <div>
                            <p className="font-medium">{p.name}</p>
                            <p className="text-xs text-muted">{teamNick(p.team)}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">
                        {p.passCmp ?? "—"}/{p.passAtt ?? "—"}
                      </td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">{p.passYds}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">
                        {p.passTd}/{p.ints}
                      </td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">{p.ppr.toFixed(1)}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums text-sage">
                        {adv ? formatEpa(adv.epa) : "—"}
                      </td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">
                        {adv ? formatCpoe(adv.cpoe) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!detail.advanced && game.status === "post" && (
            <p className="mt-2 text-xs text-muted">
              Advanced pending — nflverse has not posted EPA for this game yet.
            </p>
          )}

          <h3 className="mt-8 font-display text-xl uppercase tracking-[0.06em]">Live PPR</h3>
          <ul className="mt-3 divide-y divide-border">
            {skill.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Headshot src={p.headshot} name={p.name} team={p.team} className="size-8" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{p.name}</p>
                    <p className="text-xs text-muted">
                      {p.pos} · {teamNick(p.team)}
                    </p>
                  </div>
                </div>
                <span className="font-mono text-sm tabular-nums">{p.ppr.toFixed(1)}</span>
              </li>
            ))}
          </ul>

          <h3 className="mt-8 font-display text-xl uppercase tracking-[0.06em]">Play-calling</h3>
          <p className="mt-1 text-xs text-subtle">
            From the play list at the whistle. PROE / EPA fill in on Advanced.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead className="text-[11px] tracking-[0.12em] text-subtle uppercase">
                <tr className="border-y border-border">
                  <th className="px-2 py-2 font-medium">Team</th>
                  <th className="px-2 py-2 text-right font-medium">Pass%</th>
                  <th className="px-2 py-2 text-right font-medium">
                    <StatTip metric="secondShort">2nd & short</StatTip>
                  </th>
                  <th className="px-2 py-2 text-right font-medium">
                    <StatTip metric="fourthGo">4th go</StatTip>
                  </th>
                  <th className="px-2 py-2 text-right font-medium">
                    <StatTip metric="proe" />
                  </th>
                  <th className="px-2 py-2 text-right font-medium">
                    <StatTip metric="epa" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {detail.calling.map((c) => {
                  const adv = detail.advanced?.teams.find((t) => t.team === c.team);
                  return (
                    <tr key={c.team} className="border-b border-border/70">
                      <td className="px-2 py-2">{teamNick(c.team)}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">{formatPct(c.passRate)}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">
                        {formatPct(c.secondAndShortPass)}
                        <span className="ml-1 text-subtle">
                          {c.secondAndShortN} play{c.secondAndShortN === 1 ? "" : "s"}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">
                        {formatPct(c.fourthGoRate)}
                        <span className="ml-1 text-subtle">
                          {c.fourthOpps} 4th down{c.fourthOpps === 1 ? "" : "s"}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">
                        {adv?.proe == null ? "—" : `${adv.proe > 0 ? "+" : ""}${adv.proe.toFixed(1)}`}
                      </td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums text-sage">
                        {adv ? formatEpa(adv.epa) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {detail.scoring.length > 0 && (
            <>
              <h3 className="mt-8 font-display text-xl uppercase tracking-[0.06em]">Scoring</h3>
              <ul className="mt-3 space-y-2">
                {detail.scoring.map((s, i) => (
                  <li key={`${s.q}-${s.clock}-${i}`} className="text-sm text-muted">
                    <span className="font-mono text-xs text-subtle">Q{s.q} {s.clock}</span>
                    <span className="ml-2 text-fg">{teamNick(s.team)}</span>
                    <span className="ml-2">{s.text}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] tracking-[0.12em] text-subtle uppercase">{label}</dt>
      <dd className="mt-0.5 font-mono tabular-nums">{value}</dd>
    </div>
  );
}
