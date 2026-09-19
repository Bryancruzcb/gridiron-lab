import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { StudyModelSpec } from "../../src/data/types.ts";
import { RULESET_REF } from "../../src/lib/football/scoring.ts";
import { makeModel, PROJECTION_METHODS } from "../../scripts/lib/study/models.ts";
import { prepareSeason, type SeasonTexts } from "../../scripts/lib/study/prepare.ts";
import { hashJson } from "../../scripts/lib/study/hash.ts";
import { buildFeatures, ewma, historyGames, opponentFactor, project, snapshotBefore, type HistorySnapshot } from "../../scripts/lib/study/projections.ts";
import { dropRows, fixtureUniverse, mapRows, reverseRows, runFixture, seasonTexts } from "../fixtures/football/study-fixture.ts";

// Every method, plus non-default parameters so each branch reads its own settings.
const ALL_MODELS = {
  models: [
    ...PROJECTION_METHODS.map((m) => makeModel(m)),
    makeModel("ewma", { id: "ewma-0.8", params: { alpha: 0.8 } }),
    makeModel("blend", { id: "blend-2", params: { seasonWeight: 0.3, windowWeeks: 2 } }),
    makeModel("shrink", { id: "shrink-1", params: { k: 1 } }),
    makeModel("opp", { id: "opp-wide", params: { clampLow: 0.2, clampHigh: 3 } }),
    makeModel("usage", { id: "usage-1", params: { windowWeeks: 1 } }),
  ],
  baseline: "trail",
};

function forecasts(texts: SeasonTexts, week: number) {
  const run = runFixture({ texts, config: { models: ALL_MODELS, weeks: { from: week, to: week } } });
  const w = run.weeks[0]!;
  return {
    slate: w.slate.map(({ id, pos, team, opponent, gameId, salary, historyGames }) => ({ id, pos, team, opponent, gameId, salary, historyGames })),
    slateSha256: w.slateSha256,
    projections: Object.fromEntries(w.models.map((m) => [m.model, m.projections])),
    actuals: w.slate.map((s) => [s.id, s.status, s.points]),
  };
}

function bump(cells: Record<string, string>, columns: string[], by: number) {
  for (const c of columns) if (cells[c] !== "NA" && cells[c] !== "") cells[c] = String(Number(cells[c]) + by);
}

/** Edits every stat and score from `fromWeek` on. */
function perturb(texts: SeasonTexts, fromWeek: number): SeasonTexts {
  return {
    playerWeek: mapRows(texts.playerWeek, (w) => w >= fromWeek, (c) => {
      bump(c, ["passing_yards", "rushing_yards", "receiving_yards"], 37);
      bump(c, ["attempts", "carries", "targets", "receptions", "receiving_tds", "passing_interceptions"], 2);
      if (c.team === "BBB") c.team = "DDD";
    }),
    teamWeek: mapRows(texts.teamWeek, (w) => w >= fromWeek, (c) => {
      bump(c, ["sacks_suffered", "passing_interceptions", "fumbles_lost_total", "def_tds"], 1);
    }),
    schedule: mapRows(texts.schedule, (w) => w >= fromWeek, (c) => {
      if (c.season === "2041" && c.away_score !== "") c.away_score = String(Number(c.away_score) + 21);
    }),
  };
}

/** Removes every stat row from `fromWeek` on and makes those games not final. */
function truncate(texts: SeasonTexts, fromWeek: number): SeasonTexts {
  return {
    playerWeek: dropRows(texts.playerWeek, (c) => Number(c.week) >= fromWeek),
    teamWeek: dropRows(texts.teamWeek, (c) => Number(c.week) >= fromWeek),
    schedule: mapRows(texts.schedule, (w) => w >= fromWeek, (c) => {
      if (c.season === "2041") {
        c.away_score = "";
        c.home_score = "";
      }
    }),
  };
}

