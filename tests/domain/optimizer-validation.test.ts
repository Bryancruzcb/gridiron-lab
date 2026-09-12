import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { FantasyPlayer, FantasyPos } from "../../src/data/types.ts";
import { optimizeLineup, solveLineup } from "../../src/lib/optimizer.ts";
import type { SolveResult, SolverMethod } from "../../src/lib/optimizer.ts";
import { handoffSlate } from "./support/players.ts";

const METHODS: SolverMethod[] = ["exact-dp", "hill-climb", "greedy-proj", "greedy-value"];

type Case = {
  name: string;
  code: string;
  players?: (base: FantasyPlayer[]) => FantasyPlayer[];
  cap?: number;
  locked?: string[];
  excluded?: string[];
};

const edit = (id: string, patch: Partial<FantasyPlayer>) => (base: FantasyPlayer[]) =>
  base.map((p) => (p.id === id ? { ...p, ...patch } : p));

const CASES: Case[] = [
  { name: "zero cap", code: "invalid-cap", cap: 0 },
  { name: "negative cap", code: "invalid-cap", cap: -50000 },
  { name: "NaN cap", code: "invalid-cap", cap: Number.NaN },
  { name: "infinite cap", code: "invalid-cap", cap: Infinity },
  { name: "duplicate id", code: "duplicate-player-id", players: (b) => [...b, { ...b[4]!, name: "copy" }] },
  { name: "unknown position", code: "invalid-position", players: edit("9", { pos: "K" as FantasyPos }) },
  { name: "fractional salary", code: "invalid-salary", players: edit("5", { salary: 2100.5 }) },
  { name: "zero salary", code: "invalid-salary", players: edit("5", { salary: 0 }) },
  { name: "negative salary", code: "invalid-salary", players: edit("5", { salary: -2100 }) },
  { name: "NaN salary", code: "invalid-salary", players: edit("5", { salary: Number.NaN }) },
  { name: "NaN projection", code: "non-finite-projection", players: edit("7", { proj: Number.NaN }) },
  { name: "infinite projection", code: "non-finite-projection", players: edit("7", { proj: -Infinity }) },
  { name: "lock and exclude the same player", code: "lock-exclude-overlap", locked: ["4"], excluded: ["4"] },
  { name: "lock a player not in the pool", code: "unknown-lock", locked: ["99"] },
  { name: "two locked QBs", code: "incompatible-locks", locked: ["0", "1"] },
  { name: "two locked DSTs", code: "incompatible-locks", locked: ["11", "12"] },
  { name: "three RBs and four WRs locked", code: "incompatible-locks", locked: ["2", "3", "4", "5", "6", "7", "8"] },
  { name: "two TEs and three RBs locked", code: "incompatible-locks", locked: ["9", "10", "2", "3", "4"] },
  { name: "locks over the cap", code: "locks-over-cap", cap: 10000, locked: ["0", "3"] },
  { name: "both DSTs excluded", code: "insufficient-pool", excluded: ["11", "12"] },
  { name: "both TEs excluded", code: "insufficient-pool", excluded: ["9", "10"] },
  { name: "one-dollar salary grid", code: "salary-precision", players: edit("5", { salary: 2101 }) },
];

function run(c: Case): SolveResult[] {
  const base = handoffSlate();
  const req = {
    players: c.players ? c.players(base) : base,
    cap: c.cap ?? 50000,
    locked: c.locked,
    excluded: c.excluded,
  };
  return [...METHODS.map((method) => solveLineup({ ...req, method })), optimizeLineup(req)];
}

describe("input validation runs before every solver", () => {
  for (const c of CASES) {
    it(`${c.name} -> ${c.code}`, () => {
      for (const r of run(c)) {
        if (r.status !== "invalid-input") assert.fail(r.status === "ok" ? `got a ${r.method} lineup` : `${r.status}/${r.code}`);
        assert.equal(r.code, c.code);
        assert.ok(r.message.length > 0);
      }
    });
  }

  it("ignores exclusions of players who are not in the pool", () => {
    for (const r of run({ name: "unknown exclusion", code: "", excluded: ["99"] })) {
      assert.equal(r.status, "ok");
    }
  });

  it("does not reorder or mutate the caller's pool", () => {
    const players = handoffSlate().reverse();
    const before = JSON.stringify(players);
    solveLineup({ players, cap: 40000, locked: new Set(["8"]), excluded: ["0"], method: "exact-dp" });
    assert.equal(JSON.stringify(players), before);
  });
});
