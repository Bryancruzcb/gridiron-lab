import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { defaultParseSearch, defaultStringifySearch } from "@tanstack/router-core";
import {
  decodeOptimizerSearch,
  decodeQbSearch,
  editQb,
  encodeOptimizerSearch,
  encodeQbSearch,
  isEmptySelection,
  MAX_PINS,
  optimizerAnalysisStateSchema,
  qbAnalysisStateSchema,
  selectionKey,
  validateOptimizerSearch,
  validateQbSearch,
  type QbAnalysisState,
} from "../../src/lib/analysis/state.ts";
import { emptySelection, MAX_SELECTION_IDS, type LineupSelection } from "../../src/lib/lineup/selection.ts";

const SEASONS = [2026, 2025, 2024, 2023];

/** What a browser address bar does to a search object: the router's own stringify and parse. */
function throughUrl(search: object): Record<string, unknown> {
  return defaultParseSearch(defaultStringifySearch(search));
}

function qb(patch: Partial<QbAnalysisState> = {}): QbAnalysisState {
  return { season: 2026, down: "all", distance: "all", situation: "all", minPlays: null, sort: "epa", pins: null, ...patch };
}

const codes = (issues: { field: string; code: string }[]) => issues.map((i) => `${i.field}:${i.code}`);

describe("QB URL state", () => {
  it("decodes an empty search to the page defaults with no issues", () => {
    assert.deepEqual(decodeQbSearch({}, { seasons: SEASONS }), { state: qb(), issues: [] });
    assert.deepEqual(decodeQbSearch(null), { state: qb(), issues: [] });
  });

  it("round-trips every field through the router's URL serialization", () => {
    const states = [
      qb({ season: 2025, down: "3", distance: "long", minPlays: 45, sort: "cpoe", pins: ["00-0033873", "00-0036442", "00-0034857"] }),
      qb({ season: 2024, situation: "redzone", sort: "press", pins: [] }),
      qb({ season: 2023, down: "4", minPlays: 12, sort: "comp", pins: ["00-0039851"] }),
      qb(),
    ];
    for (const state of states) {
      const url = defaultStringifySearch(encodeQbSearch(state));
      const back = decodeQbSearch(defaultParseSearch(url), { seasons: SEASONS });
      assert.deepEqual(back, { state, issues: [] }, url);
    }
    assert.equal(defaultStringifySearch(encodeQbSearch(states[0]!)), "?season=2025&down=3&dist=long&min=45&sort=cpoe&pins=00-0033873.00-0036442.00-0034857");
    assert.equal(defaultStringifySearch(encodeQbSearch(states[1]!)), "?season=2024&sit=redzone&sort=press&pins=");
  });

  it("gives bounded defaults and issues for invalid values", () => {
    const { state, issues } = decodeQbSearch(
      throughUrl({ season: "twenty", down: "7", dist: "far", sit: ["x"], sort: "rating", min: "lots" }),
      { seasons: SEASONS },
    );
    assert.deepEqual(state, qb());
    assert.deepEqual(codes(issues), ["season:invalid", "down:invalid", "dist:invalid", "sit:invalid", "sort:invalid", "min:invalid"]);
    assert.deepEqual(codes(decodeQbSearch({ season: 1850 }).issues), ["season:invalid"]);
    assert.deepEqual(codes(decodeQbSearch({ season: 2025.5 }).issues), ["season:invalid"]);
    const missing = decodeQbSearch({ season: 2019 }, { seasons: SEASONS });
    assert.equal(missing.state.season, 2026);
    assert.deepEqual(codes(missing.issues), ["season:unavailable"]);
    assert.match(missing.issues[0]!.message, /no quarterback data for 2019/);
    assert.equal(decodeQbSearch({ season: 2019 }).state.season, 2019, "without a data list any season in range passes");
  });

  it("clamps min dropbacks to the slice's range", () => {
    const high = decodeQbSearch({ season: 2025, down: 3, min: 9999 });
    assert.equal(high.state.minPlays, 160);
    assert.deepEqual(codes(high.issues), ["min:out-of-range"]);
    const low = decodeQbSearch({ season: 2026, min: -4 });
    assert.equal(low.state.minPlays, 5);
    assert.deepEqual(codes(decodeQbSearch({ min: 12.5 }).issues), ["min:invalid"]);
    assert.equal(decodeQbSearch({ season: 2026, min: "20" }).state.minPlays, 20);
  });

  it("clears down and distance when a situation filter is also set", () => {
    const { state, issues } = decodeQbSearch({ season: 2025, down: 3, dist: "short", sit: "redzone" });
    assert.deepEqual([state.down, state.distance, state.situation], ["all", "all", "redzone"]);
    assert.deepEqual(codes(issues), ["sit:conflict"]);
  });

  it("dedupes pins in order, drops non-ids, bounds the list, and reads repeated keys", () => {
    assert.deepEqual(decodeQbSearch(throughUrl({ pins: "b.a.b.c" })).state.pins, ["b", "a", "c"]);
    const dirty = decodeQbSearch({ pins: "a.<script>..b" });
    assert.deepEqual(dirty.state.pins, ["a", "b"]);
    assert.deepEqual(codes(dirty.issues), ["pins:invalid"]);
    const many = decodeQbSearch({ pins: "a.b.c.d.e.f" });
    assert.deepEqual(many.state.pins, ["a", "b", "c", "d"]);
    assert.deepEqual(codes(many.issues), ["pins:too-many"]);
    const huge = decodeQbSearch(throughUrl({ pins: Array.from({ length: 5000 }, (_, i) => `00-${i}`).join(".") }));
    assert.equal(huge.state.pins, null, "an oversized list falls back to the default pins");
    assert.deepEqual(codes(huge.issues), ["pins:too-many"]);
    assert.deepEqual(decodeQbSearch(defaultParseSearch("?pins=00-1&pins=00-2")).state.pins, ["00-1", "00-2"]);
    assert.deepEqual(decodeQbSearch(throughUrl({ pins: "" })).state.pins, []);
    assert.deepEqual(decodeQbSearch({ pins: 4038941 }).state.pins, ["4038941"]);
    assert.deepEqual(codes(decodeQbSearch({ pins: { a: 1 } }).issues), ["pins:invalid"]);
  });

  it("validateSearch returns canonical values and leaves values with an issue out", () => {
    assert.deepEqual(validateQbSearch({ season: 2025, down: "3", sort: "nope", pins: "x.x" }), { season: 2025, down: 3, pins: "x" });
    assert.deepEqual(validateQbSearch({}), { season: 2026 });
    assert.deepEqual(validateQbSearch({ season: "abc", min: 99999, down: 2 }), { down: 2 }, "the router keeps the raw values, so the page can report them");
    assert.deepEqual(validateQbSearch({ season: 2025, down: 3, sit: "redzone" }), { season: 2025 });
  });

  it("the saved-state schema accepts complete states and rejects repeats and bad enums", () => {
    assert.equal(qbAnalysisStateSchema.safeParse(qb({ pins: ["a", "b"], minPlays: 10 })).success, true);
    assert.equal(qbAnalysisStateSchema.safeParse(qb({ pins: ["a", "a"] })).success, false);
    assert.equal(qbAnalysisStateSchema.safeParse({ ...qb(), down: "5" }).success, false);
    assert.equal(qbAnalysisStateSchema.safeParse(qb({ pins: Array.from({ length: MAX_PINS + 1 }, (_, i) => `p${i}`) })).success, false);
  });
});