describe("forecast causality", () => {
  const texts = seasonTexts(2041);

  for (const week of [2, 3, 4, 5]) {
    it(`week ${week} slates and forecasts ignore every row from week ${week} on, for every method`, () => {
      const base = forecasts(texts, week);
      assert.ok(base.slate.length > 0);
      for (const changed of [perturb(texts, week), truncate(texts, week)]) {
        const other = forecasts(changed, week);
        assert.deepEqual(other.slate, base.slate);
        assert.equal(other.slateSha256, base.slateSha256);
        assert.deepEqual(other.projections, base.projections);
      }
    });
  }

  it("the perturbations do reach actuals, and an earlier-row change moves every method", () => {
    const base = forecasts(texts, 3);
    assert.notDeepEqual(forecasts(perturb(texts, 3), 3).actuals, base.actuals);
    assert.notDeepEqual(forecasts(truncate(texts, 3), 3).actuals, base.actuals);
    const past = forecasts(perturb(texts, 1), 3);
    for (const id of Object.keys(base.projections)) assert.notDeepEqual(past.projections[id], base.projections[id], id);
  });

  it("orders history by week and game, not by file order", () => {
    const reversed = { playerWeek: reverseRows(texts.playerWeek), teamWeek: reverseRows(texts.teamWeek), schedule: reverseRows(texts.schedule) };
    assert.deepEqual(forecasts(reversed, 4).projections, forecasts(texts, 4).projections);
  });
});


describe("leakage: lineup causality", () => {
  const texts = seasonTexts(2041);

  /** Pregame + solver outputs; do not compare lineup.actual / slot points. */
  function weekSolve(textsIn: SeasonTexts, week: number) {
    const run = runFixture({ texts: textsIn, config: { models: ALL_MODELS, weeks: { from: week, to: week } } });
    const w = run.weeks[0]!;
    assert.ok(w.slate.length > 0);
    return {
      slateSha256: w.slateSha256,
      projections: Object.fromEntries(w.models.map((m) => [m.model, m.projections])),
      lineups: Object.fromEntries(
        w.models.map((m) => {
          assert.equal(m.solver.status, "ok", m.model);
          assert.ok(m.lineup, m.model);
          return [m.model, m.lineup!.slots.map((s) => s.id)];
        }),
      ),
    };
  }

  for (const week of [2, 3, 4, 5]) {
    it(`week ${week} lineups ignore truncate/perturb from week ${week} on, for every method`, () => {
      const base = weekSolve(texts, week);
      for (const changed of [perturb(texts, week), truncate(texts, week)]) {
        const other = weekSolve(changed, week);
        assert.equal(other.slateSha256, base.slateSha256);
        assert.deepEqual(other.projections, base.projections);
        assert.deepEqual(other.lineups, base.lineups);
      }
    });
  }

  it("an earlier-row change can move at least one method's lineup ids", () => {
    const base = weekSolve(texts, 3);
    const past = weekSolve(perturb(texts, 1), 3);
    assert.notDeepEqual(past.projections, base.projections);
    const lineupMoved = Object.keys(base.lineups).some(
      (id) => JSON.stringify(past.lineups[id]) !== JSON.stringify(base.lineups[id]),
    );
    assert.ok(lineupMoved, "expected at least one model lineup id list to change after past-week perturb");
  });
});

/** Canonical hashable view of HistorySnapshot for leakage audits. */
function snapshotAuditView(s: HistorySnapshot) {
  const players = [...s.players.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([playerId, rows]) => ({
      playerId,
      weeks: rows.map((r) => r.week),
      points: rows.map((r) => r.points),
      gameIds: rows.map((r) => r.gameId),
    }));
  const defenses = [...s.defenses.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([team, rows]) => ({
      team,
      weeks: rows.map((r) => r.week),
      points: rows.map((r) => r.points),
      gameIds: rows.map((r) => r.gameId),
    }));
  const latestTeam = [...s.latestTeam.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([playerId, team]) => ({ playerId, team }));
  const games = s.games.map((g) => ({
    gameId: g.gameId,
    week: g.week,
    away: g.away,
    home: g.home,
    awayScore: g.awayScore,
    homeScore: g.homeScore,
    final: g.final,
  }));
  const opponents = [...s.opponents.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, opponent]) => ({ key, opponent }));
  return { cutoff: s.cutoff, players, defenses, latestTeam, games, opponents };
}

