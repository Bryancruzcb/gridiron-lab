import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  CsvColumnError,
  CsvFormatError,
  CsvValueError,
  normalizeHeader,
  parseCsv,
  parseCsvLine,
  readCsv,
} from "../../src/lib/football/csv.ts";
import { parseCsvLine as liveParseCsvLine } from "../../src/lib/live/csv.ts";
import {
  defenseWeeks,
  nflverseSeasonType,
  parsePlayerWeeks,
  parseSchedule,
  parseTeamWeeks,
  pointsAllowed,
  teamPointsFromCounts,
} from "../../src/lib/football/nflverse.ts";

const fixture = (name: string) => readFileSync(new URL(`../fixtures/football/${name}`, import.meta.url), "utf8");
const PLAYERS = "stats_player_week_2025_sample.csv";
const TEAMS = "stats_team_week_2025_05_DET_CIN.csv";
const GAMES = "games_2025_05_DET_CIN.csv";

describe("CSV parsing", () => {
  it("handles quoted commas, doubled quotes, embedded newlines and CRLF", () => {
    const text = 'a,b,c\r\n"x, y","say ""hi""","line1\nline2"\n1,,\n';
    assert.deepEqual(parseCsv(text), [
      ["a", "b", "c"],
      ["x, y", 'say "hi"', "line1\nline2"],
      ["1", "", ""],
    ]);
  });

  it("strips a byte order mark, skips blank lines and needs no trailing newline", () => {
    assert.deepEqual(parseCsv("﻿h1,h2\n\nv1,v2"), [
      ["h1", "h2"],
      ["v1", "v2"],
    ]);
    assert.deepEqual(parseCsv('a,""'), [["a", ""]]);
  });

  it("keeps a quote inside an unquoted field as text and rejects an unterminated quote", () => {
    assert.deepEqual(parseCsv('a"b,c'), [['a"b', "c"]]);
    assert.throws(() => parseCsv('a,"b\n'), CsvFormatError);
  });

  it("keeps the single-line reader used by existing importers", () => {
    assert.equal(liveParseCsvLine, parseCsvLine);
    assert.deepEqual(parseCsvLine('x,"quoted, comma",3'), ["x", "quoted, comma", "3"]);
    assert.deepEqual(parseCsvLine('x,"unterminated,still'), ["x", "unterminated,still"]);
    assert.deepEqual(parseCsvLine(""), [""]);
  });

  it("normalizes headers and fails clearly on missing required columns", () => {
    assert.equal(normalizeHeader(" Player ID "), "player_id");
    assert.equal(normalizeHeader("Season-Type"), "season_type");
    const table = readCsv(" Player ID ,Week\nA1,3\n", ["player_id", "week"] as const, "demo");
    assert.equal(table.rows[0]!.text("player_id"), "A1");
    assert.equal(table.rows[0]!.num("week"), 3);

    assert.throws(
      () => readCsv("player_id\nA1\n", ["player_id", "week", "team"] as const, "demo"),
      (e: unknown) =>
        e instanceof CsvColumnError && /demo: missing required column\(s\): week, team/.test(e.message),
    );
  });

  it("types missing cells as null and rejects non-numeric text", () => {
    const table = readCsv("id,x\na,NA\nb,\nc,12.5\nd,abc\n", ["id", "x"] as const, "demo");
    assert.deepEqual(
      table.rows.slice(0, 3).map((r) => r.num("x")),
      [null, null, 12.5],
    );
    assert.equal(table.rows[0]!.text("x"), null);
    assert.throws(() => table.rows[3]!.num("x"), CsvValueError);
  });
});

describe("nflverse player week", () => {
  const parsed = parsePlayerWeeks(fixture(PLAYERS));
  const reference = readCsv(fixture(PLAYERS), ["player_id", "game_id", "fantasy_points_ppr", "fumbles_lost_total"] as const);
  const row = (name: string) => parsed.rows.find((r) => r.name === name)!;

  it("skips the row without a player id and keeps the rest", () => {
    assert.equal(parsed.rows.length, 17);
    assert.deepEqual(parsed.skipped, [{ line: 4, reason: "missing player_id, team, season or week" }]);
  });

  it("reproduces nflverse fantasy_points_ppr on every fixture row", () => {
    for (const r of parsed.rows) {
      const ref = reference.rows.find((x) => x.text("player_id") === r.playerId && x.text("game_id") === r.gameId)!;
      assert.deepEqual(r.score, { status: "complete", points: ref.num("fantasy_points_ppr") }, r.name);
    }
  });

  it("maps two-point conversions, special-teams touchdowns and scrimmage fumbles", () => {
    assert.equal(row("Adam Thielen").offense.twoPointConversions, 1);
    assert.equal(row("Rhamondre Stevenson").offense.twoPointConversions, 1);
    assert.equal(row("Malik Washington").offense.specialTeamsTds, 1);
    // DJ Moore lost a return fumble: fumbles_lost_total is 1, the scrimmage columns are 0.
    const moore = row("DJ Moore");
    const ref = reference.rows.find((x) => x.text("player_id") === moore.playerId && x.text("game_id") === moore.gameId)!;
    assert.equal(ref.num("fumbles_lost_total"), 1);
    assert.equal(moore.offense.fumblesLost, 0);
    assert.equal(row("Jared Goff").offense.fumblesLost, 1);
  });

  it("keys rows by season, season type and week", () => {
    const stafford = row("Matthew Stafford");
    assert.deepEqual([stafford.season, stafford.seasonType, stafford.week], [2025, "POST", 19]);
    const goff = row("Jared Goff");
    assert.deepEqual([goff.season, goff.seasonType, goff.week, goff.team, goff.gameId], [2025, "REG", 5, "DET", "2025_05_DET_CIN"]);
  });

  it("fails on a renamed column instead of scoring zeros", () => {
    const renamed = fixture(PLAYERS).replace(",passing_tds,", ",pass_tds,");
    assert.throws(() => parsePlayerWeeks(renamed), (e: unknown) => e instanceof CsvColumnError && e.missing.includes("passing_tds"));
  });

  it("reports an empty required count as missing, not zero", () => {
    const lines = fixture(PLAYERS).split(/\r?\n/);
    const header = parseCsvLine(lines[0]!);
    const goff = lines.find((l) => l.includes("Jared Goff"))!;
    const cells = parseCsvLine(goff);
    cells[header.indexOf("receptions")] = "NA";
    // headshot_url holds quoted commas in the real file, so re-quote on the way back out.
    const quoted = cells.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c));
    const parsedRow = parsePlayerWeeks(`${lines[0]}\n${quoted.join(",")}\n`).rows[0]!;
    assert.deepEqual(parsedRow.score, { status: "missing", missing: ["receptions"] });
  });

  it("maps season types and rejects unknown ones", () => {
    assert.equal(nflverseSeasonType("REG", "t"), "REG");
    for (const t of ["POST", "WC", "DIV", "CON", "SB"]) assert.equal(nflverseSeasonType(t, "t"), "POST");
    assert.throws(() => nflverseSeasonType("EXH", "t"), /unknown season type "EXH"/);
  });
});

