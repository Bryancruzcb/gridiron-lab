import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  espnDefenseStats,
  espnSeasonType,
  parsePlayerLines,
  parseScoreboard,
  parseTeamBoxes,
  scoreEspnLine,
  twoPointScoresFromPlays,
} from "../../src/lib/football/espn.ts";
import { defenseWeeks, parsePlayerWeeks, parseSchedule, parseTeamWeeks } from "../../src/lib/football/nflverse.ts";
import { scoreDefense } from "../../src/lib/football/scoring.ts";

type Json = Record<string, unknown>;
const fixture = (name: string) => readFileSync(new URL(`../fixtures/football/${name}`, import.meta.url), "utf8");
const board = () => JSON.parse(fixture("espn_scoreboard_2025_reg_w5.json")) as Json;
const summary = () => JSON.parse(fixture("espn_summary_401772854.json")) as Json;
const nflTeams = parseTeamWeeks(fixture("stats_team_week_2025_05_DET_CIN.csv")).rows;
const nflGames = parseSchedule(fixture("games_2025_05_DET_CIN.csv")).rows;

describe("ESPN scoreboard", () => {
  it("parses season, season type and week into a complete join key", () => {
    const b = parseScoreboard(board(), new Set());
    assert.deepEqual([b.season, b.seasonType, b.week], [2025, "REG", 5]);
    assert.deepEqual(b.weekKey, { season: 2025, seasonType: "REG", week: 5 });
    const g = b.games[0]!;
    assert.deepEqual(
      [g.id, g.away.abbr, g.away.score, g.home.abbr, g.home.score, g.status, g.seasonType, g.nflverseKey],
      ["401772854", "DET", 37, "CIN", 24, "post", "REG", "2025_05_DET_CIN"],
    );
  });

  it("maps ESPN season types", () => {
    assert.equal(espnSeasonType(1), "PRE");
    assert.equal(espnSeasonType(2), "REG");
    assert.equal(espnSeasonType("3"), "POST");
    assert.equal(espnSeasonType(4), null);
    assert.equal(espnSeasonType(undefined), null);
  });

  it("has no join key when the season type or week is absent", () => {
    const noType = board();
    delete (noType.season as Json).type;
    const b1 = parseScoreboard(noType, new Set());
    assert.equal(b1.seasonType, null);
    assert.equal(b1.weekKey, null);

    const noWeek = board();
    delete noWeek.week;
    assert.equal(parseScoreboard(noWeek, new Set()).weekKey, null);
  });
});

describe("ESPN team box orientation (DET at CIN, 2025 week 5)", () => {
  const boxes = parseTeamBoxes(summary());
  const box = (abbr: string) => boxes.find((b) => b.abbr === abbr)!;
  const nfl = (abbr: string) => nflTeams.find((t) => t.team === abbr)!;

  it("reports what each team gave up, matching nflverse giveaway columns", () => {
    assert.deepEqual(
      [box("DET").giveaways, box("DET").interceptionsThrown, box("DET").fumblesLost, box("DET").sacksSuffered, box("DET").defenseTds],
      [1, 0, 1, 4, 0],
    );
    assert.deepEqual(
      [box("CIN").giveaways, box("CIN").interceptionsThrown, box("CIN").fumblesLost, box("CIN").sacksSuffered, box("CIN").defenseTds],
      [3, 3, 0, 2, 0],
    );
    for (const team of ["DET", "CIN"]) {
      const b = box(team);
      assert.equal(b.interceptionsThrown, nfl(team).giveaways.interceptionsThrown, `${team} interceptions`);
      assert.equal(b.sacksSuffered, nfl(team).giveaways.sacksSuffered, `${team} sacks`);
      assert.equal(b.fumblesLost, nfl(team).giveaways.fumblesLost, `${team} fumbles lost`);
      assert.equal(b.giveaways, b.interceptionsThrown! + b.fumblesLost!, `${team} turnovers`);
    }
  });

  it("builds each defense from the opponent's box and matches nflverse", () => {
    const b = parseScoreboard(board(), new Set()).games[0]!;
    const twoPoint = twoPointScoresFromPlays(summary(), b.away.abbr, b.home.abbr);
    const nflDefense = new Map(defenseWeeks(nflTeams, nflGames).map((d) => [d.team, d]));
    const sides = [
      [b.away, b.home],
      [b.home, b.away],
    ] as const;
    const points: Record<string, unknown> = {};
    for (const [team, opponent] of sides) {
      const stats = espnDefenseStats({ team: team.abbr, opponent: opponent.abbr, boxes, opponentScore: opponent.score, twoPointScores: twoPoint });
      assert.deepEqual(stats, { ...nflDefense.get(team.abbr)!.stats, blockedKicks: null }, team.abbr);
      points[team.abbr] = scoreDefense(stats);
    }
    assert.deepEqual(points, {
      DET: { status: "partial", points: 10, unavailable: ["blockedKicks"] },
      CIN: { status: "partial", points: 2, unavailable: ["blockedKicks"] },
    });
  });

  it("differs from the old adapter, which read each team's own giveaways as its defense", () => {
    const legacy = (own: (typeof boxes)[number], pa: number) => {
      const fum = Math.max(0, own.giveaways! - own.interceptionsThrown!);
      const tier = pa <= 0 ? 10 : pa <= 6 ? 7 : pa <= 13 ? 4 : pa <= 20 ? 1 : pa <= 27 ? 0 : pa <= 34 ? -1 : -4;
      return own.sacksSuffered! + own.interceptionsThrown! * 2 + fum * 2 + own.defenseTds! * 6 + tier;
    };
    assert.equal(legacy(box("DET"), 24), 6);
    assert.equal(legacy(box("CIN"), 37), 4);
  });

  it("returns a missing defense score when a required box stat is absent", () => {
    const raw = summary();
    const teams = (raw.boxscore as Json).teams as { team: { abbreviation: string }; statistics: { name: string }[] }[];
    const cinRow = teams.find((t) => t.team.abbreviation === "CIN")!;
    cinRow.statistics = cinRow.statistics.filter((s) => s.name !== "sacksYardsLost");
    const stats = espnDefenseStats({ team: "DET", opponent: "CIN", boxes: parseTeamBoxes(raw), opponentScore: 24, twoPointScores: null });
    assert.deepEqual(scoreDefense(stats), { status: "missing", missing: ["sacks"] });
  });
});

