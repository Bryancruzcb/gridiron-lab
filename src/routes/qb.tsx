import { createFileRoute, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
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
import { CopyLink } from "@/components/CopyLink";
import { FeedStatus } from "@/components/DataStatus";
import { Headshot } from "@/components/Headshot";
import { FirstLook } from "@/components/FirstLook";
import { SampleN } from "@/components/SampleN";
import { SavedAnalyses } from "@/components/SavedAnalyses";
import { StatTip } from "@/components/StatTip";
import { Segmented } from "@/components/ui/segmented";
import { Slider } from "@/components/ui/slider";
import { axisProps, CHART } from "@/components/charts/theme";
import type { QbFile, QbSeason, SplitStats } from "@/data/types";
import {
  decodeQbSearch,
  editQb,
  encodeQbSearch,
  validateQbSearch,
  type QbAnalysisState,
  type QbEdit,
} from "@/lib/analysis/state";
import { teamNick } from "@/lib/nfl";
import { historyQbs, isThin } from "@/lib/season";
import { useSeason } from "@/lib/season-provider";
import { playFloor, splitKey, splitLabel, statsFor } from "@/lib/splits";
import { cn, formatCpoe, formatEpa, formatPasser, formatPct, passerRating } from "@/lib/utils";

export const Route = createFileRoute("/qb")({ validateSearch: validateQbSearch, component: QbLab });

const data = qbsFile as QbFile;

/** Pins shown while the URL has none: the season's top three by dropbacks. */
function defaultPins(all: readonly QbSeason[], season: number): string[] {
  const floor = season >= 2026 ? 10 : 250;
  return all
    .filter((q) => q.season === season && q.overall.plays >= floor)
    .slice(0, 3)
    .map((q) => q.id);
}

type PinItem =
  | { kind: "row"; id: string; qb: QbSeason; stats: SplitStats }
  | { kind: "unresolved"; id: string; pending: boolean; name: string | null; note: string };

function QbLab() {
  const { labs, labsSections, ready } = useSeason();
  const navigate = useNavigate();
  const router = useRouter();
  // The route's search (canonical values laid over the raw URL) drives the page. Issues come from
  // the raw URL, read only while this route is the location.
  const search = Route.useSearch();
  const rawSearch = useRouterState({ select: (s) => (s.location.pathname === "/qb" ? s.location.search : undefined) });

  const overlay = labs;
  const allQbs = useMemo(() => historyQbs(overlay, data.qbs as QbSeason[]), [overlay]);

  const seasons = useMemo(() => {
    const s = new Set(allQbs.map((q) => q.season));
    return [...s].sort((a, b) => b - a);
  }, [allQbs]);

  const { state } = useMemo(() => decodeQbSearch(search, { seasons }), [search, seasons]);
  const issues = useMemo(() => (rawSearch === undefined ? [] : decodeQbSearch(rawSearch, { seasons }).issues), [rawSearch, seasons]);
  const { season, down, distance: dist, situation: sit, sort } = state;

  const key = splitKey(down, dist, sit);
  const label = splitLabel(down, dist, sit);
  const floor = playFloor(season, down, dist, sit);

  // A slider drag stays local until release, then replaces the URL once, so ticks add no history.
  const [draft, setDraft] = useState<{ value: number; from: number | null } | null>(null);
  const minPlays = draft !== null && draft.from === state.minPlays ? draft.value : (state.minPlays ?? floor.def);

  const seasonDefaults = useMemo(() => defaultPins(allQbs, season), [allQbs, season]);
  // Explicit pins (from the URL or a saved view) are never replaced by defaults on load or refresh.
  const pinned = state.pins ?? seasonDefaults;

  const update = (edit: QbEdit, replace = false) =>
    navigate({
      to: "/qb",
      search: (prev: unknown) => encodeQbSearch(editQb(decodeQbSearch(prev, { seasons }).state, edit)),
      replace,
      resetScroll: false,
    });

  const commitMin = (value: number) => {
    void update({ type: "min", minPlays: value }, true).finally(() => setDraft(null));
  };

  const shared: QbAnalysisState = { ...state, minPlays, pins: pinned };
  const shareUrl = () => `${window.location.origin}${router.buildLocation({ to: "/qb", search: encodeQbSearch(shared) }).href}`;

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

  const togglePin = (id: string) => void update({ type: "toggle-pin", id, defaults: seasonDefaults });

  const weekRows = useMemo(() => {
    if (season < 2026) return [];
    return allQbs
      .filter((q) => q.season === 2026 && (q.weeks?.length ?? 0) > 0)
      .slice()
      .sort((a, b) => (b.overall.plays ?? 0) - (a.overall.plays ?? 0));
  }, [allQbs, season]);

  const pinItems: PinItem[] = pinned.map((id) => {
    const row = rows.find((r) => r.qb.id === id);
    if (row) return { kind: "row", id, qb: row.qb, stats: row.stats };
    const inSeason = allQbs.find((q) => q.id === id && q.season === season);
    if (inSeason) {
      const stats = statsFor(inSeason, key);
      const note =
        !stats || stats.plays === 0
          ? `No dropbacks on ${label.toLowerCase()}.`
          : `${stats.plays} dropback${stats.plays === 1 ? "" : "s"} on ${label.toLowerCase()}, under the ${minPlays} min.`;
      return { kind: "unresolved", id, pending: false, name: inSeason.name, note };
    }
    if (season >= 2026 && !ready)
      return { kind: "unresolved", id, pending: true, name: null, note: "Waiting for the live 2026 file before this pin can be matched." };
    const elsewhere = allQbs.filter((q) => q.id === id).sort((a, b) => b.season - a.season);
    if (elsewhere.length > 0)
      return {
        kind: "unresolved",
        id,
        pending: false,
        name: elsewhere[0]!.name,
        note: `No ${season} rows. This quarterback has data for ${elsewhere.map((q) => q.season).join(", ")}.`,
      };
    return { kind: "unresolved", id, pending: false, name: null, note: `No quarterback with id ${id} in this data.` };
  });
  const pinnedRows = pinItems.filter((p): p is Extract<PinItem, { kind: "row" }> => p.kind === "row");

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

        <div className="mt-8 flex flex-col gap-4 rounded-xl bg-surface p-4 sm:p-5">
          <div className="flex flex-wrap items-start gap-3">
            <Segmented
              value={String(season)}
              onChange={(v) => void update({ type: "season", season: Number(v) })}
              options={seasons.map((s) => ({ value: String(s), label: String(s) }))}
            />
            <span className="self-center text-[11px] tracking-[0.14em] text-subtle uppercase">
              {rows.length} QBs · {label}
            </span>
            <CopyLink getUrl={shareUrl} className="w-full sm:ml-auto sm:w-64" />
          </div>
          {season >= 2026 ? <FeedStatus feed="labs" section="qbs" /> : null}
          <div className="flex flex-col gap-3 rounded-lg bg-elevated p-4">
            <div className="grid gap-3 lg:grid-cols-3">
              <Field label="Down">
                <Segmented
                  value={down}
                  onChange={(v) => void update({ type: "down", down: v })}
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
                  onChange={(v) => void update({ type: "distance", distance: v })}
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
                  onChange={(v) => void update({ type: "situation", situation: v })}
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
              <span className="text-[11px] tracking-[0.14em] text-subtle uppercase" data-testid="min-plays">
                Min dropbacks in this slice · {minPlays}
              </span>
              <Slider
                min={floor.min}
                max={floor.max}
                step={floor.step}
                value={[Math.min(floor.max, Math.max(floor.min, minPlays))]}
                onValueChange={(v) => setDraft({ value: v[0] ?? floor.def, from: state.minPlays })}
                onValueCommit={(v) => commitMin(v[0] ?? floor.def)}
                className="sm:max-w-xs"
              />
            </div>
          </div>
        </div>

        {issues.length > 0 && (
          <div role="status" data-testid="link-issues" className="mt-4 rounded-xl bg-rust/10 px-4 py-3 text-sm text-rust">
            <p className="font-medium">Some settings in this link could not be used.</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {issues.map((issue, i) => (
                <li key={`${issue.field}-${i}`}>{issue.message}</li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => void navigate({ to: "/qb", search: encodeQbSearch(state), replace: true, resetScroll: false })}
              className="mt-2 text-xs underline underline-offset-2"
            >
              Dismiss
            </button>
          </div>
        )}

        <SavedAnalyses
          className="mt-4"
          kind="qb"
          current={() => ({ state: shared, datasetRef: `qb:${season}` })}
          suggestedName={`${season} · ${label}${pinned.length ? ` · ${pinned.length} pinned` : ""}`}
          onOpen={(record) => void navigate({ to: "/qb", search: encodeQbSearch(record.state), resetScroll: false })}
          datasetNote={(record) => (seasons.includes(record.state.season) ? null : `no ${record.state.season} data here`)}
        />

        {season >= 2026 && weekRows.length === 0 && rows.length > 0 && (
          <p data-testid="week-strip-note" className="mt-4 rounded-xl bg-surface px-4 py-3 text-sm text-muted">
            No week-by-week line yet.{" "}
            {labsSections.qbs.kind === "snapshot"
              ? "The snapshot only has season totals; weekly rows appear when the live play-by-play loads."
              : "The live file has no weekly rows for these quarterbacks."}
          </p>
        )}

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
                  onClick={() => void update({ type: "reset-min" })}
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
            <ul data-testid="pinned-list" className="mt-4 space-y-2">
              {pinItems.length === 0 && (
                <li className="text-sm text-muted">Click a row or a scatter point to compare.</li>
              )}
              {pinItems.map((item) =>
                item.kind === "row" ? (
                  <li key={item.id} data-pin-id={item.id}>
                    <button
                      type="button"
                      onClick={() => togglePin(item.id)}
                      className="flex w-full items-center gap-3 rounded-md p-2 text-left hover:bg-elevated"
                    >
                      <Headshot src={item.qb.headshot} name={item.qb.name} team={item.qb.team} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{item.qb.name}</p>
                        <p className="text-xs text-muted">{teamNick(item.qb.team)}</p>
                        {season >= 2026 && item.qb.weeks && item.qb.weeks.length > 0 && (
                          <p className="mt-1 font-mono text-[11px] tabular-nums text-muted">
                            {item.qb.weeks.map((w) => `W${w.week} ${formatEpa(w.epa)} · ${w.plays} dropback${w.plays === 1 ? "" : "s"}`).join("  ")}
                          </p>
                        )}
                      </div>
                      <div className="text-right">
                        <span
                          className={cn(
                            "font-mono text-sm tabular-nums",
                            isThin(item.stats.plays) ? "text-muted" : "text-sage",
                          )}
                        >
                          {formatEpa(item.stats.epa)}
                        </span>
                        <div>
                          <SampleN n={item.stats.plays} unit="dropbacks" />
                        </div>
                      </div>
                    </button>
                  </li>
                ) : (
                  <li
                    key={item.id}
                    data-pin-id={item.id}
                    data-unresolved={item.pending ? "pending" : "explained"}
                    className="flex items-center gap-3 rounded-md p-2"
                  >
                    <span
                      aria-hidden
                      className="grid size-10 shrink-0 place-items-center rounded-full bg-elevated font-mono text-xs text-subtle"
                    >
                      {item.pending ? "…" : "?"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-muted">{item.name ?? item.id}</p>
                      <p className="text-xs text-subtle">{item.note}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => togglePin(item.id)}
                      aria-label={`Unpin ${item.name ?? item.id}`}
                      className="h-8 rounded-sm px-2 text-[11px] font-medium tracking-wide text-muted uppercase hover:text-fg"
                    >
                      Unpin
                    </button>
                  </li>
                ),
              )}
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
                        ["Dropbacks", (s: SplitStats) => String(s.plays)],
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
                    <tr className="border-t border-border/70">
                      <td className="py-1.5 text-subtle">Passer</td>
                      {pinnedRows.map((r) => (
                        <td key={r.qb.id} className="px-2 py-1.5">
                          {formatPasser(passerRating(r.qb.box))}
                        </td>
                      ))}
                    </tr>
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
                  onClick={() => void update({ type: "sort", sort: s })}
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
                  <th className="px-3 py-2 text-right font-medium">
                    <StatTip metric="passer" />
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
                    <td colSpan={10} className="px-4 py-10 text-center text-sm text-muted">
                      No quarterbacks pass the min on {label.toLowerCase()}. Drop the slider.
                    </td>
                  </tr>
                )}
                {rows.map((r) => {
                  const active = pinned.includes(r.qb.id);
                  return (
                    <tr
                      key={r.qb.id}
                      data-qb-id={r.qb.id}
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
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-muted">
                        {formatPasser(passerRating(r.qb.box))}
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
