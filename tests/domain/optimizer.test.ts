import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { FantasyPlayer } from "../../src/data/types.ts";
import { validateRoster } from "../../src/lib/football/lineup-validation.ts";
import { optimizeLineup, scoreLineup, solveLineup } from "../../src/lib/optimizer.ts";
import type { OptimizeRequest, SolveOk, SolveResult, SolverMethod } from "../../src/lib/optimizer.ts";
import { exhaustiveBest, isLegalLineup, lineupKey } from "./support/oracle.ts";
import type { OracleRules } from "./support/oracle.ts";
import { handoffSlate, player, realSlate } from "./support/players.ts";
import { seeded } from "./support/prng.ts";
import { randomPool } from "./support/slates.ts";

const METHODS: SolverMethod[] = ["exact-dp", "hill-climb", "greedy-proj", "greedy-value"];
const HEURISTICS: SolverMethod[] = ["hill-climb", "greedy-proj", "greedy-value"];
const SLOT_ORDER = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "DST"];

function explain(r: SolveResult) {
  return r.status === "ok" ? `${r.method} ${r.optimality} ${r.lineup.proj}` : `${r.status}/${r.code}: ${r.message}`;
}

function expectOk(r: SolveResult): SolveOk {
  if (r.status !== "ok") assert.fail(`expected ok, got ${explain(r)}`);
  assert.deepEqual(
    r.lineup.slots.map((s) => s.slot),
    SLOT_ORDER,
  );
  return r;
}

function rulesOf(req: OptimizeRequest): OracleRules {
  return {
    cap: req.cap,
    locked: [...(req.locked ?? [])],
    excluded: [...(req.excluded ?? [])],
    requireStack: req.requireStack === true,
  };
}

/** Exact DP and the wrapper must both hit the oracle optimum with a legal roster. */
function expectOracleOptimum(req: OptimizeRequest) {
  const rules = rulesOf(req);
  const oracle = exhaustiveBest(req.players, rules);
  if (oracle.kind !== "best") assert.fail(`fixture has no legal lineup: ${oracle.kind}`);
  const exact = expectOk(solveLineup({ ...req, method: "exact-dp" }));
  assert.equal(exact.optimality, "proven");
  assert.ok(Math.abs(exact.lineup.proj - oracle.score) <= 1e-6, `${exact.lineup.proj} vs ${oracle.score}`);
  assert.ok(oracle.optimal.has(lineupKey(exact.lineup.players)));
  assert.ok(isLegalLineup(exact.lineup.players, rules));
  return exact;
}

/** Players with the named positions, all $4,000, projections as listed. */
function roster(rows: [string, FantasyPlayer["pos"], number][], salary = 4000) {
  return rows.map(([id, pos, proj]) => player(id, pos, salary, proj));
}

describe("handoff regression fixtures", () => {
  it("finds the 129.4 optimum that the old reconstruction returned null for", () => {
    const players = handoffSlate();
    const oracle = exhaustiveBest(players, { cap: 40000, locked: [], excluded: [], requireStack: false });
    assert.equal(oracle.kind, "best");
    assert.ok(oracle.kind === "best" && Math.abs(oracle.score - 129.4) < 1e-9);

    for (const r of [solveLineup({ players, cap: 40000, method: "exact-dp" }), optimizeLineup({ players, cap: 40000 })]) {
      const ok = expectOk(r);
      assert.equal(ok.method, "exact-dp");
      assert.equal(ok.optimality, "proven");
      assert.equal(ok.fallbackReason, undefined);
      assert.deepEqual(
        ok.lineup.players.map((p) => Number(p.id)).sort((a, b) => a - b),
        [1, 2, 4, 5, 6, 7, 8, 10, 12],
      );
      assert.ok(Math.abs(ok.lineup.proj - 129.4) < 1e-9);
      assert.equal(ok.lineup.salary, 29300);
      assert.equal(ok.lineup.remaining, 10700);
      assert.equal(ok.lineup.slots[7]!.player.pos, "WR");
      assert.equal(validateRoster(ok.lineup.slots, { cap: 40000 }), null);
    }
  });

  it("rejects two locked QBs at a $50,000 cap from every method and the wrapper", () => {
    const players = handoffSlate();
    const req = { players, cap: 50000, locked: ["0", "1"] };
    const results = [...METHODS.map((method) => solveLineup({ ...req, method })), optimizeLineup(req)];
    for (const r of results) {
      assert.ok(r.status === "invalid-input" && r.code === "incompatible-locks", explain(r));
      assert.equal("lineup" in r, false);
    }
  });
});