describe("leakage: snapshot freeze", () => {
  const cutoff = { season: 2041, seasonType: "REG" as const, beforeWeek: 4 };
  const texts = seasonTexts(2041);

  it("snapshotBefore week 4 is unchanged if week≥4 stats/scores are destroyed", () => {
    const base = snapshotAuditView(snapshotBefore(prepareSeason(2041, texts, { scoring: RULESET_REF }), cutoff));
    for (const changed of [perturb(texts, 4), truncate(texts, 4)]) {
      const other = snapshotAuditView(snapshotBefore(prepareSeason(2041, changed, { scoring: RULESET_REF }), cutoff));
      assert.deepEqual(other, base);
      assert.equal(hashJson(other), hashJson(base));
    }
  });

  it("a past-week row change moves the week-4 snapshot audit view", () => {
    const base = snapshotAuditView(snapshotBefore(prepareSeason(2041, texts, { scoring: RULESET_REF }), cutoff));
    const past = snapshotAuditView(
      snapshotBefore(prepareSeason(2041, perturb(texts, 1), { scoring: RULESET_REF }), cutoff),
    );
    assert.notDeepEqual(past, base);
    assert.notEqual(hashJson(past), hashJson(base));
  });
});

describe("projection methods", () => {
  const data = prepareSeason(2041, seasonTexts(2041), { scoring: RULESET_REF });
  const snapshot = snapshotBefore(data, { season: 2041, seasonType: "REG", beforeWeek: 4 });
  const universe = fixtureUniverse();
  const features = buildFeatures(snapshot, universe.players, 8);
  const subject = { id: "CCC-WR1", pos: "WR", team: "CCC", opponent: "BBB" } as const;
  const rows = data.players.filter((r) => r.playerId === "CCC-WR1" && r.week < 4);
  const prior = rows.map((r) => r.points!);
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
  const p = (method: StudyModelSpec["method"], params: Record<string, number> = {}) =>
    project(makeModel(method, { params }), subject, snapshot, features);

  it("snapshots hold only pre-cutoff rows and pregame schedule information", () => {
    assert.deepEqual(snapshot.players.get("CCC-WR1")!.map((r) => r.week), [1, 2, 3]);
    assert.ok([...snapshot.players.values()].flat().every((r) => r.week < 4));
    assert.ok([...snapshot.defenses.values()].flat().every((r) => r.week < 4));
    for (const g of snapshot.games) {
      if (g.week >= 4) assert.deepEqual([g.awayScore, g.homeScore, g.final], [null, null, false]);
    }
    assert.equal(snapshot.latestTeam.get("BBB-WR2"), "BBB");
  });

  it("match hand-computed values", () => {
    near(p("trail"), avg(prior));
    near(p("last1"), prior[2]!);
    near(p("last3", { windowWeeks: 2 }), avg(prior.slice(-2)));
    near(p("blend", { seasonWeight: 0.25, windowWeeks: 1 }), 0.25 * avg(prior) + 0.75 * prior[2]!);
    near(p("ewma"), 0.35 * prior[2]! + 0.65 * (0.35 * prior[1]! + 0.65 * prior[0]!));

    const wrPool = universe.players.filter((u) => u.pos === "WR").flatMap((u) => (snapshot.players.get(u.id) ?? []).map((r) => r.points));
    near(features.positionMean("WR"), avg(wrPool));
    near(p("shrink"), (3 / 7) * avg(prior) + (4 / 7) * avg(wrPool));

    const volume = rows.map((r) => Math.max((r.carries ?? 0) + (r.targets ?? 0), 1));
    near(p("usage"), avg(volume) * avg(rows.map((r, i) => r.points! / volume[i]!)));

    // BBB faced AAA (week 1) and DDD (week 2) before week 4, and was on bye in week 3.
    const opponent = new Map(data.games.flatMap((g) => [[`${g.gameId}|${g.away}`, g.home], [`${g.gameId}|${g.home}`, g.away]]));
    const vsBbb = data.players.filter((r) => r.week < 4 && r.position === "WR" && opponent.get(`${r.gameId}|${r.team}`) === "BBB");
    assert.deepEqual([...new Set(vsBbb.map((r) => r.team))].sort(), ["AAA", "DDD"]);
    // The denominator is every WR row with a scheduled opponent, not the pool's WR mean.
    const allWr = data.players.filter((r) => r.week < 4 && r.position === "WR" && r.points != null && opponent.has(`${r.gameId}|${r.team}`));
    const factor = avg(vsBbb.map((r) => r.points!)) / avg(allWr.map((r) => r.points!));
    near(features.leagueAllowed("WR")!, avg(allWr.map((r) => r.points!)));
    near(p("opp"), avg(prior) * Math.min(1.3, Math.max(0.7, factor)));
    near(p("opp", { clampLow: 1, clampHigh: 1 }), avg(prior));
  });

  it("uses attempts for QB usage and falls back for defenses", () => {
    const qbRows = data.players.filter((r) => r.playerId === "DDD-QB" && r.week < 4);
    const qb = { id: "DDD-QB", pos: "QB", team: "DDD", opponent: "AAA" } as const;
    const vol = qbRows.map((r) => Math.max(r.attempts ?? 0, 1));
    near(project(makeModel("usage"), qb, snapshot, features), avg(vol) * avg(qbRows.map((r, i) => r.points! / vol[i]!)));
    const dst = { id: "DST-DDD", pos: "DST", team: "DDD", opponent: "AAA" } as const;
    const dstPrior = snapshot.defenses.get("DDD")!.map((r) => r.points);
    near(project(makeModel("usage"), dst, snapshot, features), avg(dstPrior));
  });

  it("refuses to project without history", () => {
    assert.throws(() => ewma([], 0.5), /empty history/);
    const early = snapshotBefore(data, { season: 2041, seasonType: "REG", beforeWeek: 1 });
    assert.throws(() => project(makeModel("trail"), subject, early, buildFeatures(early, universe.players, 8)), /no scored history/);
  });
});

