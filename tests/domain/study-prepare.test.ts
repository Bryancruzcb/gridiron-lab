import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CsvColumnError, CsvValueError } from "../../src/lib/football/csv.ts";
import { parseSchedule, parseTeamWeeks, teamPointsFromCounts } from "../../src/lib/football/nflverse.ts";
import { pointsAllowedTier, RULESET_REF } from "../../src/lib/football/scoring.ts";
import { StudyConfigError } from "../../scripts/lib/study/errors.ts";
import { LEGACY_SCORING_REF, legacyDstPoints } from "../../scripts/lib/study/legacy-scoring.ts";
import { prepareSeason, type PreparedSeason } from "../../scripts/lib/study/prepare.ts";
import { dropColumn, dropRows, mapRows, seasonTexts } from "../fixtures/football/study-fixture.ts";

const texts = seasonTexts(2041);
const current = prepareSeason(2041, texts, { scoring: RULESET_REF });
const defense = (d: PreparedSeason, team: string, week: number) => d.defenses.find((r) => r.team === team && r.week === week)!;

describe("season preparation", () => {
  it("uses a fixture whose team counts reproduce every final score", () => {
    const games = parseSchedule(texts.schedule).rows;
    for (const t of parseTeamWeeks(texts.teamWeek).rows) {
      const g = games.find((x) => x.gameId === t.gameId)!;
      assert.equal(teamPointsFromCounts(t), t.team === g.away ? g.awayScore : g.homeScore, `${t.gameId} ${t.team}`);
    }
  });

  it("keeps the season's games with finality from the schedule", () => {
    assert.deepEqual(
      current.games.map((g) => [g.week, g.gameId, g.final]),
      [
        [1, "2041_01_AAA_BBB", true],
        [1, "2041_01_CCC_DDD", true],
        [2, "2041_02_AAA_CCC", true],
        [2, "2041_02_BBB_DDD", true],
        [3, "2041_03_CCC_DDD", true],
        [4, "2041_04_AAA_DDD", true],
        [4, "2041_04_BBB_CCC", true],
        [5, "2041_05_AAA_BBB", false],
      ],
    );
    assert.deepEqual(current.statWeeks, [1, 2, 3, 4]);
    assert.deepEqual(current.skipped, []);
  });

  it("sorts rows by week, game and player and joins the usage columns", () => {
    const keys = current.players.map((r) => `${r.week}|${r.gameId}|${r.playerId}`);
    assert.deepEqual(keys, [...keys].sort());
    const rb = current.players.find((r) => r.playerId === "AAA-RB1" && r.week === 1)!;
    assert.ok(rb.targets != null && rb.targets >= 2 && rb.carries != null);
    const qb = current.players.find((r) => r.playerId === "AAA-QB" && r.week === 1)!;
    assert.ok(qb.passingEpa != null && qb.passingCpoe != null && qb.attempts! >= 22);
  });

  it("keeps a real zero as a scored row", () => {
    const zero = current.players.find((r) => r.playerId === "DDD-WR2" && r.week === 3)!;
    assert.deepEqual([zero.status, zero.points], ["complete", 0]);
  });

  it("rejects an unknown scoring reference", () => {
    assert.throws(() => prepareSeason(2041, texts, { scoring: "gridiron-lab-ppr-dst@2" }), StudyConfigError);
  });
});

