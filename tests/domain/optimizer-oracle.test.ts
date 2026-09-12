import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { optimizeLineup, solveLineup } from "../../src/lib/optimizer.ts";
import type { SolveResult, SolverMethod } from "../../src/lib/optimizer.ts";
import { exhaustiveBest, isLegalLineup, lineupKey } from "./support/oracle.ts";
import type { OracleAnswer, OracleRules } from "./support/oracle.ts";
import { seeded } from "./support/prng.ts";
import { randomCase } from "./support/slates.ts";
import type { GeneratedCase } from "./support/slates.ts";

const SEED = 20260912;
const CASE_COUNT = 400;
const TOL = 1e-6;
const METHODS: SolverMethod[] = ["exact-dp", "hill-climb", "greedy-proj", "greedy-value"];
const SLOT_ORDER = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "DST"];
// Validator codes that are only allowed when no legal roster exists at all.
const NO_ROSTER_CODES = new Set(["incompatible-locks", "locks-over-cap", "insufficient-pool"]);

type Prepared = {
  c: GeneratedCase;
  rules: OracleRules;
  /** Oracle under the requested rules (stack included). */
  oracle: OracleAnswer;
  /** Oracle without the stack requirement. */
  loose: OracleAnswer;
};

const rng = seeded(SEED);
const PREPARED: Prepared[] = Array.from({ length: CASE_COUNT }, (_, i) => {
  const c = randomCase(rng, i);
  const rules: OracleRules = { cap: c.cap, locked: c.locked, excluded: c.excluded, requireStack: c.requireStack };
  const oracle = exhaustiveBest(c.players, rules);
  const loose = c.requireStack ? exhaustiveBest(c.players, { ...rules, requireStack: false }) : oracle;
  return { c, rules, oracle, loose };
});

function explain(label: string, r: SolveResult) {
  return `${label}: ${r.status === "ok" ? `${r.method} ${r.optimality} ${r.lineup.proj} [${lineupKey(r.lineup.players)}]` : `${r.status}/${r.code} ${r.message}`}`;
}

function assertLegal(p: Prepared, r: SolveResult, where: string) {
  if (r.status !== "ok") return;
  assert.ok(isLegalLineup(r.lineup.players, p.rules), `illegal lineup ${where}`);
  assert.deepEqual(
    r.lineup.slots.map((s) => s.slot),
    SLOT_ORDER,
    where,
  );
  assert.ok(Math.abs(r.lineup.proj - r.lineup.players.reduce((s, x) => s + x.proj, 0)) <= TOL, where);
}

/** Failure shapes allowed when no roster at all can be built. */
function assertNoRoster(r: SolveResult, where: string, allowed: "infeasible" | "heuristic-no-lineup") {
  if (r.status === "invalid-input") assert.ok(NO_ROSTER_CODES.has(r.code), where);
  else if (allowed === "infeasible") assert.equal(r.status, "infeasible", where);
  else assert.ok(r.status === "error" && r.code === "heuristic-no-lineup", where);
}

