import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import fantasyFile from "@/data/fantasy.json";
import { AppShell } from "@/components/layout/AppShell";
import { FeedStatus } from "@/components/DataStatus";
import { Headshot } from "@/components/Headshot";
import { FirstLook } from "@/components/FirstLook";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { FantasyFile, FantasyPlayer, FantasyPos } from "@/data/types";
import type { WeekSkill } from "@/lib/live/types";
import { lastTeamKey, nameTeamKey } from "@/lib/live/names";
import { teamLogo, teamNick } from "@/lib/nfl";
import { useSeason } from "@/lib/season-provider";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/players")({ component: PlayersPage });

const data = fantasyFile as FantasyFile;
const POS: (FantasyPos | "ALL")[] = ["ALL", "QB", "RB", "WR", "TE", "DST"];

type Row = {
  key: string;
  name: string;
  team: string;
  pos: FantasyPos;
  headshot: string | null;
  season: FantasyPlayer | null;
  week: WeekSkill | null;
};

function matchWeek(players: FantasyPlayer[], week: WeekSkill[]) {
  const byName = new Map<string, WeekSkill>();
  const byLast = new Map<string, WeekSkill[]>();
  for (const w of week) {
    byName.set(nameTeamKey(w.name, w.team), w);
    if (w.pos === "DST") byName.set(`dst|${w.team}`, w);
    const lk = lastTeamKey(w.name, w.team);
    const arr = byLast.get(lk) ?? [];
    arr.push(w);
    byLast.set(lk, arr);
  }
  const used = new Set<WeekSkill>();
  const hit = (p: FantasyPlayer): WeekSkill | null => {
    if (p.pos === "DST") {
      const w = byName.get(`dst|${p.team}`) ?? byName.get(nameTeamKey(p.name, p.team));
      if (w) used.add(w);
      return w ?? null;
    }
    const named = byName.get(nameTeamKey(p.name, p.team));
    if (named) {
      used.add(named);
      return named;
    }
    const last = byLast.get(lastTeamKey(p.name, p.team));
    if (last?.length === 1) {
      used.add(last[0]!);
      return last[0]!;
    }
    return null;
  };
  return { hit, used };
}

function weekLine(w: WeekSkill) {
  if (w.pos === "QB") {
    const att = w.passAtt;
    const cmp = w.passCmp;
    return `${cmp ?? "—"}/${att ?? "—"} · ${w.passYds ?? 0} yds · ${w.passTd ?? 0} TD · ${w.ints ?? 0} INT`;
  }
  if (w.pos === "DST") return `${w.ppr.toFixed(1)} PPR`;
  const bits: string[] = [];
  if ((w.rec ?? 0) > 0) bits.push(`${w.rec} rec · ${w.recYds ?? 0} yds`);
  if ((w.rushAtt ?? 0) > 0 || (w.rushYds ?? 0) > 0) bits.push(`${w.rushYds ?? 0} rush`);
  if ((w.recTd ?? 0) + (w.rushTd ?? 0) > 0) bits.push(`${(w.recTd ?? 0) + (w.rushTd ?? 0)} TD`);
  return bits.length ? bits.join(" · ") : `${w.ppr.toFixed(1)} PPR`;
}