describe("opponent factor", () => {
  const data = prepareSeason(2041, seasonTexts(2041), { scoring: RULESET_REF });
  const universe = fixtureUniverse();
  // Starters only: their position mean sits well above the mean of every source row, like the
  // study's top-N pools against nflverse rows that include backups.
  const starters = universe.players.filter((u) => !u.id.endsWith("2"));
  const teams = ["AAA", "BBB", "CCC", "DDD"];
  const positions = ["QB", "RB", "WR", "TE", "DST"] as const;
  const opponent = new Map(data.games.flatMap((g) => [[`${g.gameId}|${g.away}`, g.home], [`${g.gameId}|${g.home}`, g.away]]));
  const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

  /** Scored rows at the position against the team before the week, counted straight from the prepared season. */
  const rowsAgainst = (pos: (typeof positions)[number], team: string, week: number) =>
    pos === "DST"
      ? data.defenses.filter((r) => r.week < week && r.points != null && opponent.get(`${r.gameId}|${r.team}`) === team).length
      : data.players.filter((r) => r.week < week && r.points != null && r.position === pos && opponent.get(`${r.gameId}|${r.team}`) === team).length;

  for (const week of [3, 4, 5]) {
    it(`centres on 1 across opponents at every position before week ${week}, whatever the pool`, () => {
      const features = buildFeatures(snapshotBefore(data, { season: 2041, seasonType: "REG", beforeWeek: week }), starters, 8);
      for (const pos of positions) {
        const weights = teams.map((t) => rowsAgainst(pos, t, week));
        const factors = teams.map((t) => opponentFactor(features, pos, t));
        const weighted = factors.reduce((s, f, i) => s + f * weights[i]!, 0) / weights.reduce((s, n) => s + n, 0);
        near(weighted, 1);
        const plain = factors.reduce((s, f) => s + f, 0) / factors.length;
        assert.ok(Math.abs(plain - 1) < 0.05, `${pos} before week ${week}: mean factor ${plain}`);
      }
    });
  }

  it("does not read the pool, so opp projections match for a starters-only and a full pool", () => {
    const snapshot = snapshotBefore(data, { season: 2041, seasonType: "REG", beforeWeek: 4 });
    const full = buildFeatures(snapshot, universe.players, 8);
    const top = buildFeatures(snapshot, starters, 8);
    // opp@1 divided by the pool's position mean, so these pools gave different projections.
    assert.ok(top.positionMean("WR") > full.positionMean("WR") + 3 && top.positionMean("RB") > full.positionMean("RB") + 3);
    const wide = makeModel("opp", { params: { clampLow: 0.01, clampHigh: 10 } });
    let compared = 0;
    for (const u of universe.players) {
      const team = u.pos === "DST" ? u.team : (snapshot.latestTeam.get(u.id) ?? u.team);
      if (!historyGames(snapshot, { id: u.id, pos: u.pos, team })) continue;
      for (const opp of teams.filter((t) => t !== team)) {
        const subject = { id: u.id, pos: u.pos, team, opponent: opp };
        assert.equal(project(wide, subject, snapshot, full), project(wide, subject, snapshot, top), `${u.id} vs ${opp}`);
        compared += 1;
      }
    }
    assert.ok(compared > 50);
  });

  it("is 1 without an opponent, without rows for that opponent, or before any history", () => {
    const features = buildFeatures(snapshotBefore(data, { season: 2041, seasonType: "REG", beforeWeek: 4 }), universe.players, 8);
    assert.equal(opponentFactor(features, "WR", null), 1);
    assert.equal(features.opponentAllowed("WR", "ZZZ"), null);
    assert.equal(opponentFactor(features, "WR", "ZZZ"), 1);
    const empty = buildFeatures(snapshotBefore(data, { season: 2041, seasonType: "REG", beforeWeek: 1 }), universe.players, 8);
    assert.equal(empty.leagueAllowed("WR"), null);
    assert.equal(opponentFactor(empty, "WR", "BBB"), 1);
  });
});

