import { createFileRoute, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  CartesianGrid,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import qbsFile from "@/data/qbs.json";
import { AppShell } from "@/components/layout/AppShell";
import {
  DOWN,
  Field,
  INK,
  INK_QUIET,
  LABEL_ALL,
  QbDot,
  QbDotTip,
  UP,
  WeekBars,
  type PinItem,
  type PinRow,
  type ScatterPoint,
} from "@/components/qb";
import { CopyLink } from "@/components/CopyLink";
import { FeedStatus } from "@/components/DataStatus";
import { Headshot } from "@/components/Headshot";
import { FirstLook } from "@/components/FirstLook";
import { SavedAnalyses } from "@/components/SavedAnalyses";
import { StatTip } from "@/components/StatTip";
import { Segmented } from "@/components/ui/segmented";
import { Slider } from "@/components/ui/slider";
import { CHART } from "@/components/charts/theme";
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

/** Evenly spaced ticks inside [min, max], using the first step that gives six or fewer. */
function niceTicks(min: number, max: number, steps: readonly number[]) {
  const step = steps.find((s) => (max - min) / s <= 6) ?? steps[steps.length - 1]!;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}



type WeekPoint = NonNullable<QbSeason["weeks"]>[number];

/** Rows of the pinned comparison; `best` marks which end of the pinned group wins. */
const COMPARE: {
  label: string;
  note?: string;
  value: (r: PinRow) => number | null;
  text: (r: PinRow) => string;
  best?: "max" | "min";
}[] = [
  { label: "EPA per dropback", value: (r) => r.stats.epa ?? null, text: (r) => formatEpa(r.stats.epa), best: "max" },
  { label: "CPOE", value: (r) => r.stats.cpoe ?? null, text: (r) => formatCpoe(r.stats.cpoe), best: "max" },
  { label: "Completion", value: (r) => r.stats.comp ?? null, text: (r) => formatPct(r.stats.comp), best: "max" },
  { label: "Success rate", value: (r) => r.stats.success ?? null, text: (r) => formatPct(r.stats.success), best: "max" },
  {
    label: "Pressure rate",
    note: "lower is better",
    value: (r) => r.stats.press ?? null,
    text: (r) => formatPct(r.stats.press),
    best: "min",
  },
  {
    label: "Passer rating",
    value: (r) => passerRating(r.qb.box) ?? null,
    text: (r) => formatPasser(passerRating(r.qb.box)),
    best: "max",
  },
  { label: "Dropbacks", value: (r) => r.stats.plays, text: (r) => String(r.stats.plays) },
  { label: "TD–INT", value: () => null, text: (r) => `${r.stats.td}–${r.stats.int}` },
];

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

  // Both axes always include zero, so the four corners of the chart exist for any slice.
  const cpoes = rows.map((r) => r.stats.cpoe ?? 0);
  const epas = rows.map((r) => r.stats.epa ?? 0);
  // Padding is 15% of the spread (at least 1.5 CPOE / 0.08 EPA), so photos and names clear the corner labels.
  const xLo = Math.min(-1, ...cpoes);
  const xHi = Math.max(1, ...cpoes);
  const yLo = Math.min(-0.05, ...epas);
  const yHi = Math.max(0.05, ...epas);
  const xPad = Math.max(1.5, 0.15 * (xHi - xLo));
  const yPad = Math.max(0.08, 0.15 * (yHi - yLo));
  const xDomain: [number, number] = [Math.floor(xLo - xPad), Math.ceil(xHi + xPad)];
  const yDomain: [number, number] = [Math.floor((yLo - yPad) * 20) / 20, Math.ceil((yHi + yPad) * 20) / 20];
  const few = rows.length <= LABEL_ALL;
  const maxPlays = Math.max(1, ...rows.map((r) => r.stats.plays));
  const scatter: ScatterPoint[] = rows
    .map((r) => {
      const pin = pinned.includes(r.qb.id);
      const photo = Boolean(r.qb.headshot) && (pin || few);
      const cpoe = r.stats.cpoe ?? 0;
      return {
        id: r.qb.id,
        name: r.qb.name,
        last: r.qb.name.split(" ").pop() ?? r.qb.name,
        team: r.qb.team,
        headshot: r.qb.headshot,
        epa: r.stats.epa ?? 0,
        cpoe,
        plays: r.stats.plays,
        pinned: pin,
        photo,
        label: pin || few,
        flip: cpoe > xDomain[0] + 0.6 * (xDomain[1] - xDomain[0]),
        r: photo ? (pin ? 15 : 12) : 5 + 4 * (r.stats.plays / maxPlays),
      };
    })
    // Pinned quarterbacks draw last, on top of the rest.
    .sort((a, b) => Number(a.pinned) - Number(b.pinned));

  const togglePin = (id: string) => void update({ type: "toggle-pin", id, defaults: seasonDefaults });

  const weekRows = useMemo(() => {
    if (season < 2026) return [];
    return allQbs
      .filter((q) => q.season === 2026 && (q.weeks?.length ?? 0) > 0)
      .slice()
      .sort((a, b) => (b.overall.plays ?? 0) - (a.overall.plays ?? 0));
  }, [allQbs, season]);
  const weeks = useMemo(
    () => [...new Set(weekRows.flatMap((q) => (q.weeks ?? []).map((w) => w.week)))].sort((a, b) => a - b),
    [weekRows],
  );
  const [weekPick, setWeekPick] = useState<number | null>(null);
  const shownWeek = weekPick !== null && weeks.includes(weekPick) ? weekPick : (weeks[weeks.length - 1] ?? null);

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
  const pinnedRows = pinItems.filter((p): p is PinRow => p.kind === "row");

  const quad = (value: string, position: "insideTopRight" | "insideTopLeft" | "insideBottomRight" | "insideBottomLeft") => ({
    value,
    position,
    offset: 10,
    fill: INK_QUIET,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.08em",
    // Corner names need room; phones get the key under the chart instead.
    className: "hidden sm:inline",
  });

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <header className="max-w-2xl">
          <h1 className="font-display text-5xl uppercase tracking-[0.03em] sm:text-6xl">QB</h1>
        </header>
        <FirstLook id="qb" title="This page">
          <p>
            Each photo or dot on the chart is a quarterback. Tap one, or a Board row, to pin it. Filters
            change the slice — 3rd down is not the same player as 1st-and-10.
          </p>
        </FirstLook>

        <div className="mt-8 flex flex-col gap-4 rounded-xl bg-surface p-4 sm:p-5">
          <div className="flex flex-wrap items-start gap-3">
            <Segmented
              value={String(season)}
              onChange={(v) => void update({ type: "season", season: Number(v) })}
              options={seasons.map((s) => ({ value: String(s), label: String(s) }))}
            />
            <span className="self-center text-xs tracking-[0.12em] text-muted uppercase">
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
              <span className="text-xs tracking-[0.12em] text-muted uppercase" data-testid="min-plays">
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

        {weekRows.length > 0 && shownWeek !== null && (
          <div className="mt-4 rounded-xl bg-surface p-4 shadow-[var(--shadow-border)] sm:p-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="font-display text-2xl uppercase tracking-[0.05em]">By week</h2>
                <p className="text-sm text-muted">EPA per dropback · week {shownWeek}</p>
              </div>
              {weeks.length > 1 && (
                <Segmented
                  value={String(shownWeek)}
                  onChange={(v) => setWeekPick(Number(v))}
                  options={weeks.map((w) => ({ value: String(w), label: `W${w}` }))}
                />
              )}
            </div>
            <WeekBars qbs={weekRows} week={shownWeek} />
          </div>
        )}

        <div className="mt-4 grid items-start gap-4 lg:grid-cols-[1.4fr_1fr]">
          <div className="min-w-0 rounded-xl bg-surface p-4 shadow-[var(--shadow-border)] sm:p-5">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 className="font-display text-2xl uppercase tracking-[0.05em]">EPA vs CPOE</h2>
              <p className="text-sm text-muted">{few ? "Faded = not pinned" : "Photos = pinned · bigger dot = more dropbacks"}</p>
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
                <div className="h-[340px] sm:h-[420px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 12, right: 16, bottom: 22, left: 8 }}>
                      <ReferenceArea
                        x1={0}
                        x2={xDomain[1]}
                        y1={0}
                        y2={yDomain[1]}
                        fill={CHART.sage}
                        fillOpacity={0.12}
                        strokeOpacity={0}
                        label={quad("ACCURATE + PRODUCTIVE", "insideTopRight")}
                      />
                      <ReferenceArea
                        x1={xDomain[0]}
                        x2={0}
                        y1={0}
                        y2={yDomain[1]}
                        fillOpacity={0}
                        strokeOpacity={0}
                        label={quad("PRODUCTIVE, LESS ACCURATE", "insideTopLeft")}
                      />
                      <ReferenceArea
                        x1={0}
                        x2={xDomain[1]}
                        y1={yDomain[0]}
                        y2={0}
                        fillOpacity={0}
                        strokeOpacity={0}
                        label={quad("ACCURATE, NOT PRODUCTIVE", "insideBottomRight")}
                      />
                      <ReferenceArea
                        x1={xDomain[0]}
                        x2={0}
                        y1={yDomain[0]}
                        y2={0}
                        fill={CHART.rust}
                        fillOpacity={0.1}
                        strokeOpacity={0}
                        label={quad("STRUGGLING", "insideBottomLeft")}
                      />
                      <CartesianGrid stroke="rgba(241,240,234,0.09)" />
                      <ReferenceLine x={0} stroke="rgba(241,240,234,0.42)" strokeWidth={1.5} />
                      <ReferenceLine y={0} stroke="rgba(241,240,234,0.42)" strokeWidth={1.5} />
                      <XAxis
                        type="number"
                        dataKey="cpoe"
                        domain={xDomain}
                        ticks={niceTicks(xDomain[0], xDomain[1], [1, 2, 3, 5, 10])}
                        name="CPOE"
                        stroke={CHART.axis}
                        tickLine={false}
                        tick={{ fill: INK_QUIET, fontSize: 12 }}
                        tickFormatter={(v: number) => (v > 0 ? `+${v.toFixed(0)}` : v.toFixed(0))}
                        label={{
                          value: "Completion % over expected (CPOE) →",
                          position: "insideBottom",
                          offset: -16,
                          fill: INK,
                          fontSize: 13,
                          fontWeight: 600,
                        }}
                      />
                      <YAxis
                        type="number"
                        dataKey="epa"
                        width={62}
                        domain={yDomain}
                        ticks={niceTicks(yDomain[0], yDomain[1], [0.05, 0.1, 0.2, 0.25, 0.5])}
                        name="EPA"
                        stroke={CHART.axis}
                        tickLine={false}
                        tick={{ fill: INK_QUIET, fontSize: 12 }}
                        tickFormatter={(v: number) => {
                          const n = Math.abs(v) < 0.005 ? 0 : v;
                          return n > 0 ? `+${n.toFixed(2)}` : n.toFixed(2);
                        }}
                        label={{
                          value: "EPA per dropback →",
                          angle: -90,
                          position: "insideLeft",
                          offset: 0,
                          fill: INK,
                          fontSize: 13,
                          fontWeight: 600,
                          style: { textAnchor: "middle" },
                        }}
                      />
                      <Tooltip cursor={{ stroke: CHART.paper, strokeDasharray: "3 3" }} content={<QbDotTip />} />
                      <Scatter
                        data={scatter}
                        shape={QbDot}
                        isAnimationActive={false}
                        onClick={(d: { id?: string }) => d?.id && togglePin(d.id)}
                      />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
                <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 px-1 text-[13px] text-muted sm:hidden" aria-label="Chart corners">
                  <li>↖ Productive, less accurate</li>
                  <li>↗ Accurate + productive</li>
                  <li>↙ Struggling</li>
                  <li>↘ Accurate, not productive</li>
                </ul>
              </div>
            )}
          </div>

          <div className="min-w-0 rounded-xl bg-surface p-4 shadow-[var(--shadow-border)] sm:p-5">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-display text-2xl uppercase tracking-[0.05em]">Pinned</h2>
              {pinnedRows.length > 0 && <p className="text-sm text-muted">{pinnedRows.length} pinned</p>}
            </div>
            <ul data-testid="pinned-list" className="mt-3 space-y-1">
              {pinItems.length === 0 && (
                <li className="p-2 text-[15px] text-muted">Tap a photo, a dot or a Board row to compare quarterbacks.</li>
              )}
              {pinItems.map((item) =>
                item.kind === "row" ? (
                  <li key={item.id} data-pin-id={item.id}>
                    <button
                      type="button"
                      onClick={() => togglePin(item.id)}
                      title={`Unpin ${item.qb.name}`}
                      className="flex w-full items-center gap-3 rounded-lg p-2.5 text-left hover:bg-elevated"
                    >
                      <Headshot src={item.qb.headshot} name={item.qb.name} team={item.qb.team} className="size-12" />
                      <div className="min-w-0 flex-1">
                        <p data-pin-name className="truncate text-base font-semibold">
                          {item.qb.name}
                        </p>
                        <p className="text-[13px] text-muted">
                          {teamNick(item.qb.team)} · {item.stats.plays} dropback{item.stats.plays === 1 ? "" : "s"}
                          {isThin(item.stats.plays) ? " · small sample" : ""}
                        </p>
                        {season >= 2026 && item.qb.weeks && item.qb.weeks.length > 1 && (
                          <p className="mt-0.5 text-[13px] text-muted tabular-nums">
                            {item.qb.weeks.map((w) => `W${w.week} ${formatEpa(w.epa)}`).join(" · ")}
                          </p>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <p
                          className={cn(
                            "font-display text-3xl leading-none font-bold tabular-nums",
                            (item.stats.epa ?? 0) >= 0 ? "text-up" : "text-down",
                          )}
                        >
                          {formatEpa(item.stats.epa)}
                        </p>
                        <p className="mt-1 text-xs text-muted">EPA / dropback</p>
                      </div>
                    </button>
                  </li>
                ) : (
                  <li
                    key={item.id}
                    data-pin-id={item.id}
                    data-unresolved={item.pending ? "pending" : "explained"}
                    className="flex items-center gap-3 rounded-lg p-2.5"
                  >
                    <span
                      aria-hidden
                      className="grid size-12 shrink-0 place-items-center rounded-full bg-elevated text-sm font-semibold text-subtle"
                    >
                      {item.pending ? "…" : "?"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base text-muted">{item.name ?? item.id}</p>
                      <p className="text-[13px] text-subtle">{item.note}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => togglePin(item.id)}
                      aria-label={`Unpin ${item.name ?? item.id}`}
                      className="h-9 rounded-sm px-2 text-xs font-semibold tracking-wide text-muted uppercase hover:text-fg"
                    >
                      Unpin
                    </button>
                  </li>
                ),
              )}
            </ul>
            {pinnedRows.length >= 2 && (
              <>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr>
                        <th className="py-2 font-medium">
                          <span className="sr-only">Stat</span>
                        </th>
                        {pinnedRows.map((r) => (
                          <th key={r.qb.id} scope="col" className="px-2 py-2 text-right text-[15px] font-bold">
                            {r.qb.name.split(" ").pop()}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {COMPARE.map((row) => {
                        const vals = pinnedRows.map(row.value);
                        const nums = vals.filter((v): v is number => v != null);
                        const best =
                          row.best && nums.length > 1 ? (row.best === "max" ? Math.max(...nums) : Math.min(...nums)) : null;
                        return (
                          <tr key={row.label} className="border-t border-border/70">
                            <th scope="row" className="py-2 pr-2 text-sm font-medium text-muted">
                              {row.label}
                              {row.note && <span className="block text-xs font-normal text-subtle">{row.note}</span>}
                            </th>
                            {pinnedRows.map((r, i) => (
                              <td key={r.qb.id} className="px-2 py-2 text-right text-base font-semibold whitespace-nowrap tabular-nums">
                                {best !== null && vals[i] === best ? (
                                  <span className="-mr-2 inline-block rounded-full bg-sage/20 px-2 text-up">{row.text(r)}</span>
                                ) : (
                                  row.text(r)
                                )}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="mt-3 text-[13px] text-subtle">Green marks the best of the pinned group.</p>
              </>
            )}
          </div>
        </div>

        <div className="mt-6 overflow-hidden rounded-xl bg-surface shadow-[var(--shadow-border)]">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5">
            <h2 className="font-display text-2xl uppercase tracking-[0.05em]">Board</h2>
            <div className="flex flex-wrap gap-1">
              {(["epa", "cpoe", "comp", "press"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void update({ type: "sort", sort: s })}
                  className={cn(
                    "h-9 rounded-md px-3 text-xs font-bold tracking-[0.06em] uppercase transition-colors",
                    sort === s ? "bg-accent text-accent-fg" : "text-muted hover:bg-elevated hover:text-fg",
                  )}
                >
                  {s === "epa" ? "EPA" : s === "cpoe" ? "CPOE" : s === "comp" ? "Comp" : "Press"}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-[15px]">
              <thead className="text-xs tracking-[0.08em] text-muted uppercase">
                <tr className="border-y border-border">
                  <th className="px-4 py-2.5 font-bold sm:px-5">Quarterback</th>
                  <th className="px-3 py-2.5 text-right font-bold">Dropbacks</th>
                  <th className="px-3 py-2.5 text-right font-bold">
                    <StatTip metric="epa" />
                  </th>
                  <th className="px-3 py-2.5 text-right font-bold">
                    <StatTip metric="cpoe" />
                  </th>
                  <th className="px-3 py-2.5 text-right font-bold">
                    <StatTip metric="passer" />
                  </th>
                  <th className="px-3 py-2.5 text-right font-bold">Comp</th>
                  <th className="px-3 py-2.5 text-right font-bold">
                    <StatTip metric="success" />
                  </th>
                  <th className="px-3 py-2.5 text-right font-bold">
                    <StatTip metric="press" />
                  </th>
                  <th className="px-4 py-2.5 text-right font-bold sm:px-5">TD–INT</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-10 text-center text-[15px] text-muted">
                      No quarterbacks pass the min on {label.toLowerCase()}. Drop the slider.
                    </td>
                  </tr>
                )}
                {rows.map((r) => {
                  const active = pinned.includes(r.qb.id);
                  const epaUp = (r.stats.epa ?? 0) >= 0;
                  return (
                    <tr
                      key={r.qb.id}
                      data-qb-id={r.qb.id}
                      onClick={() => togglePin(r.qb.id)}
                      className={cn(
                        "cursor-pointer border-b border-border/70 transition-colors last:border-0",
                        active ? "bg-elevated" : "hover:bg-elevated/60",
                      )}
                    >
                      <td className="px-4 py-2.5 sm:px-5">
                        <div className="flex items-center gap-3">
                          <Headshot src={r.qb.headshot} name={r.qb.name} team={r.qb.team} className="size-10" />
                          <div className="min-w-0">
                            <p className="font-semibold whitespace-nowrap">{r.qb.name}</p>
                            <p className="text-[13px] text-muted">
                              {r.qb.team} · {teamNick(r.qb.team)}
                            </p>
                          </div>
                          {active && (
                            <span className="rounded-full bg-fg/10 px-2 py-0.5 text-xs font-semibold text-fg">Pinned</span>
                          )}
                        </div>
                      </td>
                      <td className={cn("px-3 py-2.5 text-right tabular-nums", isThin(r.stats.plays) && "text-muted")}>
                        {r.stats.plays}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        <span
                          className={cn(
                            "inline-block min-w-[5.5rem] rounded-full px-2.5 py-0.5 text-center font-bold",
                            epaUp ? "bg-sage/20 text-up" : "bg-rust/20 text-down",
                          )}
                        >
                          {formatEpa(r.stats.epa)}
                        </span>
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2.5 text-right font-semibold tabular-nums",
                          (r.stats.cpoe ?? 0) >= 0 ? "text-up" : "text-down",
                        )}
                      >
                        {formatCpoe(r.stats.cpoe)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatPasser(passerRating(r.qb.box))}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatPct(r.stats.comp)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatPct(r.stats.success)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatPct(r.stats.press)}</td>
                      <td className="px-4 py-2.5 text-right text-muted tabular-nums sm:px-5">
                        {r.stats.td}–{r.stats.int}
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
