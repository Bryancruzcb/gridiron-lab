// The README publishes study numbers by hand. These checks recompute each one from
// src/data/study-seasons.json, so a regeneration cannot leave the README quoting old results.
// When a README sentence is reworded on purpose, update the matching pattern here.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { StudyModelSummary, StudyPairedComparison, StudyRunSummary, StudySeasonsFile } from "../../src/data/types.ts";

const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const study = JSON.parse(readFileSync(new URL("../../src/data/study-seasons.json", import.meta.url), "utf8")) as StudySeasonsFile;

const BASELINE = "trail";
const GREEDY = "trail-greedy-proj";
const VALUE = "trail-greedy-value";
const MINUS = "−";

const pool = study.pools.find((p) => p.seasons.length === study.seasons.length);
const shipped = study.shippedSlate;
assert.ok(pool && shipped, "study-seasons.json has an all-season pool and the shipped slate");

const fix = (x: number, digits = 1) => Math.abs(x).toFixed(digits);
/** README style: +3.5, −10.2, and 0.0 without a sign. */
function signed(x: number, digits = 1): string {
  const s = fix(x, digits);
  if (Number(s) === 0) return s;
  return `${x > 0 ? "+" : MINUS}${s}`;
}
const thousands = (n: number) => n.toLocaleString("en-US");

function model(summary: StudyRunSummary, id: string): StudyModelSummary {
  const m = summary.models.find((x) => x.model === id);
  assert.ok(m, `model ${id} in study-seasons.json`);
  return m;
}
function paired(summary: StudyRunSummary, id: string): StudyPairedComparison & { meanDiff: number } {
  const p = summary.paired.find((x) => x.model === id && x.baseline === BASELINE);
  assert.ok(p && p.meanDiff != null && p.interval, `paired ${id} vs ${BASELINE} in study-seasons.json`);
  return p as StudyPairedComparison & { meanDiff: number };
}
const mean = (m: StudyModelSummary) => {
  assert.ok(m.lineupActualMean != null, `${m.model} has a lineup mean`);
  return m.lineupActualMean;
};
/** The exact solver's gain over a method: the negated paired difference, range flipped. */
function exactOver(summary: StudyRunSummary, id: string) {
  const p = paired(summary, id);
  return { mean: -p.meanDiff, low: -p.interval!.high, high: -p.interval!.low, exactWins: p.losses, exactLosses: p.wins, ties: p.ties };
}

/** Rows of the first Markdown table after `heading`, keyed by the first cell with bold removed. */
function table(after: string): Map<string, string[]> {
  const start = readme.indexOf(after);
  assert.ok(start >= 0, `README still has "${after}"`);
  const lines = readme.slice(start).split("\n");
  const first = lines.findIndex((l) => l.startsWith("|"));
  const rows = new Map<string, string[]>();
  for (const line of lines.slice(first + 2)) {
    if (!line.startsWith("|")) break;
    const cells = line.split("|").slice(1, -1).map((c) => c.replace(/\*\*/g, "").trim());
    rows.set(cells[0]!, cells.slice(1));
  }
  return rows;
}

/** Captures of `pattern` in the README; fails with the sentence to look for when it is gone. */
function sentence(pattern: RegExp): string[] {
  const m = pattern.exec(readme);
  assert.ok(m, `README no longer matches ${pattern}; recheck it against study-seasons.json and update this test`);
  return m.slice(1);
}