describe("nflverse team week and schedule", () => {
  const teams = parseTeamWeeks(fixture(TEAMS)).rows;
  const games = parseSchedule(fixture(GAMES)).rows;
  const det = teams.find((t) => t.team === "DET")!;
  const cin = teams.find((t) => t.team === "CIN")!;

  it("reads giveaways and defensive production with their verified orientation", () => {
    assert.deepEqual(det.giveaways, { interceptionsThrown: 0, sacksSuffered: 4, fumblesLost: 1 });
    assert.deepEqual(cin.giveaways, { interceptionsThrown: 3, sacksSuffered: 2, fumblesLost: 0 });
    assert.deepEqual(det.defense, { touchdowns: 0, twoPointScores: 1, blockedKicks: 0 });
    assert.deepEqual(cin.defense, { touchdowns: 0, twoPointScores: 0, blockedKicks: 0 });
  });

  it("derives each team's points from its counts and matches the schedule's final score", () => {
    const game = games.find((g) => g.gameId === "2025_05_DET_CIN")!;
    assert.deepEqual([game.away, game.awayScore, game.home, game.homeScore], ["DET", 37, "CIN", 24]);
    assert.equal(teamPointsFromCounts(det), game.awayScore);
    assert.equal(teamPointsFromCounts(cin), game.homeScore);
    assert.equal(pointsAllowed(game, "DET"), 24);
    assert.equal(pointsAllowed(game, "CIN"), 37);
    assert.throws(() => pointsAllowed(game, "KC"), /KC is not in 2025_05_DET_CIN/);
  });

  it("scores each defense from the opponent's giveaways and the opponent's final score", () => {
    const byTeam = new Map(defenseWeeks(teams, games).map((d) => [d.team, d]));
    // DET: 2 sacks + 3 INT * 2 + 1 safety * 2 + 0 (24 allowed) = 10
    assert.deepEqual(byTeam.get("DET")!.stats, {
      sacks: 2,
      interceptions: 3,
      fumbleRecoveries: 0,
      touchdowns: 0,
      twoPointScores: 1,
      blockedKicks: 0,
      pointsAllowed: 24,
    });
    assert.deepEqual(byTeam.get("DET")!.score, { status: "complete", points: 10 });
    // CIN: 4 sacks + 1 fumble recovery * 2 - 4 (37 allowed) = 2
    assert.deepEqual(byTeam.get("CIN")!.stats, {
      sacks: 4,
      interceptions: 0,
      fumbleRecoveries: 1,
      touchdowns: 0,
      twoPointScores: 0,
      blockedKicks: 0,
      pointsAllowed: 37,
    });
    assert.deepEqual(byTeam.get("CIN")!.score, { status: "complete", points: 2 });
  });

  it("leaves points allowed missing for an unplayed game", () => {
    const unplayed = games.find((g) => g.gameId === "2026_01_CHI_CAR")!;
    assert.equal(unplayed.awayScore, null);
    assert.equal(unplayed.homeScore, null);
    const chi = { ...det, season: 2026, week: 1, gameId: unplayed.gameId, team: "CHI", opponent: "CAR" };
    const car = { ...cin, season: 2026, week: 1, gameId: unplayed.gameId, team: "CAR", opponent: "CHI" };
    for (const d of defenseWeeks([chi, car], games)) {
      assert.equal(d.stats.pointsAllowed, null);
      assert.deepEqual(d.score, { status: "missing", missing: ["pointsAllowed"] });
    }
  });

  it("leaves takeaways missing when the opponent's row is absent", () => {
    const [only] = defenseWeeks([det], games);
    assert.deepEqual(only!.score, { status: "missing", missing: ["sacks", "interceptions", "fumbleRecoveries"] });
  });
});
