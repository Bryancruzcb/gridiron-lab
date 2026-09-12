import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SELECTION_IDS,
  actualsVersion,
  emptySelection,
  fingerprintOf,
  parseSelection,
  planCompare,
  planLineup,
  slateId,
  stableStringify,
  toggleExclude,
  toggleLock,
} from "../../src/lib/lineup/selection.ts";
import type { LineupSelection } from "../../src/lib/lineup/selection.ts";
import { realSlate } from "../domain/support/players.ts";

const SLATE = "fantasy-test";
const slate = realSlate();
const pool = slate.players;

function select(patch: Partial<LineupSelection>): LineupSelection {
  return { ...emptySelection(SLATE), ...patch };
}

/** Deterministic actuals for every player except the listed ids. */
function actualsWithout(missing: string[] = []): Map<string, number> {
  return new Map(pool.filter((p) => !missing.includes(p.id)).map((p, i) => [p.id, Math.round(p.proj * (0.5 + (i % 7) / 6) * 10) / 10]));
}

const qb = pool.find((p) => p.pos === "QB")!;
const wr = pool.find((p) => p.pos === "WR")!;

describe("selection edits", () => {
  it("locking a benched player un-benches him, and benching a locked player unlocks him", () => {
    let s = toggleExclude(emptySelection(SLATE), qb.id);
    assert.deepEqual([s.locked, s.excluded], [[], [qb.id]]);
    s = toggleLock(s, qb.id);
    assert.deepEqual([s.locked, s.excluded], [[qb.id], []]);
    s = toggleExclude(s, qb.id);
    assert.deepEqual([s.locked, s.excluded], [[], [qb.id]]);
  });

  it("keeps ids sorted and unique, and toggling twice restores the selection exactly", () => {
    const base = select({ locked: [qb.id], excluded: [wr.id], stack: true });
    const ids = ["zz", "aa", "mm"];
    let s = base;
    for (const id of ids) s = toggleLock(s, id);
    assert.deepEqual(s.locked, [...base.locked, ...ids].sort());
    for (const id of ids) s = toggleLock(s, id);
    assert.deepEqual(s, base);
  });
});

describe("parseSelection", () => {
  it("accepts a valid selection and canonicalizes id order and duplicates", () => {
    const raw = { version: 1, slate: SLATE, mode: "actual", locked: ["b", "a", "b"], excluded: ["c"], stack: true };
    const parsed = parseSelection(raw, SLATE);
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.selection, { version: 1, slate: SLATE, mode: "actual", locked: ["a", "b"], excluded: ["c"], stack: true });
    assert.deepEqual(parsed.warnings, []);
  });

  it("rejects a lock/bench overlap, names the ids and picks no winner", () => {
    const parsed = parseSelection({ version: 1, slate: SLATE, mode: "proj", locked: ["x", "y"], excluded: ["y", "x", "z"], stack: false }, SLATE);
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    const overlap = parsed.issues.find((i) => i.code === "lock-exclude-overlap");
    assert.deepEqual(overlap?.ids, ["x", "y"]);
    assert.match(overlap!.message, /2 players are both locked and benched/);
  });

  it("reports every malformed field at once", () => {
    const parsed = parseSelection({ version: 1, slate: "", mode: "forecast", locked: "qb", excluded: [3], stack: "yes" }, SLATE);
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.equal(parsed.issues.length, 5);
    assert.ok(parsed.issues.every((i) => i.code === "malformed"));
  });

  it("rejects non-objects, unsupported versions and oversized id lists", () => {
    for (const raw of [null, "{}", [], 7, undefined]) assert.equal(parseSelection(raw, SLATE).ok, false);
    const v2 = parseSelection({ version: 2, slate: SLATE, mode: "proj", locked: [], excluded: [], stack: false }, SLATE);
    assert.ok(!v2.ok && v2.issues[0]!.code === "unsupported-version");
    const many = Array.from({ length: MAX_SELECTION_IDS + 1 }, (_, i) => `id${i}`);
    const big = parseSelection({ version: 1, slate: SLATE, mode: "proj", locked: [], excluded: many, stack: false }, SLATE);
    assert.ok(!big.ok && big.issues[0]!.code === "too-many-ids");
  });

  it("applies a selection made for another slate but says so", () => {
    const parsed = parseSelection({ version: 1, slate: "fantasy-old", mode: "proj", locked: ["gone"], excluded: [], stack: false }, SLATE);
    assert.ok(parsed.ok);
    assert.equal(parsed.selection.slate, "fantasy-old");
    assert.equal(parsed.warnings[0]?.code, "slate-mismatch");
  });

  it("round-trips a selection through JSON unchanged", () => {
    const s = select({ mode: "actual", locked: [qb.id], excluded: [wr.id], stack: true });
    const parsed = parseSelection(JSON.parse(JSON.stringify(s)), SLATE);
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.selection, s);
  });
});

