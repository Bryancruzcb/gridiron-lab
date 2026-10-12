// Pure number and comparison helpers for the study page (calculations only: no imports with effects,
// so node:test can load this file directly).
import type { StudyModelSummary, StudyRole, StudyRunSummary } from "@/data/types";

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

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

/** Small counts as words ("eight"), larger ones as digits. */
export function countWord(n: number): string {
  return Number.isInteger(n) && n >= 0 && n < WORDS.length ? WORDS[n]! : String(n);
}

export function thousands(n: number): string {
  return n.toLocaleString("en-US");
}
