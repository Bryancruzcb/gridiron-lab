import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, useEffect, type ReactNode } from "react";
import {
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import qbsFile from "@/data/qbs.json";
import snapFile from "@/data/season2026.json";
import { AppShell } from "@/components/layout/AppShell";
import { Headshot } from "@/components/Headshot";
import { MethodNote } from "@/components/MethodNote";
import { StatTip } from "@/components/StatTip";
import { Segmented } from "@/components/ui/segmented";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { axisProps, CHART, tooltipStyle } from "@/components/charts/theme";
import type { QbFile, QbSeason, SplitStats } from "@/data/types";
import { teamNick } from "@/lib/nfl";
import { getSeasonLabs } from "@/lib/live/functions";
import type { SeasonLabs } from "@/lib/live/types";
import {
  splitKey,
  splitLabel,
  statsFor,
  type DistFilter,
  type DownFilter,
  type SitFilter,
} from "@/lib/splits";
import { cn, formatCpoe, formatEpa, formatPct } from "@/lib/utils";

export const Route = createFileRoute("/qb")({ component: QbLab });

const data = qbsFile as QbFile;
const snap = snapFile as unknown as SeasonLabs;

function QbLab() {
  const [season26, setSeason26] = useState<SeasonLabs | null>(null);
  const [season, setSeason] = useState<number>(2026);
  const [minPlays, setMinPlays] = useState(10);
  const [down, setDown] = useState<DownFilter>("all");
  const [dist, setDist] = useState<DistFilter>("all");
  const [sit, setSit] = useState<SitFilter>("all");
  const [pinned, setPinned] = useState<string[]>([]);
  const [sort, setSort] = useState<"epa" | "cpoe" | "press" | "comp">("epa");

  useEffect(() => {
    let cancelled = false;
    getSeasonLabs()
      .then((s) => {
        if (!cancelled) setSeason26(s);
      })
      .catch(() => {
        if (!cancelled) {
          setSeason26(null);
          setSeason((s) => (s === 2026 ? 2025 : s));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const overlay = season26?.qbs.length ? season26 : snap;
  const allQbs = useMemo(() => {
    const hist = data.qbs as QbSeason[];
    return [...overlay.qbs, ...hist.filter((q) => q.season !== 2026)];
  }, [overlay]);

  const seasons = useMemo(() => {
    const s = new Set(allQbs.map((q) => q.season));
    return [...s].sort((a, b) => b - a);
  }, [allQbs]);

  useEffect(() => {
    setMinPlays(season >= 2026 ? 10 : 200);
  }, [season]);

  useEffect(() => {
    const floor = season >= 2026 ? 10 : 250;
    const ids = allQbs
      .filter((q) => q.season === season && q.overall.plays >= floor)
      .slice(0, 3)
      .map((q) => q.id);
    setPinned(ids);
  }, [season, allQbs]);

  const key = splitKey(down, dist, sit);
  const label = splitLabel(down, dist, sit);

  const rows = useMemo(() => {
    const out: { qb: QbSeason; stats: SplitStats }[] = [];
    for (const qb of allQbs) {
      if (qb.season !== season) continue;
      const stats = statsFor(qb, key);
      if (!stats || stats.plays < minPlays) continue;
      out.push({ qb, stats });
    }
    out.sort((a, b) => (b.stats[sort] ?? -99) - (a.stats[sort] ?? -99));
    return out;
  }, [season, key, minPlays, sort, allQbs]);

  const scatter = rows.map((r, i) => ({
    id: r.qb.id,
    name: r.qb.name,
    team: r.qb.team,
    epa: r.stats.epa ?? 0,
    cpoe: r.stats.cpoe ?? 0,
    press: r.stats.press ?? 0,
    plays: r.stats.plays,
    fill: pinned.includes(r.qb.id) ? CHART.sage : i < 8 ? CHART.paper : CHART.muted,
  }));

  const togglePin = (id: string) => {
    setPinned((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 4) return [...prev.slice(1), id];
      return [...prev, id];
    });
  };

  const pinnedRows = pinned
    .map((id) => rows.find((r) => r.qb.id === id))
    .filter((x): x is { qb: QbSeason; stats: SplitStats } => Boolean(x));

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <header className="max-w-2xl">
          <p className="text-[11px] font-medium tracking-[0.2em] text-sage uppercase">Lab 01</p>
          <h1 className="mt-2 font-display text-5xl uppercase tracking-[0.03em] sm:text-6xl">
            QB comparison
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-muted sm:text-base">
            Dropback EPA, CPOE, and pressure rate from nflfastR play-by-play. 2026 updates when
            nflverse posts — usually the morning after. Filter the same way a scout would: down,
            distance, red zone, two-minute, or the pocket.
          </p>
        </header>

        <div className="mt-8 flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Segmented
              value={String(season)}
              onChange={(v) => setSeason(Number(v))}
              options={seasons.map((s) => ({ value: String(s), label: String(s) }))}
            />
            <span className="text-[11px] tracking-[0.14em] text-subtle uppercase">
              {rows.length} QBs · {label}
              {season >= 2026 && overlay.throughWeek
                ? ` · through week ${overlay.throughWeek}`
                : ""}
            </span>
          </div>
          <div className="flex flex-col gap-3 rounded-lg bg-surface p-4 shadow-[var(--shadow-border)]">
            <div className="grid gap-3 lg:grid-cols-3">
              <Field label="Down">
                <Segmented
                  value={down}
                  onChange={(v) => {
                    setDown(v);
                    setSit("all");
                  }}
                  options={[
                    { value: "all", label: "All" },
                    { value: "1", label: "1st" },
                    { value: "2", label: "2nd" },
                    { value: "3", label: "3rd" },
                    { value: "4", label: "4th" },
                  ]}
                />
              </Field>
              <Field label="Distance">
                <Segmented
                  value={dist}
                  onChange={(v) => {
                    setDist(v);
                    setSit("all");
                  }}
                  options={[
                    { value: "all", label: "All" },
                    { value: "short", label: "1–3" },
                    { value: "medium", label: "4–6" },
                    { value: "long", label: "7+" },
                  ]}
                />
              </Field>
              <Field label="Situation">
                <Segmented
                  value={sit}
                  onChange={(v) => {
                    setSit(v);
                    if (v !== "all") {
                      setDown("all");
                      setDist("all");
                    }
                  }}
                  options={[
                    { value: "all", label: "Any" },
                    { value: "redzone", label: "Red zone" },
                    { value: "twominute", label: "Two-min" },
                    { value: "trailing", label: "Trailing" },
                    { value: "pressured", label: "Pressured" },
                    { value: "clean", label: "Clean" },
                  ]}
                />
              </Field>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
              <span className="text-[11px] tracking-[0.14em] text-subtle uppercase">
                Min dropbacks {minPlays}
              </span>
              <Slider
                min={season >= 2026 ? 5 : 80}
                max={season >= 2026 ? 80 : 400}
                step={season >= 2026 ? 5 : 10}
                value={[minPlays]}
                onValueChange={(v) => setMinPlays(v[0] ?? 200)}
                className="sm:max-w-xs"
              />
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <div className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)] sm:p-5">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 className="font-display text-xl uppercase tracking-[0.06em]">EPA vs CPOE</h2>
              <p className="text-xs text-subtle">Bubble = dropbacks. Click a point to pin.</p>
            </div>
            <div className="h-[320px] sm:h-[380px]">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 12, right: 12, bottom: 20, left: 8 }}>
                  <CartesianGrid stroke={CHART.grid} />
                  <XAxis
                    type="number"
                    dataKey="cpoe"
                    tickCount={5}
                    domain={["dataMin - 1", "dataMax + 1"]}
                    {...axisProps}
                  />
                  <YAxis
                    type="number"
                    dataKey="epa"
                    tickCount={5}
                    width={52}
                    domain={["dataMin - 0.04", "dataMax + 0.04"]}
                    {...axisProps}
                  />
                  <ZAxis type="number" dataKey="plays" range={[36, 160]} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    cursor={{ stroke: CHART.paper, strokeDasharray: "3 3" }}
                    formatter={(value, name) => {
                      const n = typeof value === "number" ? value : Number(value);
                      if (name === "epa") return [formatEpa(n), "EPA/play"];
                      if (name === "cpoe") return [formatCpoe(n), "CPOE"];
                      if (name === "plays") return [n, "Dropbacks"];
                      return [value, String(name)];
                    }}
                    labelFormatter={(_, payload) => {
                      const row = payload?.[0]?.payload as { name?: string } | undefined;
                      return row?.name ?? "";
                    }}
                  />
                  <Scatter data={scatter} onClick={(d: { id?: string }) => d?.id && togglePin(d.id)}>
                    {scatter.map((s) => (
                      <Cell key={s.id} fill={s.fill} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-1 text-center font-mono text-[10px] tracking-wide text-subtle uppercase">
              CPOE → &nbsp;&nbsp; EPA/play ↑
            </p>
          </div>

          <div className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)] sm:p-5">
            <h2 className="font-display text-xl uppercase tracking-[0.06em]">Pinned</h2>
            <p className="mt-1 text-xs text-subtle">Up to four QBs. Empty pins fill from the table.</p>
            <ul className="mt-4 space-y-2">
              {pinnedRows.length === 0 && (
                <li className="text-sm text-muted">Click a row or a scatter point to compare.</li>
              )}
              {pinnedRows.map((r) => (
                <li key={r.qb.id}>
                  <button
                    type="button"
                    onClick={() => togglePin(r.qb.id)}
                    className="flex w-full items-center gap-3 rounded-md p-2 text-left hover:bg-elevated"
                  >
                    <Headshot src={r.qb.headshot} name={r.qb.name} team={r.qb.team} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{r.qb.name}</p>
                      <p className="text-xs text-muted">{teamNick(r.qb.team)}</p>
                    </div>
                    <span className="font-mono text-sm tabular-nums text-sage">
                      {formatEpa(r.stats.epa)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {pinnedRows.length >= 2 && (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-[10px] tracking-[0.12em] text-subtle uppercase">
                    <tr>
                      <th className="py-1 font-medium"> </th>
                      {pinnedRows.map((r) => (
                        <th key={r.qb.id} className="px-2 py-1 font-medium">
                          {r.qb.name.split(" ").pop()}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="font-mono tabular-nums">
                    {(
                      [
                        ["EPA", (s: SplitStats) => formatEpa(s.epa)],
                        ["CPOE", (s: SplitStats) => formatCpoe(s.cpoe)],
                        ["Comp", (s: SplitStats) => formatPct(s.comp)],
                        ["Press", (s: SplitStats) => formatPct(s.press)],
                      ] as const
                    ).map(([label, fmt]) => (
                      <tr key={label} className="border-t border-border/70">
                        <td className="py-1.5 text-subtle">{label}</td>
                        {pinnedRows.map((r) => (
                          <td key={r.qb.id} className="px-2 py-1.5">
                            {fmt(r.stats)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 overflow-hidden rounded-xl bg-surface shadow-[var(--shadow-border)]">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <h2 className="font-display text-xl uppercase tracking-[0.06em]">Board</h2>
            <div className="flex gap-1">
              {(["epa", "cpoe", "comp", "press"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSort(s)}
                  className={cn(
                    "h-8 rounded-sm px-2.5 text-[11px] font-medium tracking-wide uppercase",
                    sort === s ? "bg-accent text-accent-fg" : "text-muted hover:text-fg",
                  )}
                >
                  {s === "epa" ? "EPA" : s === "cpoe" ? "CPOE" : s === "comp" ? "Comp" : "Press"}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-[11px] tracking-[0.12em] text-subtle uppercase">
                <tr className="border-y border-border">
                  <th className="px-4 py-2 font-medium">Quarterback</th>
                  <th className="px-3 py-2 font-medium">Team</th>
                  <th className="px-3 py-2 text-right font-medium">Plays</th>
                  <th className="px-3 py-2 text-right font-medium">
                    <StatTip metric="epa" />
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    <StatTip metric="cpoe" />
                  </th>
                  <th className="px-3 py-2 text-right font-medium">Comp</th>
                  <th className="px-3 py-2 text-right font-medium">
                    <StatTip metric="success" />
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    <StatTip metric="press" />
                  </th>
                  <th className="px-3 py-2 text-right font-medium">TD/INT</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const active = pinned.includes(r.qb.id);
                  return (
                    <tr
                      key={r.qb.id}
                      onClick={() => togglePin(r.qb.id)}
                      className={cn(
                        "cursor-pointer border-b border-border/70 transition-colors",
                        active ? "bg-elevated" : "hover:bg-elevated/60",
                      )}
                    >
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <Headshot src={r.qb.headshot} name={r.qb.name} team={r.qb.team} className="size-8" />
                          <span className="font-medium">{r.qb.name}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-muted">{r.qb.team}</td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">{r.stats.plays}</td>
                      <td
                        className={cn(
                          "px-3 py-2.5 text-right font-mono tabular-nums",
                          (r.stats.epa ?? 0) >= 0 ? "text-sage" : "text-rust",
                        )}
                      >
                        {formatEpa(r.stats.epa)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                        {formatCpoe(r.stats.cpoe)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                        {formatPct(r.stats.comp)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                        {formatPct(r.stats.success)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                        {formatPct(r.stats.press)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-muted">
                        {r.stats.td}/{r.stats.int}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <MethodNote title="How to read it">
            <p>
              <strong className="font-medium text-fg">EPA per play</strong> is expected points added
              on dropbacks (passes, sacks, scrambles). Above zero means the offense gained ground
              relative to a league-average play in that down-and-distance.
            </p>
            <p>
              <strong className="font-medium text-fg">CPOE</strong> is completion percentage over
              expected, from nflfastR’s completion-probability model. Pressure rate here is sacks +
              hits as a share of dropbacks — a public-data stand-in for true pressure.
            </p>
          </MethodNote>
          <MethodNote title="Portfolio angle">
            <p>
              The interesting version of this dashboard is not “who has the most yards.” It is
              whether a quarterback’s EPA holds up on 3rd-and-long, in the red zone, or once the
              pocket collapses. Pin two names and flip the situation chips.
            </p>
            <p>
              Data: {season >= 2026 ? overlay.source : data.source}. {rows.length}{" "}
              quarterbacks shown for {season} with at least {minPlays} dropbacks in this slice.
            </p>
          </MethodNote>
        </div>
        {pinned.length > 0 && (
          <p className="mt-4">
            <Badge variant="outline">{pinned.length} pinned</Badge>
          </p>
        )}
      </div>
    </AppShell>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px] font-medium tracking-[0.14em] text-subtle uppercase">{label}</span>
      {children}
    </div>
  );
}