describe("missing and invalid data", () => {
  it("fails on a missing required column instead of producing zeros", () => {
    const cases: [keyof typeof texts, string][] = [
      ["playerWeek", "targets"],
      ["playerWeek", "receptions"],
      ["teamWeek", "sacks_suffered"],
      ["schedule", "home_score"],
    ];
    for (const [file, column] of cases) {
      assert.throws(
        () => prepareSeason(2041, { ...texts, [file]: dropColumn(texts[file], column) }, { scoring: RULESET_REF }),
        (e: unknown) => e instanceof CsvColumnError && e.missing.includes(column),
        `${file} without ${column}`,
      );
    }
    assert.throws(
      () => prepareSeason(2041, { ...texts, teamWeek: dropColumn(texts.teamWeek, "def_sacks") }, { scoring: LEGACY_SCORING_REF }),
      (e: unknown) => e instanceof CsvColumnError && e.missing.includes("def_sacks"),
    );
  });

  it("fails on a non-numeric value", () => {
    const bad = mapRows(texts.playerWeek, (w) => w === 2, (c) => {
      if (c.player_id === "CCC-WR1") c.receiving_yards = "12yds";
    });
    assert.throws(() => prepareSeason(2041, { ...texts, playerWeek: bad }, { scoring: RULESET_REF }), CsvValueError);
  });

  it("keeps an unscorable player row and a defense without points allowed missing", () => {
    const playerWeek = mapRows(texts.playerWeek, (w) => w === 2, (c) => {
      if (c.player_id === "CCC-WR1") c.receptions = "NA";
    });
    const schedule = mapRows(texts.schedule, (w) => w === 2, (c) => {
      if (c.game_id === "2041_02_BBB_DDD") c.away_score = "";
    });
    const data = prepareSeason(2041, { ...texts, playerWeek, schedule }, { scoring: RULESET_REF });
    const row = data.players.find((r) => r.playerId === "CCC-WR1" && r.week === 2)!;
    assert.deepEqual([row.status, row.points, row.missing], ["missing", null, ["receptions"]]);
    const ddd = defense(data, "DDD", 2);
    assert.deepEqual([ddd.status, ddd.points, ddd.pointsAllowed], ["missing", null, null]);
    assert.ok(ddd.missing.includes("pointsAllowed"));
    assert.equal(defense(data, "BBB", 2).status, "complete");
  });

  it("leaves takeaways missing when the opponent's team row is absent", () => {
    const teamWeek = dropRows(texts.teamWeek, (c) => c.week === "2" && c.team === "CCC");
    const data = prepareSeason(2041, { ...texts, teamWeek }, { scoring: RULESET_REF });
    assert.deepEqual(defense(data, "AAA", 2).missing, ["sacks", "interceptions", "fumbleRecoveries"]);
    assert.equal(defense(data, "AAA", 2).points, null);
  });
});

describe("legacy DST scoring variant", () => {
  const legacy = prepareSeason(2041, texts, { scoring: LEGACY_SCORING_REF });

  it("reproduces the 19-vs-17 PAT double count only when selected", () => {
    // AAA scored 17 in week 1 on two touchdowns, two PATs and a field goal.
    assert.equal(defense(current, "BBB", 1).pointsAllowed, 17);
    assert.equal(defense(legacy, "BBB", 1).pointsAllowed, 19);
    // BBB scored 13 in week 2 (one TD, one PAT, two FG); the legacy estimate of 14 drops DDD a tier.
    assert.equal(defense(current, "DDD", 2).pointsAllowed, 13);
    assert.equal(defense(legacy, "DDD", 2).pointsAllowed, 14);
    assert.equal(pointsAllowedTier(13) - pointsAllowedTier(14), 3);
    assert.equal(defense(current, "DDD", 2).points! - defense(legacy, "DDD", 2).points!, 3);
    assert.equal(current.scoring, RULESET_REF);
  });

  it("uses the team's own def_sacks, which undercount here", () => {
    // AAA's own def_sacks miss one of CCC's three sacks suffered in week 2.
    const teams = parseTeamWeeks(texts.teamWeek).rows;
    const ccc = teams.find((t) => t.team === "CCC" && t.week === 2)!;
    assert.equal(ccc.giveaways.sacksSuffered, 3);
    assert.equal(legacyDstPoints({ pa: 19, sacks: 2, ints: 1, turnovers: 2, defTd: 0 }), 7);
  });

  it("fills 24 points allowed when the opponent row is missing, and says so", () => {
    const teamWeek = dropRows(texts.teamWeek, (c) => c.week === "2" && c.team === "CCC");
    const data = prepareSeason(2041, { ...texts, teamWeek }, { scoring: LEGACY_SCORING_REF });
    const aaa = defense(data, "AAA", 2);
    assert.equal(aaa.pointsAllowed, 24);
    assert.match(aaa.note!, /24 points allowed assumed/);
    assert.equal(defense(legacy, "AAA", 2).note, null);
  });
});