describe("roster shapes", () => {
  for (const flexPos of ["RB", "WR", "TE"] as const) {
    it(`fills FLEX with a ${flexPos} when that is optimal`, () => {
      const players = roster([
        ["qb", "QB", 10],
        ["dst", "DST", 5],
        ["rb1", "RB", 12],
        ["rb2", "RB", 11],
        ["wr1", "WR", 10],
        ["wr2", "WR", 9],
        ["wr3", "WR", 8],
        ["te1", "TE", 7],
        ["star", flexPos, 20],
        ["rb-decoy", "RB", 1],
        ["wr-decoy", "WR", 1],
        ["te-decoy", "TE", 1],
      ]);
      const exact = expectOracleOptimum({ players, cap: 50000 });
      assert.equal(exact.lineup.slots[7]!.player.pos, flexPos);
      assert.ok(exact.lineup.players.some((p) => p.id === "star"));
    });
  }

  it("reports pools that cannot fill the positions as invalid input, never a lineup", () => {
    const full = handoffSlate();
    const pools: FantasyPlayer[][] = [
      full.filter((p) => p.pos !== "DST"),
      full.filter((p) => p.pos !== "QB"),
      full.filter((p) => !["3", "4"].includes(p.id)),
      full.filter((p) => !["3", "6", "9"].includes(p.id)),
      full.slice(0, 8),
    ];
    for (const players of pools) {
      for (const r of [...METHODS.map((method) => solveLineup({ players, cap: 50000, method })), optimizeLineup({ players, cap: 50000 })]) {
        assert.ok(r.status === "invalid-input" && r.code === "insufficient-pool", explain(r));
      }
    }
  });

  it("proves infeasibility only from exact DP; heuristics report that they found nothing", () => {
    const players = handoffSlate().map((p) => ({ ...p, salary: 6000 }));
    const oracle = exhaustiveBest(players, { cap: 50000, locked: [], excluded: [], requireStack: false });
    assert.equal(oracle.kind, "no-lineup");
    const exact = solveLineup({ players, cap: 50000, method: "exact-dp" });
    assert.equal(exact.status, "infeasible", explain(exact));
    assert.equal(optimizeLineup({ players, cap: 50000 }).status, "infeasible");
    for (const method of HEURISTICS) {
      const r = solveLineup({ players, cap: 50000, method });
      assert.ok(r.status === "error" && r.code === "heuristic-no-lineup", explain(r));
    }
  });

  it("rejects locks over the cap and proves infeasibility when affordable locks leave no room", () => {
    const players = handoffSlate();
    for (const method of METHODS) {
      const r = solveLineup({ players, cap: 10000, locked: ["0", "3"], method });
      assert.ok(r.status === "invalid-input" && r.code === "locks-over-cap", explain(r));
    }
    // Locks cost $28,700; the cheapest completion (QB 1, WR 5, WR 7) adds $6,900.
    const locked = ["9", "10", "11", "3", "4", "6"];
    const req = { players, cap: 35500, locked };
    assert.equal(exhaustiveBest(players, rulesOf(req)).kind, "no-lineup");
    assert.equal(solveLineup({ ...req, method: "exact-dp" }).status, "infeasible");
    for (const method of HEURISTICS) {
      const r = solveLineup({ ...req, method });
      assert.ok(r.status === "error" && r.code === "heuristic-no-lineup", explain(r));
    }
  });

  it("returns nine valid locks as the lineup", () => {
    const players = handoffSlate();
    const locked = ["0", "3", "4", "5", "6", "7", "9", "10", "11"];
    for (const method of METHODS) {
      const r = expectOk(solveLineup({ players, cap: 50000, locked, method }));
      assert.equal(lineupKey(r.lineup.players), [...locked].sort().join(","));
      assert.equal(r.optimality, method === "exact-dp" ? "proven" : "heuristic");
    }
  });

  it("keeps negative projections and picks the least negative forced player", () => {
    const players = [
      ...roster([
        ["qb", "QB", -2],
        ["qb2", "QB", -3.5],
        ["rb1", "RB", 4],
        ["rb2", "RB", -1],
        ["rb3", "RB", -6],
        ["wr1", "WR", 3],
        ["wr2", "WR", -0.5],
        ["wr3", "WR", -2.25],
        ["wr4", "WR", -4],
        ["te1", "TE", -1.75],
        ["te2", "TE", -1.5],
      ]),
      player("dst-bad", "DST", 2500, -4),
      player("dst-worse", "DST", 2000, -5),
    ];
    const exact = expectOracleOptimum({ players, cap: 50000 });
    assert.ok(exact.lineup.proj < 0);
    assert.ok(exact.lineup.players.some((p) => p.id === "dst-bad"));
    assert.ok(exact.lineup.players.some((p) => p.id === "qb"));
  });
});

