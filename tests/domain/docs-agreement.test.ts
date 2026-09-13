// Every number in the README's "Result" and "What failed" sections is recomputed here from committed
// files: src/data/study-seasons.json, src/data/study-ewma.json, src/data/fantasy.json and
// docs/study/study-facts.json. The last check fails on any number in those sections, outside code
// spans, that no assertion read, apart from the phrases in NOT_STUDY_NUMBERS. Counts that come only
// from one-time replays of the old scripts belong in docs/study/REGENERATION_REPORT.md instead.
// When a README sentence is reworded on purpose, update the matching pattern here.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type {
  EwmaFile,
  StudyFactsFile,
  StudyModelSummary,
  StudyPairedComparison,
  StudyRunSummary,
  StudySeasonsFile,
} from "../../src/data/types.ts";

const read = <T>(path: string) => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")) as T;
const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const study = read<StudySeasonsFile>("src/data/study-seasons.json");
const ewmaFile = read<EwmaFile>("src/data/study-ewma.json");
const facts = read<StudyFactsFile>("docs/study/study-facts.json");
const fantasy = read<{ season: number; players: { id: string; ppg: number; recencyPpg: number; proj: number }[] }>("src/data/fantasy.json");

const BASELINE = "trail";
const GREEDY = "trail-greedy-proj";
const VALUE = "trail-greedy-value";
const MINUS = "−";

/** Numbers in the study sections that are not study results. */
const NOT_STUDY_NUMBERS: { phrase: string; reason: string }[] = [
  { phrase: "Week 1 2026 is a thin sample", reason: "the live labs' current season, not a study result" },
];

const pool = study.pools.find((p) => p.seasons.length === study.seasons.length);
const shipped = study.shippedSlate;
assert.ok(pool && shipped, "study-seasons.json has an all-season pool and the shipped slate");

const START = readme.indexOf("## Result");
const END = readme.indexOf("## Labs");
assert.ok(START >= 0 && END > START, "README has a Result section before Labs");
const section = readme.slice(START, END);

/** README spans (absolute offsets) whose numbers an assertion has checked. */
const covered: [number, number][] = [];

const fix = (x: number, digits = 1) => Math.abs(x).toFixed(digits);
/** README style: +3.5, −10.2, and 0.0 without a sign. */
function signed(x: number, digits = 1): string {
  const s = fix(x, digits);
  if (Number(s) === 0) return s;
  return `${x > 0 ? "+" : MINUS}${s}`;
}
const thousands = (n: number) => n.toLocaleString("en-US");
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const word = (n: number) => WORDS[n]!;
const capital = (s: string) => s[0]!.toUpperCase() + s.slice(1);

function model(summary: StudyRunSummary, id: string): StudyModelSummary {
  const m = summary.models.find((x) => x.model === id);
  assert.ok(m, `model ${id} in study-seasons.json`);
  return m;
}
function paired(summary: StudyRunSummary, id: string): StudyPairedComparison & { meanDiff: number; interval: { low: number; high: number } } {
  const p = summary.paired.find((x) => x.model === id && x.baseline === BASELINE);
  assert.ok(p && p.meanDiff != null && p.interval, `paired ${id} vs ${BASELINE} in study-seasons.json`);
  return p as StudyPairedComparison & { meanDiff: number; interval: { low: number; high: number } };
}
const mean = (m: StudyModelSummary) => {
  assert.ok(m.lineupActualMean != null, `${m.model} has a lineup mean`);
  return m.lineupActualMean;
};
const includesZero = (p: { interval: { low: number; high: number } }) => p.interval.low <= 0 && p.interval.high >= 0;
/** The exact solver's gain over a method: the negated paired difference, range flipped. */
function exactOver(summary: StudyRunSummary, id: string) {
  const p = paired(summary, id);
  return { mean: -p.meanDiff, low: -p.interval.high, high: -p.interval.low, exactWins: p.losses, exactLosses: p.wins, ties: p.ties };
}

/** Captures of the first match of `pattern` in the study sections; their spans count as checked. */
function sentence(pattern: RegExp): string[] {
  const m = new RegExp(pattern.source, "d").exec(section);
  assert.ok(m, `README no longer matches ${pattern}; recheck it against the study files and update this test`);
  for (const span of m.indices!.slice(1)) if (span) covered.push([START + span[0], START + span[1]]);
  return m.slice(1);
}

/** Captures of every match of `pattern` in the study sections. */
function every(pattern: RegExp): string[][] {
  const matches = [...section.matchAll(new RegExp(pattern.source, "dg"))];
  assert.ok(matches.length, `README no longer matches ${pattern}`);
  return matches.map((m) => {
    for (const span of m.indices!.slice(1)) if (span) covered.push([START + span[0], START + span[1]]);
    return m.slice(1);
  });
}

