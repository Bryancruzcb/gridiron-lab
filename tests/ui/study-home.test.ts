import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { axisPercent, buildStudyHome } from "../../src/components/study/home.ts";
import type { StudySeasonsFile } from "../../src/data/types.ts";

const study = JSON.parse(readFileSync(new URL("../../src/data/study-seasons.json", import.meta.url), "utf8")) as StudySeasonsFile;

function ready() {
  const state = buildStudyHome(study);
  assert.equal(state.kind, "ready");
  if (state.kind !== "ready") throw new Error("unreachable");
  return state.home;
}

test("methods are ranked by pooled player MAE, best first, and cover every exact-solver model", () => {
  const home = ready();
  const exact = study.models.filter((m) => m.solver === "exact-dp").map((m) => m.id);
  assert.deepEqual([...home.methods.map((m) => m.id)].sort(), [...exact].sort());
  for (let i = 1; i < home.methods.length; i++) assert.ok(home.methods[i - 1]!.mae <= home.methods[i]!.mae);
  assert.equal(home.best, home.methods[0]);
  assert.equal(home.methods.find((m) => m.id === "trail")!.gap, null);
});

test("the miss chart has the pooled view, each season and the shipped slate, each with its own winner", () => {
  const home = ready();
  assert.deepEqual(
    home.views.map((v) => v.key),
    ["pool", ...study.seasons.map((s) => String(s.season)), ...(study.shippedSlate ? ["shipped"] : [])],
  );
  for (const v of home.views) {
    const lowest = Math.min(...Object.values(v.mae));
    assert.equal(v.mae[v.bestId], lowest, `${v.key} best`);
  }
  assert.equal(home.bestEverywhere, home.views.every((v) => v.bestId === home.best.id));
});

test("every value on the miss chart sits inside its axis", () => {
  const home = ready();
  for (const v of home.views) {
    for (const mae of Object.values(v.mae)) {
      const at = axisPercent(mae, home.scale);
      assert.ok(at >= 0 && at <= 100, `${v.key} ${mae} at ${at}%`);
    }
  }
  assert.ok(home.scale.ticks.every((t) => t > home.scale.lo && t < home.scale.hi));
});

test("no seasons is the empty state", () => {
  assert.deepEqual(buildStudyHome({ ...study, seasons: [] }), { kind: "empty" });
  assert.deepEqual(buildStudyHome(null), { kind: "empty" });
});

test("a missing model is the error state, not a thrown exception", () => {
  const broken: StudySeasonsFile = {
    ...study,
    pools: study.pools.map((p) => ({ ...p, summary: { ...p.summary, models: p.summary.models.filter((m) => m.model !== "shrink") } })),
  };
  const state = buildStudyHome(broken);
  assert.equal(state.kind, "error");
  if (state.kind === "error") assert.match(state.message, /shrink/);
});
