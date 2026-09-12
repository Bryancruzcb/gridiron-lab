import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildLineupExport,
  csvCell,
  CSV_COLUMNS,
  exportFilename,
  guardFormula,
  lineupCsv,
  lineupJson,
  lineupTotals,
  parseCsv,
  parseLineupExport,
  type LineupExport,
  type LineupExportInput,
} from "../../src/lib/analysis/export.ts";
import { RULESET_REF } from "../../src/lib/football/scoring.ts";
import { actualSlate, emptySelection, slateId } from "../../src/lib/lineup/selection.ts";
import { optimizeLineup, type SolveOk } from "../../src/lib/optimizer.ts";
import { realSlate } from "../domain/support/players.ts";

const slate = realSlate();
const pool = slate.players;
const SLATE = slateId(slate.season, pool, slate.cap);
const projections = new Map(pool.map((p) => [p.id, p.proj]));

function solved(players = pool): SolveOk {
  const r = optimizeLineup({ players, cap: slate.cap });
  if (r.status !== "ok") assert.fail(r.message);
  return r;
}

function inputFor(result: SolveOk, patch: Partial<LineupExportInput> = {}): LineupExportInput {
  const ids = result.lineup.slots.map((s) => s.player.id);
  // One actual at -2 checks that negative numbers are written as numbers, not guarded text.
  const actuals = new Map(ids.slice(1).map((id, i) => [id, i === 0 ? -2 : 7.35 + i * 1.1]));
  return {
    exportedAt: new Date("2026-09-12T18:30:05.123Z"),
    slate: SLATE,
    slateSeason: slate.season,
    cap: slate.cap,
    selection: { ...emptySelection(SLATE), locked: [ids[0]!].sort() },
    mode: "proj",
    result,
    fingerprint: "fp123",
    projections,
    actuals,
    actualsVersion: "av456",
    partialIds: new Set([ids[1]!]),
    notFinalIds: new Set([ids[1]!, ids[2]!]),
    week: { season: 2026, seasonType: "REG", week: 1 },
    weekFeed: { source: "live", fetchedAt: "2026-09-11T12:00:00.000Z", partial: ["box score for BUF@MIA"], error: null },
    reopenPath: `/optimizer?slate=${SLATE}&lock=${ids[0]}`,
    savedName: null,
    ...patch,
  };
}

function recomputed(exp: LineupExport) {
  const rows = exp.slots;
  return {
    salary: rows.reduce((s, r) => s + r.salary, 0),
    projection: Math.round(rows.reduce((s, r) => s + r.projection, 0) * 100) / 100,
    actual: Math.round(rows.reduce((s, r) => s + (r.actual ?? 0), 0) * 100) / 100,
    scored: rows.filter((r) => r.actual !== null).length,
  };
}

describe("lineup JSON export", () => {
  it("records configuration, versions, solver and explicit slots, with totals from the rows", () => {
    const result = solved();
    const exp = buildLineupExport(inputFor(result));
    assert.equal(exp.schemaVersion, 1);
    assert.equal(exp.refs.ruleset, RULESET_REF);
    assert.equal(exp.dataVersion.slate, SLATE);
    assert.equal(exp.dataVersion.actualsVersion, "av456");
    assert.equal(exp.solver.method, "exact-dp");
    assert.equal(exp.solver.optimality, "proven");
    assert.equal(exp.solver.fallbackReason, null);
    assert.deepEqual(exp.slots.map((s) => s.slot), ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "DST"]);
    assert.deepEqual(exp.slots.map((s) => s.id), result.lineup.slots.map((s) => s.player.id));
    assert.deepEqual(exp.slots.map((s) => s.actualStatus), ["missing", "partial", "not-final", "complete", "complete", "complete", "complete", "complete", "complete"]);
    assert.equal(exp.slots[0]!.actual, null, "a missing actual is null, not zero");
    const sums = recomputed(exp);
    assert.equal(exp.totals.salary, sums.salary);
    assert.equal(exp.totals.salary, result.lineup.salary);
    assert.equal(exp.totals.projection, sums.projection);
    assert.equal(exp.totals.projection, Math.round(result.lineup.proj * 100) / 100);
    assert.equal(exp.totals.actual, sums.actual);
    assert.equal(exp.totals.scored, 8);
    assert.equal(exp.totals.missing, 1);

    const back = parseLineupExport(JSON.parse(lineupJson(exp)));
    assert.equal(back.ok, true, back.ok ? "" : back.message);
  });

  it("uses slate projections for a hindsight lineup, whose proj field holds actual points", () => {
    const actuals = new Map(pool.map((p, i) => [p.id, Math.round(p.proj * (0.3 + (i % 11) / 7) * 10) / 10]));
    const result = solved(actualSlate(pool, actuals));
    const exp = buildLineupExport(inputFor(result, { mode: "actual", actuals, partialIds: new Set(), notFinalIds: new Set() }));
    for (const row of exp.slots) {
      assert.equal(row.projection, projections.get(row.id));
      assert.equal(row.actual, actuals.get(row.id));
    }
    assert.equal(exp.totals.actual, Math.round(result.lineup.proj * 100) / 100);
  });

  it("rejects a document whose totals do not match its rows, or with a conflicting selection", () => {
    const exp = buildLineupExport(inputFor(solved()));
    const tampered = { ...exp, totals: { ...exp.totals, projection: exp.totals.projection + 1 } };
    assert.equal(parseLineupExport(tampered).ok, false);
    const conflicting = { ...exp, configuration: { ...exp.configuration, selection: { ...exp.configuration.selection, excluded: exp.configuration.selection.locked } } };
    assert.equal(parseLineupExport(conflicting).ok, false);
    assert.equal(parseLineupExport({ schema: "other" }).ok, false);
  });

  it("names files by mode and export time", () => {
    const exp = buildLineupExport(inputFor(solved()));
    assert.equal(exportFilename(exp, "csv"), "gridiron-lineup-proj-2026-09-12T183005Z.csv");
  });
});

