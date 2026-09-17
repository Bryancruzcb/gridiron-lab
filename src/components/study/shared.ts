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

export const study = seasonsFile as unknown as StudySeasonsFile;
export const backtest = backtestFile as BacktestFile;
export const lag = lagFile as QbLagFile;
export const projections = projFile as ProjectionFile;
export const ewma = ewmaFile as EwmaFile;

/** Model ids written by the study pipeline's core preset. */
export const COMPUTER = "trail";
export const TOP_NAMES = "trail-greedy-proj";
export const CHEAP = "trail-greedy-value";
export const EWMA = "ewma";

/** Fixed decimals with a typographic minus; a rounded negative zero prints as zero. */
export function fix(x: number, digits: number): string {
  const s = x.toFixed(digits);
  if (/^-0\.?0*$/.test(s)) return s.slice(1);
  return s.startsWith("-") ? `−${s.slice(1)}` : s;
}

export function ticks(lo: number, hi: number, step: number): number[] {
  const out: number[] = [];
  for (let v = lo; v <= hi + 1e-9; v += step) out.push(v);
  return out;
}

export function signed(x: number, digits = 1): string {
  const s = fix(x, digits);
  return x > 0 && s !== fix(0, digits) ? `+${s}` : s;
}

export function model(summary: StudyRunSummary, id: string): StudyModelSummary {
  const m = summary.models.find((x) => x.model === id);
  if (!m) throw new Error(`study-seasons.json has no model ${id}`);
  return m;
}

export function mean(m: StudyModelSummary): number {
  return m.lineupActualMean ?? Number.NaN;
}

export type Gap = { n: number; mean: number; low: number | null; high: number | null; wins: number; losses: number; ties: number };

/** A model's weekly lineup score minus the computer's, from the stored paired comparison. */
export function overComputer(summary: StudyRunSummary, id: string): Gap {
  const p = summary.paired.find((x) => x.model === id && x.baseline === COMPUTER);
  if (!p || p.meanDiff == null) throw new Error(`study-seasons.json has no paired comparison for ${id}`);
  return { n: p.n, mean: p.meanDiff, low: p.interval?.low ?? null, high: p.interval?.high ?? null, wins: p.wins, losses: p.losses, ties: p.ties };
}

/** The computer's weekly score minus a model's: the stored comparison turned around. */
export function computerOver(summary: StudyRunSummary, id: string): Gap {
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

export function range(g: Gap): string {
  return g.low == null || g.high == null ? "no range" : `${signed(g.low)} to ${signed(g.high)}`;
}

export function verdict(g: Gap): string {
  if (g.low == null || g.high == null) return "too few weeks to say more";
  if (g.low > 0) return "the whole range is above zero";
  if (g.high < 0) return "the whole range is below zero";
  return "the range includes zero, so these weeks can’t tell them apart";
}

export const ROLE_WORDS: Record<StudyRole, string> = {
  development: "checked first",
  holdout: "fresh test",
  retrospective: "look back",
};

export type View = { key: string; label: string; note: string; row: StudySeasonRow };

export const views: View[] = [
  ...study.seasons.map((s) => ({ key: String(s.season), label: String(s.season), note: ROLE_WORDS[s.role], row: s })),
  ...(study.shippedSlate
    ? [{ key: "shipped", label: `${study.shippedSlate.season} shipped slate`, note: "look-ahead pool", row: study.shippedSlate }]
    : []),
];

export const pool = study.pools.find((p) => p.seasons.length === study.seasons.length) ?? null;
export const lastSeason = study.seasons[study.seasons.length - 1];
export const main = pool?.summary ?? lastSeason?.summary ?? null;
export const mainLabel = pool
  ? `${pool.seasons[0]}–${pool.seasons[pool.seasons.length - 1]}`
  : String(lastSeason?.season ?? "");
export const seasonList = study.seasons.map((s) => s.season).join(", ");
export const firstSeason = study.seasons[0]?.season;
export const lastSeasonYear = lastSeason?.season;
export const developmentSeasons = study.seasons.filter((s) => s.role === "development").map((s) => s.season);
export const lookBackSeasons = study.seasons.filter((s) => s.role === "retrospective").map((s) => s.season);

export const computerWeeks = study.seasons.flatMap((s) => s.weekly.map((w) => w.lineups[COMPUTER]!));
export const guessHigh = computerWeeks.filter((l) => l.proj > l.actual).length;

export const exactModels = study.models.filter((m) => m.solver === "exact-dp");

export { axisProps, CHART, cn };
