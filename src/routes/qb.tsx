import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, useEffect, type ReactNode } from "react";
import {
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import qbsFile from "@/data/qbs.json";
import { AppShell } from "@/components/layout/AppShell";
import { Headshot } from "@/components/Headshot";
import { FirstLook } from "@/components/FirstLook";
import { SampleN } from "@/components/SampleN";
import { StatTip } from "@/components/StatTip";
import { Segmented } from "@/components/ui/segmented";
import { Slider } from "@/components/ui/slider";
import { axisProps, CHART } from "@/components/charts/theme";
import type { QbFile, QbSeason, SplitStats } from "@/data/types";
import { teamNick } from "@/lib/nfl";
import { historyQbs, isThin } from "@/lib/season";
import { useSeason } from "@/lib/season-provider";
import {
  playFloor,
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

function QbLab() {
  const { labs } = useSeason();
  const [season, setSeason] = useState<number>(2026);
  const [minPlays, setMinPlays] = useState(10);
  const [down, setDown] = useState<DownFilter>("all");
  const [dist, setDist] = useState<DistFilter>("all");
  const [sit, setSit] = useState<SitFilter>("all");
  const [pinned, setPinned] = useState<string[]>([]);
  const [sort, setSort] = useState<"epa" | "cpoe" | "press" | "comp">("epa");

  const overlay = labs;
  const allQbs = useMemo(() => historyQbs(overlay, data.qbs as QbSeason[]), [overlay]);

  const seasons = useMemo(() => {
    const s = new Set(allQbs.map((q) => q.season));
    return [...s].sort((a, b) => b - a);
  }, [allQbs]);

  useEffect(() => {
    setMinPlays(playFloor(season, down, dist, sit).def);
  }, [season, down, dist, sit]);

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
  const floor = playFloor(season, down, dist, sit);

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
    tag: pinned.includes(r.qb.id) ? (r.qb.name.split(" ").pop() ?? r.qb.name) : "",
    team: r.qb.team,
    epa: r.stats.epa ?? 0,
    cpoe: r.stats.cpoe ?? 0,
    press: r.stats.press ?? 0,
    plays: r.stats.plays,
    fill: pinned.includes(r.qb.id)
      ? CHART.sage
      : isThin(r.stats.plays)
        ? CHART.muted
        : i < 8
          ? CHART.paper
          : CHART.muted,
  }));

  const togglePin = (id: string) => {
    setPinned((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 4) return [...prev.slice(1), id];
      return [...prev, id];
    });
  };

  const weekRows = useMemo(() => {
    if (season < 2026) return [];
    return allQbs
      .filter((q) => q.season === 2026 && (q.weeks?.length ?? 0) > 0)
      .slice()
      .sort((a, b) => (b.overall.plays ?? 0) - (a.overall.plays ?? 0));
  }, [allQbs, season]);

  const pinnedRows = pinned
    .map((id) => rows.find((r) => r.qb.id === id))
    .filter((x): x is { qb: QbSeason; stats: SplitStats } => Boolean(x));

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <header className="max-w-2xl">
          <h1 className="font-display text-5xl uppercase tracking-[0.03em] sm:text-6xl">QB</h1>
        </header>
        <FirstLook id="qb" title="This page">
          <p>
            Each dot is a quarterback. Tap a dot or a row to pin. Filters change the slice — 3rd
            down is not the same player as 1st-and-10.
          </p>
        </FirstLook>

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
                Min dropbacks in this slice · {minPlays}
              </span>
              <Slider
                min={floor.min}
                max={floor.max}
                step={floor.step}
                value={[Math.min(floor.max, Math.max(floor.min, minPlays))]}
                onValueChange={(v) => setMinPlays(v[0] ?? floor.def)}
                className="sm:max-w-xs"
              />
            </div>
          </div>
        </div>

        {weekRows.length > 0 && (
          <div className="mt-4 overflow-hidden rounded-xl bg-surface p-4 shadow-[var(--shadow-border)] sm:p-5">
            <h2 className="font-display text-xl uppercase tracking-[0.06em]">By week</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[320px] text-left text-sm">
                <thead className="text-[11px] tracking-[0.12em] text-subtle uppercase">
                  <tr className="border-b border-border">
                    <th className="py-2 pr-3 font-medium">QB</th>
                    {Array.from(
                      new Set(weekRows.flatMap((q) => (q.weeks ?? []).map((w) => w.week))),
                    )
                      .sort((a, b) => a - b)
                      .map((w) => (
                        <th key={w} className="px-2 py-2 text-right font-medium">
                          W{w}
                        </th>
                      ))}
                  </tr>
                </thead>
                <tbody>
                  {weekRows.map((q) => (
                    <tr key={q.id} className="border-b border-border/70">
                      <td className="py-2 pr-3">{q.name.split(" ").pop()}</td>
                      {Array.from(
                        new Set(weekRows.flatMap((x) => (x.weeks ?? []).map((w) => w.week))),
                      )
                        .sort((a, b) => a - b)
                        .map((w) => {
                          const pt = q.weeks?.find((x) => x.week === w);
                          return (
                            <td key={w} className="px-2 py-2 text-right font-mono text-xs tabular-nums">
                              {pt ? (
                                <span className={isThin(pt.plays) ? "text-muted" : undefined}>
                                  {formatEpa(pt.epa)}
                                  <span className="ml-1 text-muted">
                                    {pt.plays} dropback{pt.plays === 1 ? "" : "s"}
                                  </span>
                                </span>
                              ) : (
                                <span className="text-muted">—</span>
                              )}
                            </td>
                          );
                        })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <div className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)] sm:p-5">
            <div className="mb-3">
              <h2 className="font-display text-xl uppercase tracking-[0.06em]">EPA vs CPOE</h2>
            </div>
            {rows.length === 0 ? (
              <div className="flex h-[280px] flex-col items-center justify-center rounded-md bg-elevated px-6 text-center">
                <p className="font-display text-2xl uppercase tracking-[0.04em]">No QBs at this cut</p>
                <p className="mt-2 max-w-sm text-sm text-muted">
                  Nobody has {minPlays}+ dropbacks on {label.toLowerCase()}. The data is there — the
                  sample-size gate is too high for this slice.
                </p>
                <button
                  type="button"
                  onClick={() => setMinPlays(floor.def)}
                  className="mt-4 h-11 rounded-md bg-accent px-4 text-sm font-medium text-accent-fg"
                >
                  Drop min to {floor.def}
                </button>
              </div>
            ) : (
              <div className="rounded-md bg-elevated p-2 sm:p-3">
                <div className="h-[300px] sm:h-[360px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 18, right: 12, bottom: 8, left: 4 }}>
                      <CartesianGrid stroke="rgba(241,240,234,0.16)" />
                      <ReferenceLine x={0} stroke="rgba(241,240,234,0.28)" />
                      <ReferenceLine y={0} stroke="rgba(241,240,234,0.28)" />
                      <XAxis
                        type="number"
                        dataKey="cpoe"
                        tickCount={5}
                        domain={["dataMin - 1", "dataMax + 1"]}
                        name="CPOE"
                        {...axisProps}
                        tick={{ fill: "#C5CCD6", fontSize: 11 }}
                        tickFormatter={(v: number) => (v > 0 ? `+${v.toFixed(0)}` : v.toFixed(0))}
                      />
                      <YAxis
                        type="number"
                        dataKey="epa"
                        tickCount={5}
                        width={48}
                        domain={["dataMin - 0.04", "dataMax + 0.04"]}
                        name="EPA"
                        {...axisProps}
                        tick={{ fill: "#C5CCD6", fontSize: 11 }}
                        tickFormatter={(v: number) => {
                          const n = Math.abs(v) < 0.005 ? 0 : v;
                          return n > 0 ? `+${n.toFixed(2)}` : n.toFixed(2);
                        }}
                      />
                      <ZAxis type="number" dataKey="plays" range={[40, 140]} />
                      <Tooltip
                        cursor={{ stroke: CHART.paper, strokeDasharray: "3 3" }}
                        content={<QbDotTip />}
                      />
                      <Scatter data={scatter} onClick={(d: { id?: string }) => d?.id && togglePin(d.id)}>
                        {scatter.map((s) => (
                          <Cell key={s.id} fill={s.fill} stroke="#0A0B0D" strokeWidth={1} />
                        ))}
                      </Scatter>
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
                <p className="mt-1 text-center font-mono text-[10px] tracking-wide text-muted uppercase">
                  CPOE → &nbsp;&nbsp; EPA ↑
                </p>
              </div>
            )}
          </div>

          <div className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)] sm:p-5">
            <h2 className="font-display text-xl uppercase tracking-[0.06em]">Pinned</h2>
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
                      {season >= 2026 && r.qb.weeks && r.qb.weeks.length > 0 && (
                        <p className="mt-1 font-mono text-[11px] tabular-nums text-muted">
                          {r.qb.weeks.map((w) => `W${w.week} ${formatEpa(w.epa)} · ${w.plays} dropback${w.plays === 1 ? "" : "s"}`).join("  ")}
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <span
                        className={cn(
                          "font-mono text-sm tabular-nums",
                          isThin(r.stats.plays) ? "text-muted" : "text-sage",
                        )}
                      >
                        {formatEpa(r.stats.epa)}
                      </span>
                      <div>
                        <SampleN n={r.stats.plays} unit="dropbacks" />
                      </div>
                    </div>
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
                        ["n", (s: SplitStats) => String(s.plays)],
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
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-10 text-center text-sm text-muted">
                      No quarterbacks pass the min on {label.toLowerCase()}. Drop the slider.
                    </td>
                  </tr>
                )}
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
                      <td
                        className={cn(
                          "px-3 py-2.5 text-right font-mono tabular-nums",
                          isThin(r.stats.plays) && "text-muted",
                        )}
                      >
                        {r.stats.plays}
                      </td>
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

function QbDotTip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{
    payload: { name: string; team: string; epa: number; cpoe: number; plays: number };
  }>;
}) {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md bg-elevated px-3 py-2.5 text-sm text-fg shadow-[var(--shadow-border-hover)]">
      <p className="font-medium">{d.name}</p>
      <p className="text-xs text-muted">{teamNick(d.team)}</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs tabular-nums">
        <dt className="text-muted">CPOE</dt>
        <dd>{formatCpoe(d.cpoe)}</dd>
        <dt className="text-muted">EPA/play</dt>
        <dd>{formatEpa(d.epa)}</dd>
        <dt className="text-muted">Dropbacks</dt>
        <dd className={isThin(d.plays) ? "text-muted" : undefined}>
          {d.plays}
          {isThin(d.plays) ? " · thin" : ""}
        </dd>
      </dl>
    </div>
  );
}