describe("README study numbers match src/data/study-seasons.json", () => {
  it("publishes one row per season, the pool and the shipped slate", () => {
    const rows = table("## Result");
    const expected: [string, StudyRunSummary][] = [
      ...study.seasons.map((s): [string, StudyRunSummary] => [`${s.season} (${s.role})`, s.summary]),
      [`Pooled ${pool!.seasons[0]}–${pool!.seasons.at(-1)}`, pool!.summary],
      [`${shipped!.season} shipped slate (${shipped!.universe.lookAhead ? "look-ahead" : "clean"})`, shipped!.summary],
    ];
    assert.deepEqual([...rows.keys()], expected.map(([label]) => label));
    for (const [label, summary] of expected) {
      const gap = exactOver(summary, GREEDY);
      assert.deepEqual(
        rows.get(label),
        [
          String(summary.commonWeeks.length),
          fix(mean(model(summary, BASELINE))),
          fix(mean(model(summary, GREEDY))),
          fix(mean(model(summary, VALUE))),
          `${signed(gap.mean)} (${signed(gap.low)} to ${signed(gap.high)})`,
          `${gap.exactWins}-${gap.exactLosses}-${gap.ties}`,
        ],
        label,
      );
    }
  });

  it("states the pooled gaps, the overshoot and the bias", () => {
    const s = pool!.summary;
    const stars = exactOver(s, VALUE);
    assert.deepEqual(
      sentence(/by ([\d.]+) points a week pooled \(range ([+−][\d.]+) to ([+−][\d.]+); (\d+) of (\d+) weeks\)/),
      [fix(stars.mean), signed(stars.low), signed(stars.high), String(stars.exactWins), String(s.commonWeeks.length)],
    );
    const greedy = exactOver(s, GREEDY);
    assert.deepEqual(sentence(/gains \*\*([+−]?[\d.]+) a week, and the range (includes|excludes) zero\*\*/), [
      signed(greedy.mean),
      greedy.low <= 0 && greedy.high >= 0 ? "includes" : "excludes",
    ]);

    const trail = model(s, BASELINE);
    assert.deepEqual(sentence(/projection averaged (\d+\.\d) and it scored (\d+\.\d)/), [fix(trail.lineupProjMean!), fix(mean(trail))]);
    const over = (weekly: { lineups: Record<string, { proj: number; actual: number | null } | undefined> }[]) =>
      weekly.filter((w) => {
        const l = w.lineups[BASELINE];
        return l != null && l.actual != null && l.proj > l.actual;
      }).length;
    const allWeeks = study.seasons.flatMap((x) => x.weekly);
    assert.deepEqual(sentence(/too high in (\d+) of (\d+) weeks \((\d+) of (\d+) on the shipped slate\)/), [
      String(over(allWeeks)),
      String(allWeeks.length),
      String(over(shipped!.weekly)),
      String(shipped!.weekly.length),
    ]);
    assert.deepEqual(sentence(/unbiased \(([+−][\d.]+) points over ([\d,]+) player-weeks\)/), [
      signed(trail.playerError!.bias!, 2),
      thousands(trail.playerError!.n),
    ]);
    assert.equal(
      study.seasons.every((x) => x.summary.excludedWeeks.length === 0),
      /No week was dropped\./.test(readme),
      "README says no week was dropped exactly when none was",
    );
  });

  it("states the QB lag correlations per season", () => {
    const [last, mid, first] = study.seasons.slice().reverse().map((x) => x.qbLag!);
    const [lastSeason, midSeason, firstSeason] = study.seasons.map((x) => x.season).reverse();
    assert.deepEqual(
      sentence(/r = (\d\.\d+)\*\* \((\d{4}), (\d+) pairs\), (\d\.\d+) \((\d{4}), (\d+)\), (\d\.\d+) \((\d{4}), (\d+)\)\. CPOE \*\*r = (\d\.\d+)\*\*, (\d\.\d+), (\d\.\d+)/),
      [last, mid, first].flatMap((q, i) => [String(q!.corrEpa), String([lastSeason, midSeason, firstSeason][i]), String(q!.n)]).concat(
        [last, mid, first].map((q) => String(q!.corrCpoe)),
      ),
    );
  });

  it("publishes the projection table for the pool", () => {
    const s = pool!.summary;
    const projections = study.models.filter((m) => m.id !== GREEDY && m.id !== VALUE);
    const [count, weeks, playerWeeks] = sentence(/(\w+) causal projections, same pools, pooled [\d–]+ \((\d+) weeks, ([\d,]+) player-weeks\)/);
    assert.equal(count, ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"][projections.length]);
    assert.equal(weeks, String(s.commonWeeks.length));
    assert.equal(playerWeeks, thousands(model(s, BASELINE).playerError!.n));

    const rows = table("causal projections, same pools");
    const expected = projections
      .map((spec) => ({ spec, m: model(s, spec.id) }))
      .sort((a, b) => mean(b.m) - mean(a.m));
    assert.deepEqual([...rows.keys()], expected.map((e) => e.spec.label));
    for (const { spec, m } of expected) {
      const vs = spec.id === BASELINE ? "—" : (() => {
        const p = paired(s, spec.id);
        return `${signed(p.meanDiff)} (${signed(p.interval!.low)} to ${signed(p.interval!.high)})`;
      })();
      assert.deepEqual(rows.get(spec.label), [m.playerError!.mae!.toFixed(2), fix(mean(m)), vs], spec.label);
    }
  });

  it("states the per-season and shipped-slate model results", () => {
    const shrinkShipped = model(shipped!.summary, "shrink").playerError!.mae!;
    assert.deepEqual(sentence(/on the shipped slate \(([\d.]+) there\)/), [shrinkShipped.toFixed(2)]);
    assert.deepEqual(
      sentence(/beat the trailing mean in all three seasons \(([+−][\d.]+), ([+−][\d.]+), ([+−][\d.]+) a week\)/),
      study.seasons.map((x) => signed(paired(x.summary, "ewma").meanDiff)),
    );
    assert.ok(study.seasons.every((x) => paired(x.summary, "ewma").meanDiff > 0), "EWMA beat the trailing mean in every season");
    assert.deepEqual(sentence(/it lost \(([\d.]+) vs ([\d.]+)\)/), [
      fix(mean(model(shipped!.summary, "ewma"))),
      fix(mean(model(shipped!.summary, BASELINE))),
    ]);
    assert.deepEqual(sentence(/Opponent-adjust\*\*: ([\d.]+) pooled, ([\d.]+) on the shipped slate/), [
      fix(mean(model(pool!.summary, "opp"))),
      fix(mean(model(shipped!.summary, "opp"))),
    ]);
    assert.deepEqual(sentence(/\(([\d,]+) resamples, seed (\d+)\)/), [thousands(study.uncertainty.resamples), String(study.uncertainty.seed)]);
  });
});