describe("determinism", () => {
  it("breaks projection ties toward lower salary, then lower ids, for any input order", () => {
    const players = [
      ...roster([
        ["qb", "QB", 10],
        ["dst", "DST", 5],
        ["rb1", "RB", 20],
        ["rb-a", "RB", 10],
        ["rb-b", "RB", 10],
        ["wr1", "WR", 11],
        ["wr2", "WR", 11],
        ["wr3", "WR", 11],
        ["wr4", "WR", 15],
      ]),
      player("te-a", "TE", 5000, 7),
      player("te-b", "TE", 3000, 7),
    ];
    const rng = seeded(7);
    const first = expectOracleOptimum({ players, cap: 50000 });
    const ids = first.lineup.players.map((p) => p.id);
    assert.ok(ids.includes("rb-a") && !ids.includes("rb-b"), ids.join(","));
    assert.ok(ids.includes("te-b") && !ids.includes("te-a"), ids.join(","));
    for (let i = 0; i < 12; i++) {
      const shuffled = rng.shuffle(players);
      for (const method of METHODS) {
        const a = expectOk(solveLineup({ players, cap: 50000, method }));
        const b = expectOk(solveLineup({ players: shuffled, cap: 50000, method }));
        assert.deepEqual(
          b.lineup.slots.map((s) => s.player.id),
          a.lineup.slots.map((s) => s.player.id),
        );
      }
    }
  });

  it("returns the same real-slate lineups for shuffled input", () => {
    const { players, cap } = realSlate();
    const rng = seeded(114);
    const baseline = METHODS.map((method) => expectOk(solveLineup({ players, cap, method })).lineup.slots.map((s) => s.player.id));
    for (let i = 0; i < 3; i++) {
      const shuffled = rng.shuffle(players);
      METHODS.forEach((method, m) => {
        const again = expectOk(solveLineup({ players: shuffled, cap, method }));
        assert.deepEqual(
          again.lineup.slots.map((s) => s.player.id),
          baseline[m],
          method,
        );
      });
    }
  });
});

describe("salary precision contract", () => {
  // QB 9,000 + RB 7,000 x2 + WR 6,000 x2 + TE 5,000 + FLEX RB 5,000 + DST 3,000 = $48,000 before the third WR.
  const core = [
    player("qb", "QB", 9000, 30),
    player("rb1", "RB", 7000, 20),
    player("rb2", "RB", 7000, 20),
    player("rb3", "RB", 5000, 25),
    player("wr1", "WR", 6000, 16),
    player("wr2", "WR", 6000, 16),
    player("te", "TE", 5000, 12),
    player("dst", "DST", 3000, 6),
  ];

  it("counts a $2,050 salary exactly instead of truncating it to $2,000", () => {
    const players = [...core, player("wr-odd", "WR", 2050, 15), player("wr-cheap", "WR", 2000, 14)];
    // With wr-odd the roster costs $50,050; truncating salary/100 would have called that $50,000.
    const exact = expectOracleOptimum({ players, cap: 50000 });
    assert.equal(exact.lineup.salary, 50000);
    assert.ok(exact.lineup.players.some((p) => p.id === "wr-cheap"));
    assert.ok(!exact.lineup.players.some((p) => p.id === "wr-odd"));
    for (const method of HEURISTICS) {
      const r = solveLineup({ players, cap: 50000, method });
      if (r.status === "ok") assert.ok(r.lineup.salary <= 50000, explain(r));
    }
  });

  it("accepts $25 steps up to the 2,000-step grid and can spend the cap to the dollar", () => {
    const players = [...core.map((p) => (p.id === "dst" ? { ...p, salary: 2975 } : p)), player("wr3", "WR", 2025, 15)];
    const exact = expectOracleOptimum({ players, cap: 50000 });
    assert.equal(exact.lineup.salary, 50000);
    const over = solveLineup({ players, cap: 49999, method: "exact-dp" });
    assert.equal(over.status, "infeasible", explain(over));
  });

  it("rejects salary grids finer than the documented bound but allows a small cap in whole dollars", () => {
    const fine = [...core, player("wr-dollar", "WR", 2001, 15)];
    for (const method of METHODS) {
      const r = solveLineup({ players: fine, cap: 50000, method });
      assert.ok(r.status === "invalid-input" && r.code === "salary-precision", explain(r));
    }
    const dollars = handoffSlate().map((p, i) => ({ ...p, salary: 101 + i * 7 }));
    expectOracleOptimum({ players: dollars, cap: 1400 });
    const r = solveLineup({ players: dollars, cap: 2000, method: "exact-dp" });
    assert.equal(r.status, "ok", explain(r));
    const tooFine = solveLineup({ players: dollars, cap: 2001, method: "exact-dp" });
    assert.ok(tooFine.status === "invalid-input" && tooFine.code === "salary-precision", explain(tooFine));
  });
});

