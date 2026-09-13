import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import backtestFile from "@/data/study-backtest.json";
import ewmaFile from "@/data/study-ewma.json";
import lagFile from "@/data/study-qb-lag.json";
import projFile from "@/data/study-projections.json";
import seasonsFile from "@/data/study-seasons.json";
import { AppShell } from "@/components/layout/AppShell";
import { axisProps, CHART } from "@/components/charts/theme";
import type {
  BacktestFile,
  EwmaFile,
  ProjectionFile,
  QbLagFile,
  StudyModelSummary,
  StudyRole,
  StudyRunSummary,
  StudySeasonRow,
  StudySeasonsFile,
} from "@/data/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/study")({ component: StudyPage });

const study = seasonsFile as unknown as StudySeasonsFile;
const backtest = backtestFile as BacktestFile;
const lag = lagFile as QbLagFile;
const projections = projFile as ProjectionFile;
const ewma = ewmaFile as EwmaFile;

// Model ids written by the study pipeline's core preset.
const COMPUTER = "trail";
const TOP_NAMES = "trail-greedy-proj";
const CHEAP = "trail-greedy-value";
const EWMA = "ewma";

/** Fixed decimals with a typographic minus; a rounded negative zero prints as zero. */
function fix(x: number, digits: number): string {
  const s = x.toFixed(digits);
  if (/^-0\.?0*$/.test(s)) return s.slice(1);
  return s.startsWith("-") ? `−${s.slice(1)}` : s;
}

function ticks(lo: number, hi: number, step: number): number[] {
  const out: number[] = [];
  for (let v = lo; v <= hi + 1e-9; v += step) out.push(v);
  return out;
}

function signed(x: number, digits = 1): string {
  const s = fix(x, digits);
  return x > 0 && s !== fix(0, digits) ? `+${s}` : s;
}

function model(summary: StudyRunSummary, id: string): StudyModelSummary {
  const m = summary.models.find((x) => x.model === id);
  if (!m) throw new Error(`study-seasons.json has no model ${id}`);
  return m;
}

function mean(m: StudyModelSummary): number {
  return m.lineupActualMean ?? Number.NaN;
}

type Gap = { n: number; mean: number; low: number | null; high: number | null; wins: number; losses: number; ties: number };

/** A model's weekly lineup score minus the computer's, from the stored paired comparison. */
function overComputer(summary: StudyRunSummary, id: string): Gap {
  const p = summary.paired.find((x) => x.model === id && x.baseline === COMPUTER);
  if (!p || p.meanDiff == null) throw new Error(`study-seasons.json has no paired comparison for ${id}`);
  return { n: p.n, mean: p.meanDiff, low: p.interval?.low ?? null, high: p.interval?.high ?? null, wins: p.wins, losses: p.losses, ties: p.ties };
}

/** The computer's weekly score minus a model's: the stored comparison turned around. */
function computerOver(summary: StudyRunSummary, id: string): Gap {
  const g = overComputer(summary, id);
  return {
    n: g.n,
    mean: -g.mean,
    low: g.high == null ? null : -g.high,
    high: g.low == null ? null : -g.low,
    wins: g.losses,
    losses: g.wins,
    ties: g.ties,
  };
}

function range(g: Gap): string {
  return g.low == null || g.high == null ? "no range" : `${signed(g.low)} to ${signed(g.high)}`;
}

function verdict(g: Gap): string {
  if (g.low == null || g.high == null) return "too few weeks to say more";
  if (g.low > 0) return "the whole range is above zero";
  if (g.high < 0) return "the whole range is below zero";
  return "the range includes zero, so these weeks can’t tell them apart";
}

const ROLE_WORDS: Record<StudyRole, string> = {
  development: "checked first",
  holdout: "fresh test",
  retrospective: "look back",
};

type View = { key: string; label: string; note: string; row: StudySeasonRow };

const views: View[] = [
  ...study.seasons.map((s) => ({ key: String(s.season), label: String(s.season), note: ROLE_WORDS[s.role], row: s })),
  ...(study.shippedSlate
    ? [{ key: "shipped", label: `${study.shippedSlate.season} shipped slate`, note: "look-ahead pool", row: study.shippedSlate }]
    : []),
];