/** Rows of the first Markdown table after `heading`, keyed by the first cell with bold removed. */
function table(after: string): Map<string, { values: string[]; span: [number, number] }> {
  const start = readme.indexOf(after, START);
  assert.ok(start >= 0 && start < END, `README still has "${after}"`);
  const lines: { text: string; at: number }[] = [];
  let at = readme.indexOf("\n|", start) + 1;
  while (readme.startsWith("|", at)) {
    const end = readme.indexOf("\n", at);
    lines.push({ text: readme.slice(at, end), at });
    at = end + 1;
  }
  return new Map(
    lines.slice(2).map((l) => {
      const cells = l.text.split("|").slice(1, -1).map((c) => c.replace(/\*\*/g, "").trim());
      return [cells[0]!, { values: cells.slice(1), span: [l.at, l.at + l.text.length] }];
    }),
  );
}

const seasonsOf = (role: string) => study.seasons.filter((s) => s.role === role).map((s) => String(s.season));

describe("README study numbers match the committed study files", () => {
  it("names the seasons, weeks, pools, cap, refs and roles", () => {
    const [first, last, from, to] = sentence(/## Result \((\d{4})–(\d{4}), weeks (\d+)–(\d+)\)/);
    assert.deepEqual([first, last], [String(study.seasons[0]!.season), String(study.seasons.at(-1)!.season)]);
    for (const s of [...study.seasons, shipped!]) assert.deepEqual([String(s.weeks.from), String(s.weeks.to)], [from, to], String(s.season));
    const [players] = sentence(/own (\d+)-player pool/);
    assert.ok(study.seasons.every((s) => String(s.universe.players) === players), "every season pool has that many players");
    const [capK] = sentence(/best \$(\d+)k lineup/);
    assert.ok([...study.seasons, shipped!].every((s) => s.cap === Number(capK) * 1000), "every run has that cap");
    assert.ok(section.includes(`(\`${study.seasons[0]!.universe.rule}\`)`) && section.includes(`(\`${study.scoring}\`, a simplified`));
    assert.deepEqual(sentence(/(\d{4}) and (\d{4}) ran first and nothing was tuned on them/), seasonsOf("development"));
    assert.deepEqual(sentence(/(\d{4}) is \*\*retrospective\*\*, not a holdout/), seasonsOf("retrospective"));
    assert.equal(
      study.seasons.every((x) => x.summary.excludedWeeks.length === 0),
      /No week was dropped\./.test(section),
      "README says no week was dropped exactly when none was",
    );
    for (const [level] of every(/(\d+)% range/)) assert.equal(Number(level), study.uncertainty.level * 100);
  });

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
      const row = rows.get(label)!;
      assert.deepEqual(
        row.values,
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
      covered.push(row.span);
    }
  });

  it("states the pooled gaps, the overshoot and the bias", () => {
    const s = pool!.summary;
    const cheap = exactOver(s, VALUE);
    assert.deepEqual(
      sentence(/beats cheap points-per-dollar picks by ([\d.]+) points a week pooled \(range ([+−][\d.]+) to ([+−][\d.]+); (\d+) of (\d+) weeks\)/),
      [fix(cheap.mean), signed(cheap.low), signed(cheap.high), String(cheap.exactWins), String(s.commonWeeks.length)],
    );
    const greedy = exactOver(s, GREEDY);
    assert.ok(greedy.low <= 0 && greedy.high >= 0, "the pooled exact-vs-greedy range includes zero");
    assert.deepEqual(sentence(/gains \*\*([+−]?[\d.]+) a week, and the range includes zero\*\*: (\d+) weeks cannot tell them apart/), [
      signed(greedy.mean),
      String(s.commonWeeks.length),
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
      signed(trail.playerError.bias!, 2),
      thousands(trail.playerError.n),
    ]);
  });

  it("states the QB lag correlations per season", () => {
    const [minAttempts] = sentence(/QB, ≥(\d+) attempts/);
    assert.ok(study.seasons.every((x) => String(x.qbLag!.minAttempts) === minAttempts));
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
    const [count, first, last, weeks, playerWeeks] = sentence(/(\w+) causal projections, same pools, pooled (\d{4})–(\d{4}) \((\d+) weeks, ([\d,]+) player-weeks\)/);
    assert.equal(count, capital(word(projections.length)));
    assert.deepEqual([first, last], [String(pool!.seasons[0]), String(pool!.seasons.at(-1))]);
    assert.equal(weeks, String(s.commonWeeks.length));
    assert.equal(playerWeeks, thousands(model(s, BASELINE).playerError.n));

    const rows = table("causal projections, same pools");
    const expected = projections.map((spec) => ({ spec, m: model(s, spec.id) })).sort((a, b) => mean(b.m) - mean(a.m));
    assert.deepEqual([...rows.keys()], expected.map((e) => e.spec.label));
    const best = [...expected].sort((a, b) => a.m.playerError.mae! - b.m.playerError.mae!)[0]!;
    for (const { spec, m } of expected) {
      const vs = spec.id === BASELINE ? "—" : (() => {
        const p = paired(s, spec.id);
        return `${signed(p.meanDiff)} (${signed(p.interval.low)} to ${signed(p.interval.high)})`;
      })();
      const row = rows.get(spec.label)!;
      assert.deepEqual(row.values, [m.playerError.mae!.toFixed(2), fix(mean(m)), vs], spec.label);
      assert.equal(readme.slice(...row.span).includes(`**${m.playerError.mae!.toFixed(2)}**`), spec.id === best.spec.id, `${spec.label}: only the best MAE is bold`);
      covered.push(row.span);
    }
  });

  it("states the shrinkage, EWMA and opponent findings", () => {
    const runs: [string, StudyRunSummary][] = [...study.seasons.map((x): [string, StudyRunSummary] => [String(x.season), x.summary]), ["shipped", shipped!.summary]];
    for (const [label, summary] of runs) {
      const byMae = summary.models.filter((m) => m.solver === "exact-dp").sort((a, b) => a.playerError.mae! - b.playerError.mae!);
      assert.deepEqual(byMae.slice(0, 2).map((m) => m.model), ["shrink", BASELINE], `${label}: shrink first and trailing mean second by player MAE`);
    }
    assert.deepEqual(sentence(/on the shipped slate \((\d\.\d\d) there\)\. Trailing mean is second everywhere\. Shrinkage lineups score about the same/), [
      model(shipped!.summary, "shrink").playerError.mae!.toFixed(2),
    ]);
    assert.ok(includesZero(paired(pool!.summary, "shrink")), "pooled shrink vs trailing mean includes zero");

    const ewmaSpec = study.models.find((m) => m.id === "ewma")!;
    const [label, seasons, ...gains] = sentence(/\*\*(EWMA α=[\d.]+)\*\* beat the trailing mean in all (\w+) seasons \(([+−][\d.]+), ([+−][\d.]+), ([+−][\d.]+) a week\)/);
    assert.deepEqual([label, seasons], [ewmaSpec.label, word(study.seasons.length)]);
    assert.deepEqual(gains, study.seasons.map((x) => signed(paired(x.summary, "ewma").meanDiff)));
    assert.ok(study.seasons.every((x) => paired(x.summary, "ewma").meanDiff > 0), "EWMA beat the trailing mean in every season");
    const development = seasonsOf("development");
    assert.deepEqual(sentence(/default carried over from the first (\d{4}) scripts, not tuned on (\d{4})–(\d{4})\. On the shipped (\d{4}) slate it lost \(([\d.]+) vs ([\d.]+)\)/), [
      ...seasonsOf("retrospective"),
      development[0]!,
      development.at(-1)!,
      String(shipped!.season),
      fix(mean(model(shipped!.summary, "ewma"))),
      fix(mean(model(shipped!.summary, BASELINE))),
    ]);
    assert.ok(mean(model(shipped!.summary, "ewma")) < mean(model(shipped!.summary, BASELINE)), "EWMA lost on the shipped slate");

    const sweeps = facts.sweeps.filter((x) => x.seasons.length === 1);
    assert.deepEqual(sweeps.map((x) => x.seasons[0]), study.seasons.map((x) => x.season));
    assert.deepEqual(
      sentence(/the best α was (\d\.\d\d) in (\d{4}), (\d\.\d\d) in (\d{4}), (\d\.\d\d) in (\d{4}) and (\d\.\d\d) on the shipped slate\. Do not fit α on (\d+) weeks/),
      [...sweeps.flatMap((x) => [x.best.alpha.toFixed(2), String(x.seasons[0])]), ewmaFile.bestLineup.alpha.toFixed(2), String(shipped!.summary.commonWeeks.length)],
    );
    assert.ok(study.seasons.every((x) => x.summary.commonWeeks.length === shipped!.summary.commonWeeks.length), "every season has as many weeks as the shipped slate");

    const opp = study.models.find((m) => m.method === "opp")!;
    assert.equal(opp.definition, "opp@2");
    const [low, high, gain, from, to, pooled, onShipped, floor] = sentence(
      /\*\*Opponent-adjust\*\* scales the trailing mean by what the opponent allowed at the position over what every opponent allowed, from the same rows, clamped to (\d\.\d)–(\d\.\d)\. It gains ([+−][\d.]+) a week pooled \(range ([+−][\d.]+) to ([+−][\d.]+)\) and scores ([\d.]+); on the shipped slate it scores ([\d.]+)\. The first version divided by the pool's own position mean instead, so most skill players sat at the (\d\.\d) floor/,
    );
    const oppGap = paired(pool!.summary, "opp");
    assert.deepEqual(
      [low, high, gain, from, to, pooled, onShipped, floor],
      [opp.params.clampLow!.toFixed(1), opp.params.clampHigh!.toFixed(1), signed(oppGap.meanDiff), signed(oppGap.interval.low), signed(oppGap.interval.high), fix(mean(model(pool!.summary, "opp"))), fix(mean(model(shipped!.summary, "opp"))), opp.params.clampLow!.toFixed(1)],
    );
    assert.deepEqual(sentence(/\((\d[\d,]*) resamples, seed (\d+)\)/), [thousands(study.uncertainty.resamples), String(study.uncertainty.seed)]);
  });

  it("states the What failed counts", () => {
    const [players, season, fullSeason, seasonShare, lateShare] = sentence(
      /The shipped (\d+)-player (\d{4}) slate is look-ahead\.\*\* Every offensive player's games, PPG and season points in `src\/data\/fantasy\.json` match the full (\d{4}) regular season\. Its projection is (\d+)% season PPG \+ (\d+)% late-season PPG/,
    );
    assert.equal(shipped!.universe.lookAhead, true);
    assert.deepEqual([players, season, fullSeason], [String(shipped!.universe.players), String(shipped!.season), String(fantasy.season)]);
    assert.equal(fantasy.players.length, shipped!.universe.players);
    const [a, b] = [Number(seasonShare) / 100, Number(lateShare) / 100];
    for (const p of fantasy.players) assert.ok(Math.abs(p.proj - (a * p.ppg + b * p.recencyPpg)) < 0.01, `${p.id}: proj is ${seasonShare}/${lateShare} of season and late-season PPG`);

    const overlap = facts.universeOverlap!;
    assert.deepEqual([overlap.shipped.sha256, overlap.clean.sha256], [shipped!.universe.sha256, study.seasons.find((x) => x.season === shipped!.season)!.universe.sha256]);
    assert.deepEqual(sentence(/Only (\d+) of its (\d+) players are in the clean (\d{4}) pool/), [String(overlap.shared), String(overlap.shipped.players), String(overlap.season)]);

    const [zero] = sentence(/A player with no stat row in a final game counts (\d+)\./);
    assert.ok(
      study.policies.some((p) => p.includes(`inactive = final game, source covers the week, no row: ${zero} in a lineup`)),
      "the run policy scores an inactive player that way",
    );
    const inactive = facts.pooledBaselineInactiveSlots;
    assert.deepEqual(inactive.seasons, study.seasons.map((x) => x.season));
    assert.deepEqual(sentence(/Trailing-mean lineups used (\d+) such slots over the (\d+) weeks/), [String(inactive.slots), String(inactive.commonWeeks)]);

    const [count, examined] = sentence(/(\w+) seasons is still a small sample, and (\d{4}) was examined before/);
    assert.deepEqual([count, [examined]], [capital(word(study.seasons.length)), seasonsOf("retrospective")]);
  });

  it("reads the facts file from the same runs as the page file", () => {
    assert.deepEqual(facts.runs.map((r) => [r.runId, r.resultSha256]), study.seasons.map((s) => [s.runId, s.resultSha256]));
    assert.deepEqual([facts.shippedSlate!.runId, facts.shippedSlate!.resultSha256], [shipped!.runId, shipped!.resultSha256]);
    assert.ok(facts.sweeps.every((x) => x.universeRule === study.seasons[0]!.universe.rule && x.baseline.model === BASELINE));
  });

  it("covers every number in the Result and What failed sections", () => {
    const code = [...readme.matchAll(/`[^`\n]*`/g)].map((m) => [m.index!, m.index! + m[0].length] as const);
    const allowed = NOT_STUDY_NUMBERS.flatMap(({ phrase }) => {
      const at = section.indexOf(phrase);
      assert.ok(at >= 0, `NOT_STUDY_NUMBERS phrase "${phrase}" is no longer in the README`);
      return [[START + at, START + at + phrase.length] as const];
    });
    const inside = (spans: readonly (readonly [number, number])[], a: number, b: number) => spans.some(([x, y]) => a >= x && b <= y);
    const unchecked: string[] = [];
    for (const m of section.matchAll(/\d+(?:,\d{3})*(?:\.\d+)?/g)) {
      const [a, b] = [START + m.index!, START + m.index! + m[0].length];
      if (inside(code, a, b) || inside(covered, a, b) || inside(allowed, a, b)) continue;
      const line = readme.slice(readme.lastIndexOf("\n", a) + 1, readme.indexOf("\n", a));
      unchecked.push(`${m[0]} in: ${line.slice(0, 120)}`);
    }
    assert.deepEqual(unchecked, [], "numbers in the README study sections that no check reads");
  });
});