describe("fingerprints", () => {
  it("stableStringify does not depend on key order", () => {
    assert.equal(stableStringify({ b: 1, a: [1, { d: 2, c: 3 }] }), stableStringify({ a: [1, { c: 3, d: 2 }], b: 1 }));
    assert.notEqual(fingerprintOf({ a: 1 }), fingerprintOf({ a: 2 }));
  });

  it("a plan fingerprint ignores pool order but changes with every solve input", () => {
    const data = { players: pool, cap: slate.cap, actuals: null };
    const s = select({ locked: [qb.id], excluded: [wr.id] });
    const base = planLineup(s, data).fingerprint;
    assert.equal(planLineup(s, { ...data, players: pool.slice().reverse() }).fingerprint, base);
    assert.equal(planLineup(s, { ...data, players: pool.map((p) => ({ ...p, name: p.name.toUpperCase(), headshot: null })) }).fingerprint, base);
    const variants = [
      planLineup({ ...s, stack: true }, data),
      planLineup({ ...s, locked: [] }, data),
      planLineup({ ...s, excluded: [] }, data),
      planLineup(s, { ...data, cap: slate.cap - 100 }),
      planLineup(s, { ...data, players: pool.map((p) => (p.id === wr.id ? p : p.id === qb.id ? { ...p, proj: p.proj + 0.01 } : p)) }),
    ];
    for (const v of variants) assert.notEqual(v.fingerprint, base);
    assert.equal(new Set(variants.map((v) => v.fingerprint)).size, variants.length);
  });

  it("slateId and actualsVersion identify the data, not its order or display fields", () => {
    const id = slateId(2025, pool, slate.cap);
    assert.match(id, /^fantasy-2025-[0-9a-z]+$/);
    assert.equal(slateId(2025, pool.slice().reverse(), slate.cap), id);
    assert.notEqual(slateId(2025, pool.map((p, i) => (i === 0 ? { ...p, salary: p.salary + 100 } : p)), slate.cap), id);
    const a = actualsWithout();
    assert.equal(actualsVersion(new Map([...a].reverse())), actualsVersion(a));
    assert.notEqual(actualsVersion(new Map([...a].map(([k, v], i) => [k, i === 0 ? v + 1 : v]))), actualsVersion(a));
    assert.equal(actualsVersion(null), null);
  });
});

describe("planLineup", () => {
  it("projection mode sends the locks, exclusions and stack with the full pool", () => {
    const plan = planLineup(select({ locked: [qb.id], excluded: [wr.id], stack: true }), { players: pool, cap: slate.cap, actuals: null });
    assert.ok(plan.ok);
    assert.equal(plan.job.players.length, pool.length);
    assert.deepEqual([plan.job.locked, plan.job.excluded, plan.job.requireStack, plan.job.mode], [[qb.id], [wr.id], true, "proj"]);
  });

  it("hindsight solves the scored players at their actual points", () => {
    const missing = pool.filter((p) => p.pos === "RB").slice(0, 3).map((p) => p.id);
    const actuals = actualsWithout(missing);
    const plan = planLineup(select({ mode: "actual" }), { players: pool, cap: slate.cap, actuals });
    assert.ok(plan.ok);
    assert.equal(plan.job.players.length, pool.length - missing.length);
    for (const p of plan.job.players) assert.equal(p.proj, actuals.get(p.id));
  });

  it("keeps a lock without an actual score as a specific blocking issue instead of dropping it", () => {
    const actuals = actualsWithout([qb.id]);
    const s = select({ mode: "actual", locked: [qb.id], stack: true });
    const plan = planLineup(s, { players: pool, cap: slate.cap, actuals });
    assert.equal(plan.ok, false);
    if (plan.ok) return;
    assert.deepEqual(plan.issues.map((i) => [i.code, i.ids]), [["lock-unscored", [qb.id]]]);
    assert.deepEqual(s.locked, [qb.id]);
    assert.equal(planLineup({ ...s, mode: "proj" }, { players: pool, cap: slate.cap, actuals }).ok, true);
  });

  it("blocks hindsight without actuals and locks that are not on the slate", () => {
    const none = planLineup(select({ mode: "actual" }), { players: pool, cap: slate.cap, actuals: new Map() });
    assert.ok(!none.ok && none.issues[0]!.code === "no-actuals");
    const ghost = planLineup(select({ locked: ["ghost"] }), { players: pool, cap: slate.cap, actuals: null });
    assert.ok(!ghost.ok && ghost.issues[0]!.code === "lock-not-on-slate" && ghost.issues[0]!.ids[0] === "ghost");
  });

  it("drops benched ids that are not in the solved pool from the request", () => {
    const actuals = actualsWithout([wr.id]);
    const plan = planLineup(select({ mode: "actual", excluded: [wr.id, "ghost"] }), { players: pool, cap: slate.cap, actuals });
    assert.ok(plan.ok);
    assert.deepEqual(plan.job.excluded, []);
  });
});

describe("planCompare", () => {
  it("needs week scores and ignores the user's constraints", () => {
    assert.equal(planCompare({ players: pool, cap: slate.cap, actuals: null }), null);
    assert.equal(planCompare({ players: pool, cap: slate.cap, actuals: new Map() }), null);
    const actuals = actualsWithout([qb.id]);
    const plan = planCompare({ players: pool, cap: slate.cap, actuals })!;
    assert.equal(plan.job.players.length, pool.length);
    assert.equal(plan.job.scored.length, pool.length - 1);
    const refreshed = new Map(actuals);
    refreshed.set(wr.id, (refreshed.get(wr.id) ?? 0) + 3);
    assert.notEqual(planCompare({ players: pool, cap: slate.cap, actuals: refreshed })!.fingerprint, plan.fingerprint);
  });
});