describe("heuristic labelling", () => {
  // QB on team A; the best receivers play for B, so the DP optimum is unstacked.
  const stackSlate = () => [
    player("qb-a", "QB", 6000, 20, "A"),
    player("rb1", "RB", 5000, 15, "B"),
    player("rb2", "RB", 5000, 14, "B"),
    player("rb3", "RB", 5000, 3, "B"),
    player("wr1", "WR", 5000, 16, "B"),
    player("wr2", "WR", 5000, 15, "B"),
    player("wr3", "WR", 5000, 14, "B"),
    player("wr4", "WR", 5000, 13, "B"),
    player("wr-a", "WR", 3000, 2, "A"),
    player("te1", "TE", 4000, 10, "B"),
    player("dst", "DST", 3000, 6, "B"),
  ];

  it("labels a stacked hill-climb fallback heuristic and says why", () => {
    const players = stackSlate();
    const exact = solveLineup({ players, cap: 50000, requireStack: true, method: "exact-dp" });
    assert.ok(exact.status === "error" && exact.code === "stack-not-proven", explain(exact));

    const wrapped = expectOk(optimizeLineup({ players, cap: 50000, requireStack: true }));
    assert.equal(wrapped.method, "hill-climb");
    assert.equal(wrapped.optimality, "heuristic");
    assert.ok(wrapped.fallbackReason && wrapped.fallbackReason.length > 0);
    assert.equal(validateRoster(wrapped.lineup.slots, { cap: 50000, requireStack: true }), null);
    const oracle = exhaustiveBest(players, { cap: 50000, locked: [], excluded: [], requireStack: true });
    assert.ok(oracle.kind === "best" && wrapped.lineup.proj <= oracle.score + 1e-6);
  });

  it("keeps a stacked DP optimum proven", () => {
    const players = stackSlate().map((p) => (p.id === "wr1" ? { ...p, team: "A" } : p));
    const wrapped = expectOk(optimizeLineup({ players, cap: 50000, requireStack: true }));
    assert.equal(wrapped.method, "exact-dp");
    assert.equal(wrapped.optimality, "proven");
    assert.equal(wrapped.fallbackReason, undefined);
    expectOracleOptimum({ players, cap: 50000, requireStack: true });
  });

  it("never claims infeasibility when only the heuristic stack search fails", () => {
    const players = stackSlate().filter((p) => p.id !== "wr-a");
    const r = optimizeLineup({ players, cap: 50000, requireStack: true });
    assert.ok(r.status === "error" && r.code === "heuristic-no-lineup", explain(r));
  });

  it("labels every heuristic result on the real slate heuristic", () => {
    const { players, cap } = realSlate();
    for (const method of HEURISTICS) {
      const r = expectOk(solveLineup({ players, cap, method }));
      assert.equal(r.optimality, "heuristic");
      assert.equal(r.method, method);
    }
    const stacked = expectOk(optimizeLineup({ players, cap, requireStack: true }));
    assert.equal(stacked.optimality === "proven", stacked.method === "exact-dp");
    assert.equal(validateRoster(stacked.lineup.slots, { cap, requireStack: true }), null);
  });
});