const pool = study.pools.find((p) => p.seasons.length === study.seasons.length) ?? null;
const lastSeason = study.seasons[study.seasons.length - 1];
const main = pool?.summary ?? lastSeason?.summary ?? null;
const mainLabel = pool
  ? `${pool.seasons[0]}–${pool.seasons[pool.seasons.length - 1]}`
  : String(lastSeason?.season ?? "");
const seasonList = study.seasons.map((s) => s.season).join(", ");
const firstSeason = study.seasons[0]?.season;
const lastSeasonYear = lastSeason?.season;
const developmentSeasons = study.seasons.filter((s) => s.role === "development").map((s) => s.season);
const lookBackSeasons = study.seasons.filter((s) => s.role === "retrospective").map((s) => s.season);

const computerWeeks = study.seasons.flatMap((s) => s.weekly.map((w) => w.lineups[COMPUTER]!));
const guessHigh = computerWeeks.filter((l) => l.proj > l.actual).length;

const exactModels = study.models.filter((m) => m.solver === "exact-dp");

function StudyPage() {
  const [viewKey, setViewKey] = useState(views.find((v) => v.key === String(lastSeasonYear))?.key ?? views[0]?.key ?? "");
  const view = views.find((v) => v.key === viewKey) ?? views[0];
  const ready = Boolean(main && view && lag.n > 0);

  return (
    <AppShell>
      <article className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <p className="text-sm text-muted">
          <Link to="/" className="hover:text-fg">
            Home
          </Link>
        </p>
        <h1 className="mt-3 font-display text-5xl uppercase tracking-[0.03em]">Study</h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted">
          A check on past seasons. Did the Lineup computer actually help, and does last week’s QB
          number predict this week?
        </p>

        {!ready || !main || !view ? (
          <p className="mt-10 text-sm text-muted">Loading the study…</p>
        ) : (
          <>
            <section className="mt-10">
              <h2 className="font-display text-2xl uppercase tracking-[0.04em]">What this is</h2>
              <p className="mt-3 text-sm leading-relaxed">
                Fantasy lineups here have a <strong className="font-medium text-fg">$50,000 budget</strong>,
                like DraftKings. You pick 9 players. Stars cost more. The Lineup page has a computer
                that builds a team under that budget. This page is not a live tool. It replays the{" "}
                {seasonList} seasons: before each week we guessed every player’s points, let the
                computer pick, then scored the team on the points the players actually got that week.
              </p>
            </section>

            <section className="mt-10">
              <h2 className="font-display text-2xl uppercase tracking-[0.04em]">Two questions</h2>
              <ol className="mt-3 list-decimal space-y-3 pl-5 text-sm leading-relaxed">
                <li>
                  After the games, did the computer’s $50k team score more points than just taking
                  the highest-projected names that still fit the budget?
                </li>
                <li>
                  If a quarterback looked good last week (EPA or CPOE), did he look good this week
                  too?
                </li>
              </ol>
            </section>

            <section className="mt-10">
              <h2 className="font-display text-2xl uppercase tracking-[0.04em]">How we tested</h2>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed">
                <li>
                  Weeks {view.row.weeks.from}–{view.row.weeks.to} of each season. Week 1 is skipped:
                  nobody has a game to average yet.
                </li>
                <li>
                  Each season gets its own pool of players and fake prices, built only from the
                  season before: the top players by points per game, priced on a straight line of
                  that average. Frozen before week 1. Rookies and offseason trades are missing.
                  These are not real DraftKings salaries.
                </li>
                <li>
                  A player’s guess uses only games before that week. His opponent comes from the
                  schedule, not from the box score after the game.
                </li>
                <li>
                  The computer must prove its team is the best one for the guesses. If it can’t, or
                  a picked player’s score is missing, that week is thrown out for every method.
                  {main.excludedWeeks.length === 0 ? " No week was thrown out." : ` ${main.excludedWeeks.length} weeks were thrown out.`}
                </li>
                <li>
                  {developmentSeasons.length ? `${developmentSeasons.join(" and ")} came first. ` : ""}
                  We changed no setting after seeing them.{" "}
                  {lookBackSeasons.length
                    ? `${lookBackSeasons.join(" and ")} is a look back, not a fresh test: we had already studied it.`
                    : ""}
                </li>
                <li>
                  Scoring is our simplified DraftKings-style PPR. A defense’s points allowed is the
                  other team’s final score.
                </li>
              </ul>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                Three kinds of numbers show up in this app. A <em>forecast</em> is the guess before
                kickoff. A <em>look back</em> (this page) scores those guesses after the fact. <em>Hindsight</em>{" "}
                on the Lineup page rebuilds a team from points already scored, so it is not a forecast
                at all.
              </p>
            </section>

            <DidItHelp view={view} setViewKey={setViewKey} summary={main} label={mainLabel} />

            <TooOptimistic view={view} summary={main} label={mainLabel} />

            <BetterGuesses summary={main} label={mainLabel} />

            <section className="mt-10">
              <h2 className="font-display text-2xl uppercase tracking-[0.04em]">How much to trust last week</h2>
              <EwmaText />
              <div className="mt-6 h-[240px] rounded-xl bg-surface p-3 shadow-[var(--shadow-border)] sm:p-4">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={ewma.points} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                    <CartesianGrid stroke={CHART.grid} />
                    <XAxis
                      dataKey="alpha"
                      type="number"
                      domain={[0, 1]}
                      ticks={[0.2, 0.4, 0.6, 0.8, 1]}
                      {...axisProps}
                      tick={{ fill: "#C5CCD6", fontSize: 11 }}
                    />
                    <YAxis
                      domain={ewmaDomain()}
                      ticks={ticks(...ewmaDomain(), 5)}
                      width={36}
                      {...axisProps}
                      tick={{ fill: "#C5CCD6", fontSize: 11 }}
                    />
                    <ReferenceLine y={ewma.trail.lineupMean} stroke={CHART.muted} strokeDasharray="4 4" />
                    <Tooltip content={<AlphaTip trail={ewma.trail.lineupMean} />} />
                    <Line
                      type="linear"
                      dataKey="lineupMean"
                      stroke={CHART.paper}
                      strokeWidth={2}
                      dot={{ r: 3, fill: CHART.paper }}
                      activeDot={{ r: 5, fill: CHART.sage }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-2 text-xs text-muted">
                Shipped {ewma.season} slate. Team’s real points vs how hard we weight last week. Dashed
                = season average so far ({ewma.trail.lineupMean}).
              </p>
            </section>

            <HotQbs />

            <WhatWentWrong />

            <p className="mt-10 text-xs leading-relaxed text-muted">
              Every number on this page is read from files the study pipeline writes: runs{" "}
              {[...study.seasons, ...(study.shippedSlate ? [study.shippedSlate] : [])]
                .map((s) => `${s.season}${s.universe.lookAhead ? " shipped" : ""} ${s.runId}`)
                .join(", ")}
              . The README lists the commands. docs/study/REGENERATION_REPORT.md explains how these
              numbers differ from earlier versions of this page.
            </p>
          </>
        )}
      </article>
    </AppShell>
  );
}

function ViewPicker({ viewKey, setViewKey }: { viewKey: string; setViewKey: (key: string) => void }) {
  return (
    <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Season">
      {views.map((v) => (
        <button
          key={v.key}
          type="button"
          aria-pressed={v.key === viewKey}
          onClick={() => setViewKey(v.key)}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs uppercase tracking-[0.08em] shadow-[var(--shadow-border)] transition-colors",
            v.key === viewKey ? "bg-elevated text-fg" : "text-muted hover:text-fg",
          )}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}

function DidItHelp({
  view,
  setViewKey,
  summary,
  label,
}: {
  view: View;
  setViewKey: (key: string) => void;
  summary: StudyRunSummary;
  label: string;
}) {
  const top = computerOver(summary, TOP_NAMES);
  const cheap = computerOver(summary, CHEAP);
  const answer = top.low != null && top.low > 0 ? "Yes." : top.high != null && top.high < 0 ? "No." : "Not clearly.";
  const rows = [
    ...study.seasons.map((s) => ({ key: String(s.season), label: String(s.season), note: ROLE_WORDS[s.role], summary: s.summary, muted: false })),
    ...(pool ? [{ key: "pool", label, note: "all seasons", summary: pool.summary, muted: false }] : []),
    ...(study.shippedSlate
      ? [{ key: "shipped", label: `${study.shippedSlate.season} shipped`, note: "look-ahead", summary: study.shippedSlate.summary, muted: true }]
      : []),
  ];
  const weekly = view.row.weekly;
  const vs = view.row.summary;

  return (
    <section className="mt-10">
      <h2 className="font-display text-2xl uppercase tracking-[0.04em]">Did the computer help?</h2>
      <p className="mt-3 text-sm leading-relaxed">
        {answer} Over {top.n} weeks in {label} the computer averaged{" "}
        <strong className="font-medium text-fg">{fix(mean(model(summary, COMPUTER)), 1)}</strong> real
        points a week. Grabbing the top projected names that still fit averaged{" "}
        {fix(mean(model(summary, TOP_NAMES)), 1)}. That’s {signed(top.mean)} points a week for the
        computer. It won {top.wins} weeks, lost {top.losses} and tied {top.ties} (a tie means both
        built the same team). The 95% range for that weekly gap runs from {range(top)}; {verdict(top)}.
        Picking “cheap production” (most projected points per dollar) averaged{" "}
        {fix(mean(model(summary, CHEAP)), 1)}: the computer beat it by {fix(cheap.mean, 1)} a week, and{" "}
        {verdict(cheap)}.
      </p>
      <div className="mt-6 overflow-x-auto rounded-xl bg-surface p-4 shadow-[var(--shadow-border)] sm:p-5">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <thead className="text-[11px] tracking-[0.12em] text-subtle uppercase">
            <tr className="border-b border-border">
              <th className="py-2 font-medium">Season</th>
              <th className="py-2 text-right font-medium">Weeks</th>
              <th className="py-2 text-right font-medium">Computer</th>
              <th className="py-2 text-right font-medium">Top names</th>
              <th className="py-2 text-right font-medium">Cheap picks</th>
              <th className="py-2 text-right font-medium">Gap (95% range)</th>
              <th className="py-2 text-right font-medium">W-L-T</th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {rows.map((r) => {
              const g = computerOver(r.summary, TOP_NAMES);
              return (
                <tr key={r.key} className={cn("border-b border-border/70", r.muted ? "text-muted" : undefined)}>
                  <td className="py-1.5 font-sans">
                    {r.label} <span className="text-xs text-muted">{r.note}</span>
                  </td>
                  <td className="py-1.5 text-right">{r.summary.commonWeeks.length}</td>
                  <td className="py-1.5 text-right">{fix(mean(model(r.summary, COMPUTER)), 1)}</td>
                  <td className="py-1.5 text-right">{fix(mean(model(r.summary, TOP_NAMES)), 1)}</td>
                  <td className="py-1.5 text-right text-muted">{fix(mean(model(r.summary, CHEAP)), 1)}</td>
                  <td className="py-1.5 text-right">
                    {signed(g.mean)} <span className="text-xs text-muted">({range(g)})</span>
                  </td>
                  <td className="py-1.5 text-right">
                    {g.wins}-{g.losses}-{g.ties}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted">
        Gap = computer minus top names, per week. 95% range: we resampled the weeks{" "}
        {study.uncertainty.resamples.toLocaleString("en-US")} times and kept the middle 95% of the
        average gap. Each week counts once, because nine players in one lineup are not nine separate
        tests. It is a rough guide, not a significance test. The shipped slate row uses the fixed
        114-player {study.shippedSlate?.season ?? ""} pool, which was picked and priced with that
        whole season’s numbers.
      </p>

      <h3 className="mt-8 text-sm font-medium">Week by week</h3>
      <ViewPicker viewKey={view.key} setViewKey={setViewKey} />
      <p className="mt-3 text-sm text-muted">
        {view.label} ({view.note}). Green = computer beat the top-names pick that week.
      </p>
      <div className="mt-4 overflow-x-auto rounded-xl bg-surface p-4 shadow-[var(--shadow-border)] sm:p-5">
        <table className="w-full min-w-[28rem] text-left text-sm">
          <thead className="text-[11px] tracking-[0.12em] text-subtle uppercase">
            <tr className="border-b border-border">
              <th className="py-2 font-medium">Week</th>
              <th className="py-2 text-right font-medium">Computer</th>
              <th className="py-2 text-right font-medium">Top names</th>
              <th className="py-2 text-right font-medium">Cheap picks</th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {weekly.map((w) => {
              const c = w.lineups[COMPUTER]!.actual;
              const t = w.lineups[TOP_NAMES]!.actual;
              return (
                <tr key={w.week} className="border-b border-border/70">
                  <td className="py-1.5">{w.week}</td>
                  <td className={cn("py-1.5 text-right", c > t ? "text-sage" : undefined)}>{fix(c, 1)}</td>
                  <td className="py-1.5 text-right">{fix(t, 1)}</td>
                  <td className="py-1.5 text-right text-muted">{fix(w.lineups[CHEAP]!.actual, 1)}</td>
                </tr>
              );
            })}
            <tr>
              <td className="py-2">Mean</td>
              <td className="py-2 text-right">{fix(mean(model(vs, COMPUTER)), 1)}</td>
              <td className="py-2 text-right">{fix(mean(model(vs, TOP_NAMES)), 1)}</td>
              <td className="py-2 text-right text-muted">{fix(mean(model(vs, CHEAP)), 1)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TooOptimistic({ view, summary, label }: { view: View; summary: StudyRunSummary; label: string }) {
  const computer = model(summary, COMPUTER);
  const dots = view.row.weekly.map((w) => ({ week: w.week, proj: w.lineups[COMPUTER]!.proj, actual: w.lineups[COMPUTER]!.actual }));
  const under = dots.filter((d) => d.actual < d.proj).length;
  const values = dots.flatMap((d) => [d.proj, d.actual]);
  const lo = Math.floor(Math.min(...values) / 25) * 25;
  const hi = Math.ceil(Math.max(...values) / 25) * 25;
  const every = guessHigh === computerWeeks.length;

  return (
    <section className="mt-10">
      <h2 className="font-display text-2xl uppercase tracking-[0.04em]">The computer was too optimistic</h2>
      <p className="mt-3 text-sm leading-relaxed">
        Before kickoff the computer expected its team to score about{" "}
        {fix(computer.lineupProjMean ?? Number.NaN, 0)} ({label}). It actually scored about{" "}
        {fix(mean(computer), 0)}. Its guess was too high in {guessHigh} of {computerWeeks.length} weeks
        {every ? ", every single one" : ""}. The guesses were not high player by player: over{" "}
        {computer.playerError.n.toLocaleString("en-US")} player-weeks the average miss was{" "}
        {signed(computer.playerError.bias ?? Number.NaN, 2)} points. The team guess runs high because
        the computer hunts for the players whose averages ran hottest so far, and hot streaks cool
        off. The old solver did have a bug (see below), but the fixed one proves its teams are the
        best for the guesses and still overshoots, so the bug was not the reason.
      </p>
      <ViewPickerLabel view={view} />
      <div className="mt-3 h-[240px] rounded-xl bg-surface p-3 shadow-[var(--shadow-border)] sm:p-4">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 12, bottom: 8, left: 4 }}>
            <CartesianGrid stroke={CHART.grid} />
            <XAxis
              type="number"
              dataKey="proj"
              name="Guess"
              domain={[lo, hi]}
              ticks={ticks(lo, hi, 25)}
              {...axisProps}
              tick={{ fill: "#C5CCD6", fontSize: 11 }}
            />
            <YAxis
              type="number"
              dataKey="actual"
              name="Real"
              domain={[lo, hi]}
              width={36}
              ticks={ticks(lo, hi, 25)}
              {...axisProps}
              tick={{ fill: "#C5CCD6", fontSize: 11 }}
            />
            <ReferenceLine
              segment={[
                { x: lo, y: lo },
                { x: hi, y: hi },
              ]}
              stroke={CHART.muted}
              strokeDasharray="4 4"
            />
            <Tooltip content={<GuessTip />} />
            <Scatter data={dots} fill={CHART.paper} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-xs text-muted">
        Each dot is a week. Perfect guesses would sit on the dashed line. {under} of {dots.length} dots
        are under it{under === dots.length ? ": the computer always thought it would score more than it did" : ""}.
      </p>
    </section>
  );
}

function ViewPickerLabel({ view }: { view: View }) {
  return (
    <p className="mt-4 text-xs text-muted">
      Showing {view.label}. Pick a season in the week-by-week table above.
    </p>
  );
}

function BetterGuesses({ summary, label }: { summary: StudyRunSummary; label: string }) {
  const rows = exactModels
    .map((spec) => ({ spec, m: model(summary, spec.id) }))
    .sort((a, b) => mean(b.m) - mean(a.m));
  const bestMae = [...rows].sort((a, b) => (a.m.playerError.mae ?? Infinity) - (b.m.playerError.mae ?? Infinity))[0]!;
  const bestTeam = rows[0]!;
  const trail = model(summary, COMPUTER);
  const ewmaGap = overComputer(summary, EWMA);
  const ewmaSeasons = study.seasons.filter((s) => overComputer(s.summary, EWMA).mean > 0).length;
  const shippedTrail = projections.models.find((m) => m.id === COMPUTER);
  const shippedEwma = projections.models.find((m) => m.id === EWMA);
  const shippedBestMae = [...projections.models].sort((a, b) => a.mae - b.mae)[0];
  const shippedBestTeam = [...projections.models].sort((a, b) => b.lineupMean - a.lineupMean)[0];

  return (
    <section className="mt-10">
      <h2 className="font-display text-2xl uppercase tracking-[0.04em]">Better guesses?</h2>
      <p className="mt-3 text-sm leading-relaxed">
        Same budget, same {trail.weeks} weeks, same pools. We only changed how we guess next week’s
        points. “Miss” is how far off each player’s guess was, on average, over{" "}
        {trail.playerError.n.toLocaleString("en-US")} player-weeks. “Team score” is what the computer’s
        9-man roster actually scored with that guess. The last column is the weekly team-score gap to
        the trailing mean, with its 95% range.
      </p>
      <div className="mt-6 overflow-x-auto rounded-xl bg-surface p-4 shadow-[var(--shadow-border)] sm:p-5">
        <table className="w-full min-w-[32rem] text-left text-sm">
          <thead className="text-[11px] tracking-[0.12em] text-subtle uppercase">
            <tr className="border-b border-border">
              <th className="py-2 font-medium">Guess method ({label})</th>
              <th className="py-2 text-right font-medium">Miss / player</th>
              <th className="py-2 text-right font-medium">Team score</th>
              <th className="py-2 text-right font-medium">vs trailing mean</th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {rows.map(({ spec, m }) => {
              const g = spec.id === COMPUTER ? null : overComputer(summary, spec.id);
              return (
                <tr key={spec.id} className="border-b border-border/70">
                  <td className="py-1.5 font-sans">{spec.label}</td>
                  <td className={cn("py-1.5 text-right", spec.id === bestMae.spec.id ? "text-sage" : undefined)}>
                    {fix(m.playerError.mae ?? Number.NaN, 2)}
                  </td>
                  <td className={cn("py-1.5 text-right", spec.id === bestTeam.spec.id ? "text-sage" : undefined)}>
                    {fix(mean(m), 1)}
                  </td>
                  <td className="py-1.5 text-right">
                    {g ? (
                      <>
                        {signed(g.mean)} <span className="text-xs text-muted">({range(g)})</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-sm leading-relaxed">
        {bestMae.spec.label} missed least per player ({fix(bestMae.m.playerError.mae ?? Number.NaN, 2)}).{" "}
        {bestMae.spec.id === bestTeam.spec.id
          ? "It also built the best teams."
          : `Missing less per player is not the same as a better team: its teams averaged ${fix(mean(bestMae.m), 1)}, while ${bestTeam.spec.label} built the best ones (${fix(mean(bestTeam.m), 1)}).`}{" "}
        {bestTeam.spec.id === EWMA
          ? `EWMA beat the trailing mean in ${ewmaSeasons} of ${study.seasons.length} seasons, by ${signed(ewmaGap.mean)} a week overall (range ${range(ewmaGap)}; ${verdict(ewmaGap)}). Its α=0.35 is a leftover default from the first 2025 scripts, not a setting we tuned on ${developmentSeasons.join(" and ") || "earlier seasons"}.`
          : ""}
      </p>
      {shippedTrail && shippedEwma && shippedBestMae && shippedBestTeam ? (
        <p className="mt-3 text-sm leading-relaxed text-muted">
          On the shipped {projections.season} slate the story shifts: {shippedBestMae.label}{" "}
          {shippedBestMae.id === bestMae.spec.id ? "still " : ""}missed least ({fix(shippedBestMae.mae, 2)}),{" "}
          {shippedBestTeam.label} built the best teams (
          {fix(shippedBestTeam.lineupMean, 1)}), and EWMA scored {fix(shippedEwma.lineupMean, 1)} against
          the trailing mean’s {fix(shippedTrail.lineupMean, 1)}. One pool and one season can flip a
          ranking.
        </p>
      ) : null}
    </section>
  );
}

function ewmaDomain(): [number, number] {
  const ys = [...ewma.points.map((p) => p.lineupMean), ewma.trail.lineupMean];
  return [Math.floor(Math.min(...ys) / 5) * 5, Math.ceil(Math.max(...ys) / 5) * 5];
}

function EwmaText() {
  let step = 0;
  for (let i = 1; i < ewma.points.length; i++) {
    step = Math.max(step, Math.abs(ewma.points[i]!.lineupMean - ewma.points[i - 1]!.lineupMean));
  }
  return (
    <p className="mt-3 text-sm leading-relaxed">
      Far left = mostly the season so far. Far right = only last week. The dashed line is “just use
      their average so far.” This sweep runs on the shipped {ewma.season} slate, after we had already
      studied {ewma.season}, so it is a look back, not a result. The best-looking setting was{" "}
      {ewma.bestLineup.alpha} ({ewma.bestLineup.lineupMean}) against {ewma.trail.lineupMean} for the
      average. Neighbouring settings differ by up to {fix(step, 1)} points. {ewma.trail.weeks} weeks is
      too few to treat the peak as a discovery.
    </p>
  );
}

function HotQbs() {
  const others = study.seasons.filter((s) => s.qbLag && s.season !== lag.season);
  return (
    <section className="mt-10">
      <h2 className="font-display text-2xl uppercase tracking-[0.04em]">Do hot QBs stay hot?</h2>
      <p className="mt-3 text-sm leading-relaxed">
        Almost no. In {lag.season}, last week’s EPA barely lines up with this week’s (r ={" "}
        {lag.corrEpa ?? "—"}, {lag.n} QB-weeks with {lag.minAttempts}+ throws). CPOE is the same story (r ={" "}
        {lag.corrCpoe ?? "—"}).
        {others.length
          ? ` Other seasons agree: ${others.map((s) => `${s.season} r = ${s.qbLag!.corrEpa ?? "—"} for EPA and ${s.qbLag!.corrCpoe ?? "—"} for CPOE (${s.qbLag!.n} QB-weeks)`).join("; ")}.`
          : ""}{" "}
        The QB page is a report card on what already happened. It is not a crystal ball for next
        Sunday.
      </p>
      <div className="mt-6 h-[320px] rounded-xl bg-surface p-3 shadow-[var(--shadow-border)] sm:p-4">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 12, bottom: 8, left: 4 }}>
            <CartesianGrid stroke={CHART.grid} />
            <XAxis
              type="number"
              dataKey="epaPrev"
              name="Last week"
              tickCount={5}
              {...axisProps}
              tick={{ fill: "#C5CCD6", fontSize: 11 }}
              tickFormatter={(v: number) => v.toFixed(1)}
            />
            <YAxis
              type="number"
              dataKey="epaNext"
              name="This week"
              width={40}
              tickCount={5}
              {...axisProps}
              tick={{ fill: "#C5CCD6", fontSize: 11 }}
              tickFormatter={(v: number) => v.toFixed(1)}
            />
            <Tooltip cursor={{ strokeDasharray: "3 3" }} content={<LagTip />} />
            <Scatter data={lag.pairs} fill={CHART.paper} fillOpacity={0.55} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-xs text-muted">
        {lag.season}. Left = last week’s EPA per throw. Up = this week. A tight diagonal would mean
        last week predicts this week. This is a cloud.
      </p>
    </section>
  );
}

function WhatWentWrong() {
  const s = backtest.summary;
  const shipped = study.shippedSlate;
  const inactive = study.policies.some((p) => p.includes("inactive"));
  const oppFloor = study.models.find((m) => m.method === "opp")?.params.clampLow ?? null;
  return (
    <section className="mt-10">
      <h2 className="font-display text-2xl uppercase tracking-[0.04em]">What went wrong</h2>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed">
        <li>
          Prices are fake DraftKings-style numbers, frozen all season, not the real weekly salary
          board. The pools miss rookies and offseason moves.
        </li>
        <li>
          The 114-player {shipped?.season ?? backtest.season} slate that ships with the Lineup page was
          picked and priced from that whole season, including weeks 14–18. That is look-ahead, so it
          is shown here only for comparison. On it the computer averaged {s.exactMean}, top names{" "}
          {s.greedyProjMean} and cheap picks {s.greedyValueMean}; the computer beat top names in{" "}
          {s.exactBeatsProj} of {s.weeks} weeks.
        </li>
        <li>
          Earlier versions of this page ruled out a bug in the picker. There was one: the old exact
          solver quietly handed about a third of its solves to a rough fallback and still called the
          result exact. The fixed solver either proves its team is the best or the week is thrown out.
        </li>
        <li>
          The old scripts also left players on a bye on the slate (they scored 0 when picked), and
          counted every extra point twice when estimating a defense’s points allowed. Both are fixed,
          and every number here was rebuilt.
        </li>
        {oppFloor != null ? (
          <li>
            The first opponent-adjusted guess compared the wrong groups: what an opponent gave up to
            every player at a position, backups included, against the average of only the pool’s top
            players. Most running backs, receivers and tight ends got the full{" "}
            {Math.round((1 - oppFloor) * 100)}% cut whoever they played. It now compares each opponent
            with every opponent over the same players, and its numbers here were rebuilt.
          </li>
        ) : null}
        {inactive ? (
          <li>
            A player with no stat line in a final game counts 0. The data can’t tell a benched
            player from one who played and recorded nothing.
          </li>
        ) : null}
        <li>
          {firstSeason && lastSeasonYear ? `Three seasons (${firstSeason}–${lastSeasonYear}) ` : "A few seasons "}
          is still a small sample, and {lookBackSeasons.join(" and ") || "the last season"} had been
          studied before. A good EPA week barely predicts the next one, and week 1 of 2026 is still a
          tiny sample in the live labs.
        </li>
      </ul>
    </section>
  );
}

function GuessTip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: { week: number; proj: number; actual: number } }>;
}) {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md bg-elevated px-3 py-2.5 text-sm text-fg shadow-[var(--shadow-border-hover)]">
      <p className="font-medium">Week {d.week}</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs tabular-nums">
        <dt className="text-muted">Thought</dt>
        <dd>{d.proj.toFixed(1)}</dd>
        <dt className="text-muted">Scored</dt>
        <dd>{d.actual.toFixed(1)}</dd>
      </dl>
    </div>
  );
}

function AlphaTip({
  active,
  payload,
  trail,
}: {
  active?: boolean;
  payload?: Array<{ payload: { alpha: number; lineupMean: number; mae: number } }>;
  trail: number;
}) {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md bg-elevated px-3 py-2.5 text-sm text-fg shadow-[var(--shadow-border-hover)]">
      <p className="font-medium">Last-week weight {d.alpha.toFixed(2)}</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs tabular-nums">
        <dt className="text-muted">Team score</dt>
        <dd>{d.lineupMean.toFixed(1)}</dd>
        <dt className="text-muted">Miss / player</dt>
        <dd>{d.mae.toFixed(2)}</dd>
        <dt className="text-muted">Season avg</dt>
        <dd>{trail.toFixed(1)}</dd>
      </dl>
    </div>
  );
}

function LagTip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{
    payload: { name: string; team: string; week: number; epaPrev: number; epaNext: number; attNext: number; cpoePrev: number | null };
  }>;
}) {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md bg-elevated px-3 py-2.5 text-sm text-fg shadow-[var(--shadow-border-hover)]">
      <p className="font-medium">{d.name}</p>
      <p className="text-xs text-muted">
        {d.team} · week {d.week}
      </p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs tabular-nums">
        <dt className="text-muted">Last EPA</dt>
        <dd>{d.epaPrev.toFixed(2)}</dd>
        <dt className="text-muted">This EPA</dt>
        <dd>{d.epaNext.toFixed(2)}</dd>
        <dt className="text-muted">Attempts</dt>
        <dd>{d.attNext}</dd>
      </dl>
    </div>
  );
}