describe("slates", () => {
  const run = runFixture();
  const week = (n: number) => run.weeks.find((w) => w.week === n)!;
  const entry = (n: number, id: string) => week(n).slate.find((s) => s.id === id);

  it("take the opponent from the schedule for a player without a postgame row", () => {
    assert.deepEqual(entry(2, "AAA-WR2"), {
      id: "AAA-WR2",
      pos: "WR",
      team: "AAA",
      opponent: "CCC",
      gameId: "2041_02_AAA_CCC",
      salary: 3600,
      historyGames: 1,
      status: "inactive",
      points: null,
      note: "final game, no stat row",
    });
    assert.deepEqual([entry(5, "AAA-QB")!.opponent, entry(5, "AAA-QB")!.status], ["BBB", "not-final"]);
  });

  it("use the latest team before the cutoff, not the frozen universe team", () => {
    assert.equal(fixtureUniverse().players.find((p) => p.id === "BBB-WR2")!.team, "AAA");
    assert.deepEqual([entry(2, "BBB-WR2")!.team, entry(2, "BBB-WR2")!.opponent], ["BBB", "DDD"]);
    assert.deepEqual(week(3).offSlate.find((o) => o.id === "BBB-WR2"), { id: "BBB-WR2", reason: "bye" });
  });

  it("separate byes, missing history, unknown ids, played zeros and not-final games", () => {
    assert.ok(week(1).offSlate.filter((o) => o.id !== "ZZZ-WR9").every((o) => o.reason === "no-history"));
    for (const w of run.weeks) assert.deepEqual(w.offSlate.find((o) => o.id === "ZZZ-WR9"), { id: "ZZZ-WR9", reason: "unknown-identity" });
    assert.deepEqual([entry(3, "DDD-WR2")!.status, entry(3, "DDD-WR2")!.points], ["played", 0]);
    assert.ok(week(5).slate.every((s) => s.status === "not-final" && s.points == null));
    assert.equal(week(5).statSourceCoversWeek, false);
  });
});