describe("QB edits", () => {
  it("a new season resets min and lets default pins follow; a new slice resets min only", () => {
    const start = qb({ season: 2025, minPlays: 90, pins: ["a"], sort: "cpoe" });
    assert.deepEqual(editQb(start, { type: "season", season: 2024 }), { ...start, season: 2024, minPlays: null, pins: null });
    assert.deepEqual(editQb(start, { type: "down", down: "3" }), { ...start, down: "3", minPlays: null });
    const sit = editQb({ ...start, down: "3" }, { type: "situation", situation: "redzone" });
    assert.deepEqual([sit.down, sit.distance, sit.situation, sit.minPlays, sit.pins], ["all", "all", "redzone", null, ["a"]]);
    assert.equal(editQb(start, { type: "down", down: "all" }), start, "clicking the active filter changes nothing");
    assert.equal(editQb(start, { type: "season", season: 2025 }), start);
    assert.deepEqual(editQb(start, { type: "sort", sort: "press" }).pins, ["a"]);
    assert.equal(editQb(start, { type: "min", minPlays: 60 }).minPlays, 60);
    assert.equal(editQb(start, { type: "reset-min" }).minPlays, null);
  });

  it("toggling a pin starts from the explicit pins, else the defaults, and keeps at most four", () => {
    const base = qb();
    assert.deepEqual(editQb(base, { type: "toggle-pin", id: "d", defaults: ["a", "b", "c"] }).pins, ["a", "b", "c", "d"]);
    assert.deepEqual(editQb(base, { type: "toggle-pin", id: "e", defaults: ["a", "b", "c", "d"] }).pins, ["b", "c", "d", "e"]);
    assert.deepEqual(editQb(base, { type: "toggle-pin", id: "b", defaults: ["a", "b"] }).pins, ["a"]);
    assert.deepEqual(editQb(base, { type: "toggle-pin", id: "a", defaults: ["a"] }).pins, []);
    const explicit = qb({ pins: ["x"] });
    assert.deepEqual(editQb(explicit, { type: "toggle-pin", id: "y", defaults: ["a", "b"] }).pins, ["x", "y"], "defaults are ignored once pins are explicit");
    assert.deepEqual(editQb(qb({ pins: [] }), { type: "toggle-pin", id: "y", defaults: ["a"] }).pins, ["y"]);
  });
});

