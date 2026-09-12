import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  gamePointsFromEvents,
  pointsAllowedTier,
  RULESET,
  RULESET_REF,
  scoreDefense,
  scoreOffense,
  type DefenseStats,
  type OffenseStats,
  type ScoringEvent,
} from "../../src/lib/football/scoring.ts";

function offense(overrides: Partial<OffenseStats> = {}): OffenseStats {
  return {
    passingYards: 0,
    passingTds: 0,
    interceptions: 0,
    rushingYards: 0,
    rushingTds: 0,
    receptions: 0,
    receivingYards: 0,
    receivingTds: 0,
    fumblesLost: 0,
    twoPointConversions: 0,
    specialTeamsTds: 0,
    ...overrides,
  };
}

function defense(overrides: Partial<DefenseStats> = {}): DefenseStats {
  return {
    sacks: 0,
    interceptions: 0,
    fumbleRecoveries: 0,
    touchdowns: 0,
    twoPointScores: 0,
    blockedKicks: 0,
    pointsAllowed: 0,
    ...overrides,
  };
}

let seq = 0;
function ev(team: string, kind: ScoringEvent["kind"], id = `e${++seq}`): ScoringEvent {
  return { id, team, kind };
}

describe("ruleset", () => {
  it("is named, versioned and says it is not exact platform scoring", () => {
    assert.equal(RULESET.id, "gridiron-lab-ppr-dst");
    assert.equal(RULESET.version, 1);
    assert.equal(RULESET_REF, "gridiron-lab-ppr-dst@1");
    assert.match(RULESET.description, /DraftKings-inspired/);
    assert.match(RULESET.description, /not exact platform scoring/);
  });

  it("lists every points-allowed tier with explicit bounds", () => {
    assert.deepEqual(
      RULESET.pointsAllowedTiers.map((t) => [t.min, t.max, t.points]),
      [
        [0, 0, 10],
        [1, 6, 7],
        [7, 13, 4],
        [14, 20, 1],
        [21, 27, 0],
        [28, 34, -1],
        [35, null, -4],
      ],
    );
  });
});

describe("offense PPR", () => {
  it("scores an empty line as a real zero", () => {
    assert.deepEqual(scoreOffense(offense()), { status: "complete", points: 0 });
  });

  it("applies each weight", () => {
    // 250 * 0.04 + 2 * 4 - 2 + 12 * 0.1 - 2 + 2 = 17.2
    const qb = offense({ passingYards: 250, passingTds: 2, interceptions: 1, rushingYards: 12, fumblesLost: 1, twoPointConversions: 1 });
    assert.deepEqual(scoreOffense(qb), { status: "complete", points: 17.2 });
    // 5 + 6.3 + 6 + 6 (return TD) = 23.3
    const wr = offense({ receptions: 5, receivingYards: 63, receivingTds: 1, specialTeamsTds: 1 });
    assert.deepEqual(scoreOffense(wr), { status: "complete", points: 23.3 });
  });

  it("keeps two decimals without float noise", () => {
    assert.deepEqual(scoreOffense(offense({ passingYards: 247 })), { status: "complete", points: 9.88 });
  });

  it("allows negative results", () => {
    // -7 * 0.1 - 2 * 2 - 2 = -6.7
    const bad = offense({ rushingYards: -7, interceptions: 2, fumblesLost: 1 });
    assert.deepEqual(scoreOffense(bad), { status: "complete", points: -6.7 });
  });

  it("reports missing required stats instead of scoring them as zero", () => {
    assert.deepEqual(scoreOffense(offense({ receptions: null, rushingTds: null })), {
      status: "missing",
      missing: ["rushingTds", "receptions"],
    });
  });

  it("marks a line partial when a source lacks a supplementary stat", () => {
    const line = offense({ receptions: 4, receivingYards: 40, twoPointConversions: null });
    assert.deepEqual(scoreOffense(line), { status: "partial", points: 8, unavailable: ["twoPointConversions"] });
  });

  it("rejects impossible values", () => {
    assert.throws(() => scoreOffense(offense({ passingTds: -1 })), RangeError);
    assert.throws(() => scoreOffense(offense({ receptions: 2.5 })), RangeError);
    assert.throws(() => scoreOffense(offense({ interceptions: Number.NaN })), RangeError);
  });
});

describe("points allowed tiers", () => {
  const cases: [number, number][] = [
    [0, 10],
    [1, 7],
    [6, 7],
    [7, 4],
    [13, 4],
    [14, 1],
    [20, 1],
    [21, 0],
    [27, 0],
    [28, -1],
    [34, -1],
    [35, -4],
    [52, -4],
  ];
  for (const [pa, points] of cases) {
    it(`${pa} allowed scores ${points}`, () => {
      assert.equal(pointsAllowedTier(pa), points);
      assert.deepEqual(scoreDefense(defense({ pointsAllowed: pa })), { status: "complete", points });
    });
  }

  it("rejects negative or fractional scores", () => {
    assert.throws(() => pointsAllowedTier(-1), RangeError);
    assert.throws(() => pointsAllowedTier(3.5), RangeError);
  });
});