function PlayersPage() {
  const { weekPpr } = useSeason();
  const [pos, setPos] = useState<(typeof POS)[number]>("ALL");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Row | null>(null);

  const rows = useMemo(() => {
    const week = weekPpr?.players ?? [];
    const { hit, used } = matchWeek(data.players, week);
    const out: Row[] = data.players.map((p) => ({
      key: p.id,
      name: p.name,
      team: p.team,
      pos: p.pos,
      headshot: p.headshot,
      season: p,
      week: hit(p),
    }));
    for (const w of week) {
      if (used.has(w)) continue;
      const ppos = w.pos === "FLEX" ? "WR" : w.pos;
      out.push({
        key: `w-${w.espnId}`,
        name: w.name,
        team: w.team,
        pos: ppos,
        headshot: w.headshot,
        season: null,
        week: w,
      });
    }
    return out;
  }, [weekPpr]);

  const mix = useMemo(() => {
    const lines = weekPpr?.players ?? [];
    return {
      provisional: lines.filter((w) => w.source === "espn").length,
      published: lines.filter((w) => w.source === "nflverse").length,
      partial: lines.filter((w) => w.score.status === "partial").length,
    };
  }, [weekPpr]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows
      .filter((r) => (pos === "ALL" ? true : r.pos === pos))
      .filter((r) => {
        if (!needle) return true;
        return r.name.toLowerCase().includes(needle) || r.team.toLowerCase().includes(needle);
      })
      .sort((a, b) => (b.week?.ppr ?? -1) - (a.week?.ppr ?? -1) || (b.season?.ppg ?? 0) - (a.season?.ppg ?? 0));
  }, [rows, pos, q]);

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <h1 className="font-display text-5xl uppercase tracking-[0.03em] sm:text-6xl">Players</h1>
        <FirstLook id="players" title="This page">
          <p>
            This week’s box from ESPN, 2025 season line from the slate. Tap a name for the full
            counting stats. Not a projection sheet.
          </p>
        </FirstLook>

        <div className="mt-6 flex flex-col gap-3 rounded-xl bg-surface p-4 sm:p-5">
          <Segmented
            value={pos}
            onChange={setPos}
            options={POS.map((p) => ({ value: p, label: p === "ALL" ? "All" : p }))}
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name or team"
            className="h-11"
          />
          <p className="text-[11px] tracking-[0.14em] text-subtle uppercase">
            {filtered.length} players
            {weekPpr ? ` · week ${weekPpr.week}` : ""}
          </p>
          <FeedStatus feed="weekPpr" />
          {weekPpr && weekPpr.players.length > 0 ? (
            <p data-testid="week-source-mix" className="text-xs text-muted">
              {mix.provisional} provisional ESPN line{mix.provisional === 1 ? "" : "s"} · {mix.published} published by
              nflverse
              {mix.partial ? ` · ${mix.partial} partly scored (a stat ESPN didn't report)` : ""}
            </p>
          ) : null}
        </div>

        <ul className="mt-4 overflow-hidden rounded-xl bg-surface">
          {filtered.map((r) => (
            <li key={r.key} className="border-b border-border/70 last:border-0">
              <button
                type="button"
                onClick={() => setOpen(r)}
                className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-3 text-left"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Headshot src={r.headshot} name={r.name} team={r.team} className="size-10" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.name}</p>
                    <p className="flex items-center gap-1.5 text-xs text-muted">
                      <img src={teamLogo(r.team)} alt="" className="size-3.5 object-contain" />
                      {r.pos} · {teamNick(r.team)}
                    </p>
                    {r.week ? (
                      <p className="mt-0.5 font-mono text-[11px] text-muted tabular-nums">{weekLine(r.week)}</p>
                    ) : (
                      <p className="mt-0.5 text-[11px] text-subtle">
                        {weekPpr ? "No box this week" : "This week's box not loaded"}
                      </p>
                    )}
                  </div>
                </div>
                <span className="shrink-0 text-right">
                  <span className="block font-mono text-sm tabular-nums">
                    {r.week ? r.week.ppr.toFixed(1) : "—"}
                  </span>
                  <span className="text-[11px] text-muted">
                    {r.season ? `${r.season.ppg.toFixed(1)} PPG` : "this week"}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <Sheet open={Boolean(open)} onOpenChange={(v) => !v && setOpen(null)}>
        <SheetContent side="bottom" className="bg-surface">
          {open ? <PlayerSheet row={open} weekLoaded={weekPpr != null} /> : null}
        </SheetContent>
      </Sheet>
    </AppShell>
  );
}

function weekSource(w: WeekSkill) {
  if (w.source === "nflverse") return "published by nflverse";
  return w.status === "in" ? "provisional ESPN box, game in progress" : "provisional ESPN box";
}

function PlayerSheet({ row, weekLoaded }: { row: Row; weekLoaded: boolean }) {
  const s = row.season;
  const w = row.week;
  return (
    <div className="overflow-y-auto px-5 pt-5 pb-8">
      <SheetHeader>
        <SheetTitle className="sr-only">{row.name}</SheetTitle>
      </SheetHeader>
      <div className="flex items-center gap-3">
        <Headshot src={row.headshot} name={row.name} team={row.team} className="size-14" />
        <div>
          <p className="text-lg font-medium">{row.name}</p>
          <p className="flex items-center gap-1.5 text-sm text-muted">
            <img src={teamLogo(row.team)} alt="" className="size-4 object-contain" />
            {row.pos} · {teamNick(row.team)}
          </p>
        </div>
      </div>

      <p className="mt-6 text-[11px] tracking-[0.16em] text-subtle uppercase">
        This week{w ? ` · ${weekSource(w)}` : ""}
      </p>
      {w && w.score.status === "partial" ? (
        <p className="mt-1 text-xs text-muted">
          Partly scored: {w.score.unavailable.join(", ")} not reported, so those points are left out.
        </p>
      ) : null}
      {w ? (
        <dl className="mt-2 grid grid-cols-3 gap-2">
          <Cell label="PPR" value={w.ppr.toFixed(1)} />
          {row.pos === "QB" ? (
            <>
              <Cell label="C/ATT" value={`${w.passCmp ?? "—"}/${w.passAtt ?? "—"}`} />
              <Cell label="Pass yds" value={String(w.passYds ?? 0)} />
              <Cell label="Pass TD" value={String(w.passTd ?? 0)} />
              <Cell label="INT" value={String(w.ints ?? 0)} />
              <Cell label="Rush yds" value={String(w.rushYds ?? 0)} />
            </>
          ) : row.pos === "DST" ? (
            <Cell label="Status" value={w.status === "in" ? "Live" : "Final"} />
          ) : (
            <>
              <Cell label="Rec" value={String(w.rec ?? 0)} />
              <Cell label="Rec yds" value={String(w.recYds ?? 0)} />
              <Cell label="Rec TD" value={String(w.recTd ?? 0)} />
              <Cell label="Rush yds" value={String(w.rushYds ?? 0)} />
              <Cell label="Rush TD" value={String(w.rushTd ?? 0)} />
            </>
          )}
        </dl>
      ) : (
        <p className="mt-2 text-sm text-muted">
          {weekLoaded
            ? "Hasn’t played this week, or isn’t on the ESPN box yet."
            : "This week’s box scores didn’t load. Retry from the list."}
        </p>
      )}

      <p className="mt-6 text-[11px] tracking-[0.16em] text-subtle uppercase">2025 season</p>
      {s ? (
        <dl className="mt-2 grid grid-cols-3 gap-2">
          <Cell label="Games" value={String(s.games)} />
          <Cell label="PPR" value={s.ppr == null ? "—" : s.ppr.toFixed(1)} />
          <Cell label="PPG" value={s.ppg.toFixed(1)} />
          {row.pos === "QB" ? (
            <>
              <Cell label="Pass yds" value={String(s.passYds ?? 0)} />
              <Cell label="Pass TD" value={String(s.passTd ?? 0)} />
              <Cell label="Rush yds" value={String(s.rushYds ?? 0)} />
            </>
          ) : row.pos === "DST" ? (
            <>
              <Cell label="Sacks" value={String(s.sacks ?? "—")} />
              <Cell label="INT" value={String(s.ints ?? "—")} />
            </>
          ) : (
            <>
              <Cell label="Rec" value={String(s.rec ?? 0)} />
              <Cell label="Rec yds" value={String(s.recYds ?? 0)} />
              <Cell label="Rec TD" value={String(s.recTd ?? 0)} />
              <Cell label="Rush yds" value={String(s.rushYds ?? 0)} />
            </>
          )}
        </dl>
      ) : (
        <p className="mt-2 text-sm text-muted">Not on the 2025 slate — this week only.</p>
      )}
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className={cn("rounded-lg bg-elevated px-3 py-2")}>
      <p className="text-[10px] tracking-wide text-subtle uppercase">{label}</p>
      <p className="mt-0.5 font-mono text-sm tabular-nums">{value}</p>
    </div>
  );
}