describe("roster validator", () => {
  const players = handoffSlate();
  const legal = expectOk(solveLineup({ players, cap: 40000, method: "exact-dp" })).lineup.slots;
  const byId = (id: string) => players.find((p) => p.id === id)!;

  it("accepts the solved lineup", () => {
    assert.equal(validateRoster(legal, { cap: 40000, locked: ["8"], excluded: ["0"] }), null);
  });

  it("rejects deliberately illegal lineups with a specific code", () => {
    const withFlex = (p: FantasyPlayer) => legal.map((e, i) => (i === 7 ? { ...e, player: p } : e));
    const cases: [string, Parameters<typeof validateRoster>[0], Parameters<typeof validateRoster>[1]][] = [
      ["roster-size", [...legal, { slot: "FLEX", player: byId("0") }], { cap: 50000 }],
      ["roster-size", legal.slice(0, 8), { cap: 50000 }],
      ["slot-position", withFlex(byId("0")), { cap: 50000 }],
      ["slot-order", [legal[1]!, legal[0]!, ...legal.slice(2)], { cap: 50000 }],
      ["duplicate-player", withFlex(legal[3]!.player), { cap: 50000 }],
      ["over-cap", legal, { cap: 29299 }],
      ["over-cap", withFlex({ ...legal[7]!.player, salary: Number.NaN }), { cap: 50000 }],
      ["missing-lock", legal, { cap: 50000, locked: ["3"] }],
      ["excluded-player", legal, { cap: 50000, excluded: ["7"] }],
      ["missing-stack", legal.map((e) => (e.slot === "QB" ? { ...e, player: { ...e.player, team: "X" } } : e)), { cap: 50000, requireStack: true }],
    ];
    for (const [code, entries, rules] of cases) {
      assert.equal(validateRoster(entries, rules)?.code, code);
    }
  });
});

describe("real slates", () => {
  it("solves the frozen 114-player slate exactly with a legal roster", (t) => {
    const { players, cap } = realSlate();
    const started = performance.now();
    const exact = expectOk(solveLineup({ players, cap, method: "exact-dp" }));
    t.diagnostic(`exact-dp on ${players.length} players: ${(performance.now() - started).toFixed(0)} ms`);
    assert.equal(exact.optimality, "proven");
    assert.ok(isLegalLineup(exact.lineup.players, { cap, locked: [], excluded: [], requireStack: false }));
    assert.equal(validateRoster(exact.lineup.slots, { cap }), null);
    assert.deepEqual(optimizeLineup({ players, cap }), exact);
    for (const method of HEURISTICS) {
      const r = expectOk(solveLineup({ players, cap, method }));
      assert.ok(r.lineup.proj <= exact.lineup.proj + 1e-6, `${method} ${r.lineup.proj} > ${exact.lineup.proj}`);
    }
  });

  it("solves a deterministic 300-player slate exactly with locks and exclusions", (t) => {
    const players = randomPool(seeded(300), 300, { unit: 100, teams: 12 });
    const locked = [players.find((p) => p.pos === "TE")!.id];
    const excluded = players.filter((p) => p.proj > 25 && !locked.includes(p.id)).map((p) => p.id);
    const started = performance.now();
    const exact = expectOk(solveLineup({ players, cap: 50000, locked, excluded, method: "exact-dp" }));
    t.diagnostic(`exact-dp on ${players.length} players: ${(performance.now() - started).toFixed(0)} ms`);
    assert.equal(exact.optimality, "proven");
    assert.ok(isLegalLineup(exact.lineup.players, { cap: 50000, locked, excluded, requireStack: false }));
    for (const method of HEURISTICS) {
      const r = expectOk(solveLineup({ players, cap: 50000, locked, excluded, method }));
      assert.ok(r.lineup.proj <= exact.lineup.proj + 1e-6, method);
    }
  });
});

describe("scoreLineup", () => {
  it("separates players without actuals from players who scored zero", () => {
    const players = handoffSlate().slice(0, 4);
    const actuals = new Map([
      ["0", 12.5],
      ["1", 0],
      ["3", -1],
    ]);
    assert.deepEqual(scoreLineup(players, actuals), { pts: 11.5, n: 3, missing: ["2"] });
  });
});