describe("lineup CSV export", () => {
  it("quotes commas, quotes and line breaks per RFC 4180", () => {
    const values = ['Ja"Marr, Chase', "two\r\nlines", "lone\nnewline", "plain", ""];
    const line = values.map((v) => csvCell(v)).join(",");
    assert.equal(line, '"Ja""Marr, Chase","two\r\nlines","lone\nnewline",plain,');
    assert.deepEqual(parseCsv(`${line}\r\n`), [values]);
  });

  it("guards text that a spreadsheet would run as a formula, but never numbers", () => {
    for (const hostile of ["=1+1", "+1", "-1", "@SUM(A1)", "\tx", "\rx"]) assert.equal(guardFormula(hostile), `'${hostile}`);
    assert.equal(guardFormula("DST-BUF"), "DST-BUF");
    assert.equal(csvCell(-2.5), "-2.5");
    assert.equal(csvCell("-2.5"), "'-2.5");
    assert.equal(csvCell('=HYPERLINK("http://x","y")'), `"'=HYPERLINK(""http://x"",""y"")"`);
    assert.equal(csvCell(null), "");
    assert.equal(csvCell(Number.NaN), "");
  });

  it("writes metadata, an empty line, then slot rows whose sums equal the metadata totals", () => {
    const hostileName = '=HYPERLINK("http://evil.example","open"),\r\n@x';
    const base = inputFor(solved(), { savedName: hostileName });
    const renamed = base.result.lineup.slots.map((s, i) =>
      i === 3 ? { ...s, player: { ...s.player, name: 'O"Brien, Jr.\nIII' } } : s,
    );
    const exp = buildLineupExport({ ...base, result: { ...base.result, lineup: { ...base.result.lineup, slots: renamed } } });
    const text = lineupCsv(exp);
    assert.ok(text.endsWith("\r\n"));
    const records = parseCsv(text);
    const gap = records.findIndex((r) => r.length === 1 && r[0] === "");
    assert.ok(gap > 0, "an empty line separates the tables");
    assert.deepEqual(records[0], ["metadata", "value"]);
    const meta = new Map(records.slice(1, gap).map((r) => [r[0]!, r[1] ?? ""]));
    assert.equal(meta.get("saved_view_name"), `'${hostileName}`);
    assert.equal(meta.get("ruleset"), RULESET_REF);
    assert.equal(meta.get("actuals_version"), "av456");
    assert.equal(meta.get("slate"), SLATE);
    assert.deepEqual(records[gap + 1], [...CSV_COLUMNS]);
    const rows = records.slice(gap + 2);
    assert.equal(rows.length, 9);
    assert.ok(rows.every((r) => r.length === CSV_COLUMNS.length));
    assert.equal(rows[3]![2], 'O"Brien, Jr.\nIII');
    const col = (name: (typeof CSV_COLUMNS)[number]) => CSV_COLUMNS.indexOf(name);
    const sum = (name: (typeof CSV_COLUMNS)[number]) => rows.reduce((s, r) => s + (r[col(name)] === "" ? 0 : Number(r[col(name)])), 0);
    assert.equal(Number(meta.get("total_salary")), sum("salary"));
    assert.equal(Number(meta.get("total_projection")), Math.round(sum("projection") * 100) / 100);
    assert.equal(Number(meta.get("total_actual")), Math.round(sum("actual") * 100) / 100);
    assert.equal(Number(meta.get("actual_scored")), rows.filter((r) => r[col("actual")] !== "").length);
    assert.ok(rows.some((r) => r[col("actual")] === "-2"), "a negative actual stays numeric");
    assert.deepEqual(lineupTotals(exp.slots), exp.totals);
  });
});
