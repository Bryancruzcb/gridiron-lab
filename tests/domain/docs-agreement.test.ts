// Checks the study docs against committed files: src/data/study-seasons.json, src/data/study-ewma.json,
// src/data/fantasy.json and docs/study/study-facts.json.
// README: every number in the "Result" and "What failed" sections is recomputed, and the last README
// check fails on any number in those sections, outside code spans, that no assertion read, apart from
// the phrases in NOT_STUDY_NUMBERS. Counts that come only from one-time replays of the old scripts
// belong in docs/study/REGENERATION_REPORT.md instead.
// Regeneration report: the computer-vs-greedy, models-by-run, slates and EWMA sweep tables and the list
// of ranges that exclude zero are rendered from those files and must appear verbatim.
// When a sentence or table is reworded on purpose, update the matching pattern or renderer here.

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
  { phrase: "an exact $50k optimizer", reason: "retired synthetic-cap framing, not a claimed result" },
  { phrase: "Do not put a $50k cap", reason: "negative claim language, not a study result" },
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
  it("names the seasons, weeks, pools, refs and roles", () => {
    const [first, last, from, to] = sentence(/## Result \((\d{4})–(\d{4}), weeks (\d+)–(\d+)\)/);
    assert.deepEqual([first, last], [String(study.seasons[0]!.season), String(study.seasons.at(-1)!.season)]);
    for (const s of [...study.seasons, shipped!]) assert.deepEqual([String(s.weeks.from), String(s.weeks.to)], [from, to], String(s.season));
    const [players] = sentence(/own (\d+)-player pool/);
    assert.ok(study.seasons.every((s) => String(s.universe.players) === players), "every season pool has that many players");
    assert.ok(/salary bands from that rule are not used in this pitch/i.test(section), "README disclaims synthetic salary bands");
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

  it("does not publish a salary-cap Exact / greedy Result table", () => {
    assert.ok(!/\| Exact \|/.test(section), "no Exact column in Result");
    assert.ok(!/Pts\/\$ greedy/.test(section), "no Pts/$ column in Result");
  });

  it("states the trailing-mean bias (no salary-cap gaps)", () => {
    const trail = model(pool!.summary, BASELINE);
    assert.ok(!/beats cheap points-per-dollar/.test(section), "README does not claim points-per-dollar results");
    assert.ok(!/exact lineup's pregame projection/i.test(section), "README does not lead with cap-lineup overshoot");
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
    const [count, first, last, weeks, playerWeeks] = sentence(/(\w+) projection methods \(same pools, no future data\), pooled (\d{4})–(\d{4}) \((\d+) weeks, ([\d,]+) player-weeks\)/);
    assert.equal(count, capital(word(projections.length)));
    assert.deepEqual([first, last], [String(pool!.seasons[0]), String(pool!.seasons.at(-1))]);
    assert.equal(weeks, String(s.commonWeeks.length));
    assert.equal(playerWeeks, thousands(model(s, BASELINE).playerError.n));

    const rows = table("projection methods (same pools, no future data), pooled");
    const expected = projections.map((spec) => ({ spec, m: model(s, spec.id) })).sort((a, b) => a.m.playerError.mae! - b.m.playerError.mae!);
    assert.deepEqual([...rows.keys()], expected.map((e) => e.spec.label));
    const best = expected[0]!;
    for (const { spec, m } of expected) {
      const row = rows.get(spec.label)!;
      assert.deepEqual(row.values, [m.playerError.mae!.toFixed(2)], spec.label);
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
    assert.deepEqual(sentence(/on the shipped slate \((\d\.\d\d) there\)\. Trailing mean is second everywhere\./), [
      model(shipped!.summary, "shrink").playerError.mae!.toFixed(2),
    ]);

    const ewma = model(pool!.summary, "ewma");
    const trail = model(pool!.summary, BASELINE);
    assert.ok(ewma.playerError.mae! > trail.playerError.mae!, "EWMA is worse than trailing mean on pooled player MAE");
    const ewmaSpec = study.models.find((m) => m.id === "ewma")!;
    assert.deepEqual(
      sentence(/\*\*EWMA α=([\d.]+)\*\* is \*\*not\*\* better than trailing mean on player MAE \(([\d.]+) vs ([\d.]+) pooled\)/),
      [Number(ewmaSpec.params.alpha).toFixed(2), ewma.playerError.mae!.toFixed(2), trail.playerError.mae!.toFixed(2)],
    );
    const development = seasonsOf("development");
    assert.deepEqual(sentence(/default carried over from the first (\d{4}) scripts, not tuned on (\d{4})–(\d{4})\./), [
      ...seasonsOf("retrospective"),
      development[0]!,
      development.at(-1)!,
    ]);

    const sweeps = facts.sweeps.filter((x) => x.seasons.length === 1);
    assert.deepEqual(sweeps.map((x) => x.seasons[0]), study.seasons.map((x) => x.season));
    assert.deepEqual(
      sentence(/the best α was (\d\.\d\d) in (\d{4}), (\d\.\d\d) in (\d{4}), (\d\.\d\d) in (\d{4}) and (\d\.\d\d) on the shipped slate\. Do not fit α on (\d+) weeks/),
      [...sweeps.flatMap((x) => [x.best.alpha.toFixed(2), String(x.seasons[0])]), ewmaFile.bestLineup.alpha.toFixed(2), String(shipped!.summary.commonWeeks.length)],
    );

    const opp = study.models.find((m) => m.method === "opp")!;
    assert.equal(opp.definition, "opp@2");
    const oppMae = model(pool!.summary, "opp").playerError.mae!;
    const [low, high, oppMaeS, trailMaeS, floor] = sentence(
      /\*\*Opponent-adjust\*\* scales the trailing mean by what the opponent allowed at the position over what every opponent allowed, from the same rows, clamped to (\d\.\d)–(\d\.\d)\. Player MAE is ([\d.]+) pooled \(worse than trailing mean's ([\d.]+)\)\. The first version divided by the pool's own position mean instead, so most skill players sat at the (\d\.\d) floor/,
    );
    assert.deepEqual(
      [low, high, oppMaeS, trailMaeS, floor],
      [opp.params.clampLow!.toFixed(1), opp.params.clampHigh!.toFixed(1), oppMae.toFixed(2), trail.playerError.mae!.toFixed(2), opp.params.clampLow!.toFixed(1)],
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

describe("docs/study/REGENERATION_REPORT.md tables match the committed study files", () => {
  const report = readFileSync(new URL("../../docs/study/REGENERATION_REPORT.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const runs = [
    ...study.seasons.map((s) => ({ label: `${s.season} ${s.role}`, id: `\`${s.runId}\``, summary: s.summary })),
    ...study.pools.map((p) => ({ label: `pooled ${p.seasons.join("+")}`, id: `\`${p.resultSha256.slice(0, 12)}…\``, summary: p.summary })),
    { label: `${shipped!.season} shipped slate`, id: `\`${shipped!.runId}\``, summary: shipped!.summary },
  ];
  const range = (p: { meanDiff: number; interval: { low: number; high: number } }) =>
    `${signed(p.meanDiff)} [${signed(p.interval.low)}, ${signed(p.interval.high)}]`;
  const block = (lines: string[]) => lines.join("\n");
  const has = (text: string, what: string) => assert.ok(report.includes(text), `the report's ${what} no longer matches the study files:\n${text}`);

  it("has the computer-vs-greedy table", () => {
    const rows = runs.map(({ label, summary }) => {
      const t = model(summary, BASELINE);
      const greedy = paired(summary, GREEDY);
      const cheap = exactOver(summary, VALUE);
      const g = exactOver(summary, GREEDY);
      return `| ${label} | ${summary.commonWeeks.length} | ${fix(mean(t))} (${fix(t.lineupActualMedian!)}) | ${fix(t.lineupProjMean!)} | ${fix(mean(model(summary, GREEDY)))} | ${fix(mean(model(summary, VALUE)))} | ${signed(g.mean)}, ${signed(-greedy.medianDiff!)} [${signed(g.low)}, ${signed(g.high)}], ${g.exactWins}-${g.exactLosses}-${g.ties} | ${signed(cheap.mean)} [${signed(cheap.low)}, ${signed(cheap.high)}], ${cheap.exactWins}-${cheap.exactLosses}-${cheap.ties} |`;
    });
    has(block([
      "| Run | Weeks | Computer mean (median) | Computer projected | Top names | Cheap picks | Computer − top names: mean, median [95%], W-L-T | Computer − cheap: mean [95%], W-L-T |",
      "|---|---|---|---|---|---|---|---|",
      ...rows,
    ]), "computer-vs-greedy table");
  });

  it("has one models table per run", () => {
    for (const { label, id, summary } of runs) {
      const rows = summary.models.map((m) => {
        const vs = m.model === BASELINE ? "baseline" : (() => {
          const p = paired(summary, m.model);
          return `${range(p)}, ${p.wins}-${p.losses}-${p.ties}`;
        })();
        const e = m.playerError;
        return `| ${m.label} | ${m.solver} | ${fix(mean(m))} | ${fix(m.lineupActualMedian!)} | ${fix(m.lineupProjMean!)} | ${e.mae!.toFixed(2)} | ${e.rmse!.toFixed(2)} | ${signed(e.bias!, 2)} | ${e.n} | ${vs} |`;
      });
      has(block([
        `#### ${label} (${id})`,
        "",
        "| Model | Solver | Lineup mean | Median | Projected | MAE | RMSE | Bias | n | Model − trail: mean [95%], W-L-T |",
        "|---|---|---|---|---|---|---|---|---|---|",
        ...rows,
      ]), `${label} models table`);
    }
  });

  it("lists the ranges against the trailing mean that exclude zero", () => {
    for (const { label, summary } of runs) assert.ok(paired(summary, VALUE).interval.high < 0, `${label}: points-per-dollar greedy is below zero`);
    const lines = runs.map(({ label, summary }) => {
      const excluded = summary.models
        .filter((m) => m.model !== BASELINE && m.model !== VALUE)
        .map((m) => ({ m, p: paired(summary, m.model) }))
        .filter(({ p }) => !includesZero(p))
        .map(({ m, p }) => `${m.label} ${range(p)}`);
      return `  - ${label}: ${excluded.join("; ") || "none"}`;
    });
    has(`Points-per-dollar greedy is below zero in every run and is left out:\n\n${block(lines)}\n`, "list of ranges that exclude zero");
  });

  it("has the slates table", () => {
    const rows = [...facts.runs, facts.shippedSlate!].map((f) => {
      const statuses = Object.entries(f.slateStatuses).map(([k, v]) => `${k} ${v}`).join(", ");
      const solver = Object.entries(f.solverRecords).map(([k, v]) => `${k} ${v}`).join(", ");
      return `| ${f.season} ${f.universe.lookAhead ? "shipped slate" : f.role} | ${f.universe.id} (\`${f.universe.sha256.slice(0, 12)}\`) | ${f.slateSize!.min}–${f.slateSize!.max} | ${f.offSlate.bye} / ${f.offSlate["no-history"]} / ${f.offSlate["unknown-identity"]} | ${statuses} | ${f.baselineInactiveSlots} | ${solver} | ${f.excludedWeeks || "none"} |`;
    });
    has(block([
      "| Run | Universe (sha256) | Slate size | Off slate: bye / no history / unknown id | Slate statuses | Inactive slots in trailing-mean lineups | Solver records | Excluded weeks |",
      "|---|---|---|---|---|---|---|---|",
      ...rows,
    ]), "slates table");
  });

  it("has the EWMA sweep table", () => {
    const sweeps = facts.sweeps;
    for (const s of sweeps) assert.deepEqual(s.points.map((p) => p.alpha), ewmaFile.points.map((p) => p.alpha));
    const head = sweeps.map((s) => (s.seasons.length > 1 ? `Pooled ${s.seasons[0]}–${s.seasons.at(-1)}` : String(s.seasons[0])));
    has(block([
      `| Model | ${head.join(" | ")} | ${ewmaFile.season} shipped slate |`,
      `|---|${sweeps.map(() => "---|").join("")}---|`,
      `| trail | ${sweeps.map((s) => fix(s.baseline.lineupMean)).join(" | ")} | ${fix(ewmaFile.trail.lineupMean)} |`,
      ...ewmaFile.points.map((p, i) => `| ewma-${p.alpha.toFixed(2)} | ${sweeps.map((s) => fix(s.points[i]!.lineupMean)).join(" | ")} | ${fix(p.lineupMean)} |`),
    ]), "EWMA sweep table");
  });
});