describe("ESPN scoring plays", () => {
  it("counts safeties from +2 score steps and ends at the final score", () => {
    const raw = summary();
    assert.deepEqual([...twoPointScoresFromPlays(raw, "DET", "CIN")!], [
      ["DET", 1],
      ["CIN", 0],
    ]);
    const plays = raw.scoringPlays as { awayScore: number; homeScore: number }[];
    const game = nflGames.find((g) => g.gameId === "2025_05_DET_CIN")!;
    assert.deepEqual([plays.at(-1)!.awayScore, plays.at(-1)!.homeScore], [game.awayScore, game.homeScore]);
  });

  it("is null without a scoring play list", () => {
    const raw = summary();
    delete raw.scoringPlays;
    assert.equal(twoPointScoresFromPlays(raw, "DET", "CIN"), null);
  });
});

describe("ESPN player lines", () => {
  const lines = parsePlayerLines(summary());
  const line = (name: string) => lines.find((l) => l.name === name)!;

  it("reads stat columns by key and only creates lines for offensive blocks", () => {
    const goff = line("Jared Goff");
    assert.deepEqual(
      [goff.passCmp, goff.passAtt, goff.passYds, goff.passTd, goff.ints, goff.rushYds, goff.fumblesLost, goff.passed],
      [19, 23, 258, 3, 0, -2, 1, true],
    );
    const montgomery = line("David Montgomery");
    assert.deepEqual([montgomery.passTd, montgomery.rushTd, montgomery.rushed, montgomery.passed], [1, 1, true, true]);
    assert.equal(lines.some((l) => l.name === "Logan Wilson" || l.name === "Orlando Brown Jr."), false);
  });

  it("scores the same points as nflverse for the same players, flagged partial", () => {
    const nfl = parsePlayerWeeks(fixture("stats_player_week_2025_sample.csv")).rows.filter((r) => r.gameId === "2025_05_DET_CIN");
    assert.equal(lines.length, 11);
    for (const l of lines) {
      const ref = nfl.find((r) => r.name === l.name && r.team === l.team);
      assert.ok(ref && ref.score.status === "complete", l.name);
      assert.deepEqual(scoreEspnLine(l), { status: "partial", points: ref.score.points, unavailable: ["twoPointConversions"] }, l.name);
    }
  });

  it("throws when ESPN renames a stat column", () => {
    const raw = summary();
    const groups = (raw.boxscore as Json).players as { statistics: { name: string; keys: string[] }[] }[];
    const passing = groups[0]!.statistics.find((s) => s.name === "passing")!;
    passing.keys = passing.keys.map((k) => (k === "passingTouchdowns" ? "passTDs" : k));
    assert.throws(() => parsePlayerLines(raw), /passing block has no passingTouchdowns column/);
  });
});