describe("DST", () => {
  it("scores sacks, interceptions and opponent fumble recoveries", () => {
    assert.deepEqual(scoreDefense(defense({ sacks: 3, pointsAllowed: 17 })), { status: "complete", points: 4 });
    assert.deepEqual(scoreDefense(defense({ interceptions: 2, pointsAllowed: 21 })), { status: "complete", points: 4 });
    assert.deepEqual(scoreDefense(defense({ fumbleRecoveries: 2, pointsAllowed: 28 })), { status: "complete", points: 3 });
  });

  it("scores defensive and return touchdowns, safeties and blocked kicks", () => {
    // 6 + 2 + 2 - 4 = 6
    const d = defense({ touchdowns: 1, twoPointScores: 1, blockedKicks: 1, pointsAllowed: 35 });
    assert.deepEqual(scoreDefense(d), { status: "complete", points: 6 });
  });

  it("allows a negative defensive score", () => {
    assert.deepEqual(scoreDefense(defense({ pointsAllowed: 45 })), { status: "complete", points: -4 });
  });

  it("accepts half sacks, which player-credited sources report", () => {
    assert.deepEqual(scoreDefense(defense({ sacks: 2.5, pointsAllowed: 10 })), { status: "complete", points: 6.5 });
    assert.throws(() => scoreDefense(defense({ sacks: 2.25 })), RangeError);
  });

  it("never fills in missing points allowed", () => {
    const result = scoreDefense(defense({ sacks: 4, pointsAllowed: null }));
    assert.deepEqual(result, { status: "missing", missing: ["pointsAllowed"] });
    assert.equal("points" in result, false);
  });

  it("reports every missing required input", () => {
    assert.deepEqual(scoreDefense(defense({ sacks: null, pointsAllowed: null })), {
      status: "missing",
      missing: ["pointsAllowed", "sacks"],
    });
    assert.deepEqual(scoreDefense(defense({ touchdowns: null })), { status: "missing", missing: ["touchdowns"] });
  });

  it("is partial when a source does not report blocked kicks", () => {
    assert.deepEqual(scoreDefense(defense({ sacks: 2, blockedKicks: null, pointsAllowed: 24 })), {
      status: "partial",
      points: 2,
      unavailable: ["blockedKicks"],
    });
  });
});

describe("game points from scoring events", () => {
  it("no score gives zero and a shutout for the defense", () => {
    const totals = gamePointsFromEvents([]);
    assert.equal(totals.size, 0);
    const pa = totals.get("CIN") ?? 0;
    assert.deepEqual(scoreDefense(defense({ pointsAllowed: pa })), { status: "complete", points: 10 });
  });

  it("two touchdowns, two PATs and a field goal are 17, not the legacy 19", () => {
    const events = [ev("CIN", "touchdown"), ev("CIN", "extra_point"), ev("CIN", "touchdown"), ev("CIN", "extra_point"), ev("CIN", "field_goal")];
    assert.equal(gamePointsFromEvents(events).get("CIN"), 17);
    // The formula the three study scripts used: TD * 7 plus PATs counted again.
    const opp = { passTd: 1, rushTd: 1, fg: 1, pat: 2 };
    assert.equal(opp.passTd * 7 + opp.rushTd * 7 + opp.fg * 3 + opp.pat, 19);
  });

  it("the legacy double count can cross a tier: 27 allowed, not 30", () => {
    const events = [
      ...[1, 2, 3].flatMap((i) => [ev("BAL", "touchdown", `td${i}`), ev("BAL", "extra_point", `xp${i}`)]),
      ev("BAL", "field_goal", "fg1"),
      ev("BAL", "field_goal", "fg2"),
    ];
    const pa = gamePointsFromEvents(events).get("BAL")!;
    assert.equal(pa, 27);
    assert.equal(pointsAllowedTier(pa), 0);
    assert.equal(pointsAllowedTier(3 * 7 + 2 * 3 + 3), -1);
  });

  it("missed PATs and failed two-point tries add nothing", () => {
    const events = [ev("NYJ", "touchdown"), ev("NYJ", "extra_point_missed"), ev("NYJ", "touchdown"), ev("NYJ", "two_point_failed"), ev("NYJ", "field_goal_missed")];
    assert.equal(gamePointsFromEvents(events).get("NYJ"), 12);
  });

  it("two-point conversions add 2", () => {
    const events = [ev("PHI", "touchdown"), ev("PHI", "two_point_conversion")];
    assert.equal(gamePointsFromEvents(events).get("PHI"), 8);
  });

  it("credits defensive scores to the defense", () => {
    const events = [
      ev("KC", "touchdown"),
      ev("KC", "two_point_failed"),
      ev("DEN", "defensive_two_point"),
      ev("DEN", "touchdown"),
      ev("DEN", "extra_point"),
      ev("DEN", "safety"),
    ];
    const totals = gamePointsFromEvents(events);
    assert.equal(totals.get("KC"), 6);
    assert.equal(totals.get("DEN"), 11);
    assert.equal(pointsAllowedTier(totals.get("DEN")!), 4);
  });

  it("counts a repeated event once and rejects a conflicting repeat", () => {
    const td = ev("SEA", "touchdown", "play-1");
    assert.equal(gamePointsFromEvents([td, td, ev("SEA", "extra_point", "play-1x"), { ...td }]).get("SEA"), 7);
    assert.throws(() => gamePointsFromEvents([td, { ...td, kind: "field_goal" }]), /appears twice/);
  });
});