describe("lineup URL state", () => {
  const SLATE = "fantasy-2025-abc";
  const sel = (patch: Partial<LineupSelection>): LineupSelection => ({ ...emptySelection(SLATE), ...patch });

  it("carries no selection when no lineup params are present", () => {
    assert.equal(decodeOptimizerSearch({}, SLATE), null);
    assert.equal(decodeOptimizerSearch({ unrelated: 1 }, SLATE), null);
    assert.deepEqual(validateOptimizerSearch({}, SLATE), {});
  });

  it("round-trips locks, exclusions, stack and mode through the router's URL serialization", () => {
    for (const selection of [
      sel({ mode: "actual", locked: ["00-0036971", "DST-CHI"], excluded: ["00-0034857"], stack: true }),
      sel({ excluded: ["00-0026498"] }),
      sel({}),
    ]) {
      const link = decodeOptimizerSearch(throughUrl(encodeOptimizerSearch(selection)), SLATE);
      assert.ok(link?.parse.ok, JSON.stringify(link));
      assert.deepEqual(link.parse.ok && link.parse.selection, selection);
      assert.equal(link.key, selectionKey(selection));
    }
    assert.equal(
      defaultStringifySearch(encodeOptimizerSearch(sel({ mode: "actual", locked: ["00-0036971", "DST-CHI"], stack: true }))),
      `?slate=${SLATE}&mode=actual&lock=00-0036971.DST-CHI&stack=true`,
    );
    assert.equal(isEmptySelection(sel({})), true);
    assert.equal(isEmptySelection(sel({ stack: true })), false);
  });

  it("gives the same key to the same selection written differently", () => {
    const a = decodeOptimizerSearch({ lock: "b.a.a", stack: "1" }, SLATE)!;
    const b = decodeOptimizerSearch({ slate: SLATE, lock: ["a", "b"], stack: true, mode: "proj" }, SLATE)!;
    assert.equal(a.key, b.key);
  });

  it("reports conflicts, oversized lists and unknown values instead of resolving them", () => {
    const conflict = decodeOptimizerSearch(throughUrl({ lock: "a.b", bench: "b" }), SLATE)!;
    assert.equal(conflict.parse.ok, false);
    assert.deepEqual(!conflict.parse.ok && conflict.parse.issues.map((i) => i.code), ["lock-exclude-overlap"]);
    assert.match(conflict.key, /^invalid:/);

    const huge = decodeOptimizerSearch(throughUrl({ lock: Array.from({ length: MAX_SELECTION_IDS + 1 }, (_, i) => `00-${i}`).join(".") }), SLATE)!;
    assert.deepEqual(!huge.parse.ok && huge.parse.issues.map((i) => i.code), ["too-many-ids"]);

    const mode = decodeOptimizerSearch({ mode: "dream" }, SLATE)!;
    assert.deepEqual(!mode.parse.ok && mode.parse.issues.map((i) => i.code), ["malformed"]);
    const stack = decodeOptimizerSearch({ stack: "maybe" }, SLATE)!;
    assert.equal(stack.parse.ok, false);
    const empty = decodeOptimizerSearch({ lock: "a..b" }, SLATE)!;
    assert.equal(empty.parse.ok, false, "an empty id segment is malformed");
    const object = decodeOptimizerSearch(throughUrl({ bench: { x: 1 } }), SLATE)!;
    assert.equal(object.parse.ok, false);
    assert.deepEqual(validateOptimizerSearch({ lock: "a", bench: "a" }, SLATE), {});
  });

  it("warns when a link was made for another slate", () => {
    const link = decodeOptimizerSearch({ slate: "fantasy-2024-old", lock: "a" }, SLATE)!;
    assert.ok(link.parse.ok);
    assert.deepEqual(link.parse.warnings.map((w) => w.code), ["slate-mismatch"]);
  });

  it("the saved-state schema is parseSelection", () => {
    assert.equal(optimizerAnalysisStateSchema.safeParse(sel({ locked: ["a"] })).success, true);
    assert.equal(optimizerAnalysisStateSchema.safeParse(sel({ locked: ["a"], excluded: ["a"] })).success, false);
    assert.equal(optimizerAnalysisStateSchema.safeParse({ ...sel({}), version: 2 }).success, false);
    const parsed = optimizerAnalysisStateSchema.safeParse({ ...sel({}), locked: ["b", "a", "a"] });
    assert.deepEqual(parsed.success && parsed.data.locked, ["a", "b"]);
  });
});