describe(`optimizer vs exhaustive oracle (${CASE_COUNT} slates, seed ${SEED})`, () => {
  it("exact DP matches the oracle's status and optimum", () => {
    for (const p of PREPARED) {
      const { c, oracle, loose } = p;
      const r = solveLineup({ ...p.rules, players: c.players, method: "exact-dp" });
      const where = explain(c.label, r);
      if (oracle.kind === "malformed") {
        assert.equal(r.status, "invalid-input", where);
      } else if (loose.kind === "no-lineup") {
        assertNoRoster(r, where, "infeasible");
      } else if (oracle.kind === "no-lineup") {
        assert.ok(r.status === "error" && r.code === "stack-not-proven", where);
      } else if (oracle.kind === "best") {
        if (c.requireStack && r.status === "error") {
          assert.equal(r.code, "stack-not-proven", where);
          continue;
        }
        assert.equal(r.status, "ok", where);
        assert.ok(r.status === "ok" && r.method === "exact-dp" && r.optimality === "proven", where);
        assert.ok(Math.abs(r.lineup.proj - oracle.score) <= TOL, `${where} oracle ${oracle.score}`);
        assert.ok(oracle.optimal.has(lineupKey(r.lineup.players)), `${where} not among oracle optima`);
        assertLegal(p, r, where);
      }
    }
  });

  it("heuristics return legal labelled lineups and never claim infeasibility", () => {
    for (const p of PREPARED) {
      const { c, oracle, loose } = p;
      for (const method of METHODS.slice(1)) {
        const r = solveLineup({ ...p.rules, players: c.players, method });
        const where = explain(`${c.label} ${method}`, r);
        assert.notEqual(r.status, "infeasible", where);
        if (oracle.kind === "malformed") {
          assert.equal(r.status, "invalid-input", where);
        } else if (loose.kind === "no-lineup") {
          assertNoRoster(r, where, "heuristic-no-lineup");
        } else if (r.status !== "ok") {
          assert.ok(r.status === "error" && r.code === "heuristic-no-lineup", where);
        } else {
          assert.equal(oracle.kind, "best", where);
          assert.ok(r.method === method && r.optimality === "heuristic" && r.fallbackReason === undefined, where);
          assert.ok(oracle.kind === "best" && r.lineup.proj <= oracle.score + TOL, where);
          assertLegal(p, r, where);
        }
      }
    }
  });

  it("the wrapper is proven only when exact, and labels its stack fallback", () => {
    for (const p of PREPARED) {
      const { c, oracle, loose } = p;
      const r = optimizeLineup({ ...p.rules, players: c.players });
      const where = explain(`${c.label} wrapper`, r);
      if (oracle.kind === "malformed") {
        assert.equal(r.status, "invalid-input", where);
      } else if (loose.kind === "no-lineup") {
        assertNoRoster(r, where, "infeasible");
      } else if (oracle.kind === "no-lineup") {
        assert.ok(r.status === "error" && r.code === "heuristic-no-lineup", where);
      } else if (oracle.kind === "best") {
        if (!c.requireStack) assert.ok(r.status === "ok" && r.optimality === "proven", where);
        if (r.status !== "ok") {
          assert.ok(r.status === "error" && r.code === "heuristic-no-lineup", where);
          continue;
        }
        if (r.optimality === "proven") {
          assert.ok(r.method === "exact-dp" && r.fallbackReason === undefined, where);
          assert.ok(Math.abs(r.lineup.proj - oracle.score) <= TOL, where);
          assert.ok(oracle.optimal.has(lineupKey(r.lineup.players)), where);
        } else {
          assert.ok(r.method === "hill-climb" && (r.fallbackReason ?? "").length > 0, where);
          assert.ok(r.lineup.proj <= oracle.score + TOL, where);
        }
        assertLegal(p, r, where);
      }
    }
  });

  it("gives identical answers for permuted players, locks and exclusions", () => {
    const shuffler = seeded(SEED + 1);
    const summary = (r: SolveResult) =>
      r.status === "ok" ? `${r.method}:${r.lineup.slots.map((s) => s.player.id).join(",")}` : `${r.status}:${r.code}`;
    for (const p of PREPARED) {
      const permuted = {
        ...p.rules,
        players: shuffler.shuffle(p.c.players),
        locked: shuffler.shuffle(p.c.locked),
        excluded: shuffler.shuffle(p.c.excluded),
      };
      for (const method of METHODS) {
        const a = solveLineup({ ...p.rules, players: p.c.players, method });
        const b = solveLineup({ ...permuted, method });
        assert.equal(summary(b), summary(a), `${p.c.label} ${method}`);
      }
    }
  });

  it("covers every outcome the comparisons depend on", () => {
    const counts = {
      malformed: 0,
      noRoster: 0,
      noStack: 0,
      best: 0,
      ties: 0,
      stacked: 0,
      negativeOptimum: 0,
      stackFallback: 0,
      stackProven: 0,
    };
    const flex = new Set<string>();
    for (const p of PREPARED) {
      if (p.oracle.kind === "malformed") counts.malformed++;
      else if (p.loose.kind === "no-lineup") counts.noRoster++;
      else if (p.oracle.kind === "no-lineup") counts.noStack++;
      if (p.oracle.kind !== "best") continue;
      if (p.c.requireStack) {
        const w = optimizeLineup({ ...p.rules, players: p.c.players });
        if (w.status === "ok" && w.optimality === "heuristic") counts.stackFallback++;
        if (w.status === "ok" && w.optimality === "proven") counts.stackProven++;
      }
      counts.best++;
      if (p.oracle.optimal.size > 1) counts.ties++;
      if (p.c.requireStack) counts.stacked++;
      const r = solveLineup({ ...p.rules, players: p.c.players, method: "exact-dp" });
      if (r.status === "ok") {
        flex.add(r.lineup.slots[7]!.player.pos);
        if (r.lineup.players.some((x) => x.proj < 0)) counts.negativeOptimum++;
      }
    }
    for (const [name, n] of Object.entries(counts)) assert.ok(n > 0, `no generated case for ${name}`);
    assert.deepEqual([...flex].sort(), ["RB", "TE", "WR"]);
  });
});
