import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GameStatus, WeekSkill } from "../../src/lib/live/types.ts";
import {
  aggregateSeason,
  indexPlayerWeeks,
  playerWeekId,
  throughWeek,
  type PlayerWeek,
  type WeekKey,
} from "../../src/lib/football/player-weeks.ts";
import { scoreOffense, type OffenseStats } from "../../src/lib/football/scoring.ts";
import { mergeCurrentWeek } from "../../src/lib/football/week-merge.ts";

const identity = (name: string, team: string) => `${name.toLowerCase()}|${team}`;
const WEEK2: WeekKey = { season: 2026, seasonType: "REG", week: 2 };

// A receiver whose only stat is receptions, so points equal receptions under PPR.
function published(week: number, receptions: number | null, overrides: Partial<PlayerWeek> = {}): PlayerWeek {
  const offense: OffenseStats = {
    passingYards: 0,
    passingTds: 0,
    interceptions: 0,
    rushingYards: 0,
    rushingTds: 0,
    receptions,
    receivingYards: 0,
    receivingTds: 0,
    fumblesLost: 0,
    twoPointConversions: 0,
    specialTeamsTds: 0,
  };
  return {
    season: 2026,
    seasonType: "REG",
    week,
    playerId: "00-0000001",
    name: "Test Receiver",
    team: "DET",
    opponent: "CIN",
    position: "WR",
    headshot: null,
    gameId: `2026_0${week}_DET_CIN`,
    box: {
      completions: 0,
      attempts: 0,
      passingYards: 0,
      passingTds: 0,
      interceptions: 0,
      sacksSuffered: 0,
      carries: 0,
      rushingYards: 0,
      rushingTds: 0,
      receptions,
      receivingYards: 0,
      receivingTds: 0,
    },
    offense,
    score: scoreOffense(offense),
    ...overrides,
  };
}

function live(ppr: number, status: GameStatus = "post", overrides: Partial<WeekSkill> = {}): WeekSkill {
  return {
    gsisId: null,
    espnId: "4430001",
    name: "Test Receiver",
    team: "DET",
    pos: "WR",
    ppr,
    headshot: null,
    status,
    source: "espn",
    score: { status: "partial", unavailable: ["twoPointConversions"] },
    ...overrides,
  };
}

describe("weekly rows and the season aggregate", () => {
  const rows = [published(1, 10), published(2, 20)];

  it("keeps week 2 at 20 while the season total is 30", () => {
    const [season] = aggregateSeason(rows, 2026, "REG");
    assert.equal(season!.ppr, 30);
    assert.equal(season!.games, 2);
    assert.equal(season!.throughWeek, 2);
    assert.equal(season!.box.receptions, 30);

    const byId = indexPlayerWeeks(rows);
    const week2 = byId.get(playerWeekId({ ...WEEK2, playerId: "00-0000001" }));
    assert.deepEqual(week2!.score, { status: "complete", points: 20 });

    const merged = mergeCurrentWeek({ week: WEEK2, live: [live(18.5)], published: rows, identity });
    assert.equal(merged.length, 1);
    assert.equal(merged[0]!.ppr, 20);
    assert.equal(merged[0]!.source, "nflverse");
    assert.equal(merged[0]!.gsisId, "00-0000001");
  });

  it("treats a repeated season/type/week/player key as a data error", () => {
    assert.throws(() => indexPlayerWeeks([published(2, 1), published(2, 2)]), /duplicate player week 2026-REG-02\|00-0000001/);
  });

  it("leaves the season total unknown when a week cannot be scored", () => {
    const [season] = aggregateSeason([published(1, 10), published(2, null)], 2026, "REG");
    assert.equal(season!.ppr, null);
    assert.equal(season!.games, 2);
  });

  it("aggregates only the requested season and season type", () => {
    const post = published(19, 7, { seasonType: "POST" });
    const [season] = aggregateSeason([...rows, post], 2026, "REG");
    assert.equal(season!.ppr, 30);
    assert.equal(throughWeek([...rows, post], 2026, "REG"), 2);
    assert.equal(throughWeek([...rows, post], 2026, "POST"), 19);
    assert.equal(throughWeek(rows, 2025, "REG"), null);
  });
});

describe("current-week merge", () => {
  it("does not let a source that only reaches week 1 overwrite week 2", () => {
    const through1 = [published(1, 10)];
    assert.equal(throughWeek(through1, 2026, "REG"), 1);
    const merged = mergeCurrentWeek({ week: WEEK2, live: [live(18.5)], published: through1, identity });
    assert.equal(merged.length, 1);
    assert.equal(merged[0]!.ppr, 18.5);
    assert.equal(merged[0]!.source, "espn");
    assert.equal(merged[0]!.gsisId, null);
  });

  it("replaces a provisional nonzero score with an authoritative final zero", () => {
    const merged = mergeCurrentWeek({ week: WEEK2, live: [live(6.5)], published: [published(2, 0)], identity });
    assert.equal(merged[0]!.ppr, 0);
    assert.equal(merged[0]!.source, "nflverse");
    assert.deepEqual(merged[0]!.score, { status: "complete", unavailable: [] });
  });

  it("keeps the provisional score while the game is still live", () => {
    const merged = mergeCurrentWeek({ week: WEEK2, live: [live(6.5, "in")], published: [published(2, 20)], identity });
    assert.equal(merged[0]!.ppr, 6.5);
    assert.equal(merged[0]!.source, "espn");
    assert.equal(merged[0]!.gsisId, "00-0000001");
  });

  it("never inserts players from another week, season type or season", () => {
    const other = { playerId: "00-0000002", name: "Other Player" };
    const merged = mergeCurrentWeek({
      week: WEEK2,
      live: [],
      published: [
        published(1, 10, other),
        published(3, 10, other),
        published(2, 10, { ...other, seasonType: "POST" }),
        published(2, 10, { ...other, season: 2025 }),
      ],
      identity,
    });
    assert.deepEqual(merged, []);
  });

  it("adds a same-week skill player missing from the live box as final, but not other positions", () => {
    const merged = mergeCurrentWeek({
      week: WEEK2,
      live: [live(3)],
      published: [
        published(2, 12, { playerId: "00-0000003", name: "Late Box", position: "TE" }),
        published(2, 0, { playerId: "00-0000004", name: "Some Kicker", position: "K" }),
      ],
      identity,
    });
    assert.deepEqual(
      merged.map((m) => [m.name, m.pos, m.ppr, m.status, m.source]),
      [
        ["Late Box", "TE", 12, "post", "nflverse"],
        ["Test Receiver", "WR", 3, "post", "espn"],
      ],
    );
  });

  it("joins nothing when the scoreboard week key is incomplete", () => {
    const merged = mergeCurrentWeek({ week: null, live: [live(6.5)], published: [published(2, 20)], identity });
    assert.equal(merged[0]!.ppr, 6.5);
    assert.equal(merged[0]!.source, "espn");
  });

  it("does not mutate the live lines it was given", () => {
    const line = live(6.5);
    mergeCurrentWeek({ week: WEEK2, live: [line], published: [published(2, 20)], identity });
    assert.equal(line.ppr, 6.5);
    assert.equal(line.source, "espn");
  });
});
