import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createAnalysisStore,
  MAX_NAME_LENGTH,
  MAX_SAVED_ANALYSES,
  normalizeName,
  SAVED_ANALYSES_KEY,
  type StorageLike,
} from "../../src/lib/analysis/storage.ts";
import type { QbAnalysisState } from "../../src/lib/analysis/state.ts";
import { emptySelection } from "../../src/lib/lineup/selection.ts";

type Mode = "ok" | "deny-read" | "deny-write" | "quota";

class FakeStorage implements StorageLike {
  data = new Map<string, string>();
  mode: Mode = "ok";
  writes = 0;
  getItem(key: string) {
    if (this.mode === "deny-read") throw Object.assign(new Error("denied"), { name: "SecurityError" });
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.mode === "deny-write" || this.mode === "deny-read") throw Object.assign(new Error("denied"), { name: "SecurityError" });
    if (this.mode === "quota") throw Object.assign(new Error("full"), { name: "QuotaExceededError", code: 22 });
    this.writes++;
    this.data.set(key, value);
  }
  removeItem(key: string) {
    if (this.mode === "deny-read") throw Object.assign(new Error("denied"), { name: "SecurityError" });
    this.data.delete(key);
  }
}

const qbState: QbAnalysisState = {
  season: 2025,
  down: "3",
  distance: "all",
  situation: "all",
  minPlays: 40,
  sort: "cpoe",
  pins: ["00-0033873", "00-0036442"],
};

function clock() {
  let t = Date.parse("2026-09-12T10:00:00.000Z");
  let n = 0;
  return { now: () => new Date((t += 1000)), newId: () => `id-${++n}` };
}

function fixture() {
  const storage = new FakeStorage();
  const c = clock();
  return { storage, store: createAnalysisStore({ storage, ...c }), reopen: () => createAnalysisStore({ storage, ...clock() }) };
}

function ok<T>(r: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T {
  if (!r.ok) assert.fail(`${r.error.code}: ${r.error.message}`);
  return r.value;
}

describe("saved analyses: save, list, open, rename, delete", () => {
  it("round-trips both kinds and survives a new store on the same storage (a reload)", () => {
    const { store, reopen } = fixture();
    const qb = ok(store.save({ kind: "qb", name: "  Third down  2025 ", state: qbState, datasetRef: "qb:2025" }));
    assert.equal(qb.name, "Third down 2025");
    assert.equal(qb.schemaVersion, 1);
    const selection = { ...emptySelection("fantasy-2025-x"), locked: ["00-0036971"], stack: true };
    const lineup = ok(store.save({ kind: "optimizer", name: "Stack", state: selection, datasetRef: "fantasy-2025-x" }));
    assert.deepEqual(lineup.state, selection);

    const again = reopen();
    assert.deepEqual(ok(again.list("qb")).analyses.map((a) => a.id), [qb.id]);
    assert.deepEqual(ok(again.list("optimizer")).analyses.map((a) => a.id), [lineup.id]);
    assert.deepEqual(ok(again.open("qb", qb.id)).state, qbState);
    assert.equal(again.open("optimizer", qb.id).ok, false, "open checks the kind");
  });

  it("lists newest first, renames with a new updatedAt, and deletes", () => {
    const { store } = fixture();
    const a = ok(store.save({ kind: "qb", name: "A", state: qbState }));
    const b = ok(store.save({ kind: "qb", name: "B", state: qbState }));
    assert.deepEqual(ok(store.list("qb")).analyses.map((x) => x.name), ["B", "A"]);
    const renamed = ok(store.rename("qb", a.id, "A renamed"));
    assert.equal(renamed.createdAt, a.createdAt);
    assert.ok(renamed.updatedAt > a.updatedAt);
    assert.deepEqual(ok(store.list("qb")).analyses.map((x) => x.name), ["A renamed", "B"]);
    ok(store.delete(b.id));
    assert.deepEqual(ok(store.list("qb")).analyses.map((x) => x.id), [a.id]);
    assert.equal(store.delete(b.id).ok, false);
    const gone = store.rename("qb", b.id, "x");
    assert.equal(!gone.ok && gone.error.code, "not-found");
  });

  it("rejects empty or overlong names and invalid state without writing", () => {
    const { store, storage } = fixture();
    for (const name of ["", "   ", "\u0000\u0007", "x".repeat(MAX_NAME_LENGTH + 1)]) {
      const r = store.save({ kind: "qb", name, state: qbState });
      assert.equal(!r.ok && r.error.code, "invalid-name", JSON.stringify(name));
    }
    const badQb = store.save({ kind: "qb", name: "bad", state: { ...qbState, down: "9" } });
    assert.equal(!badQb.ok && badQb.error.code, "invalid-state");
    const overlap = { ...emptySelection("s"), locked: ["a"], excluded: ["a"] };
    const badLineup = store.save({ kind: "optimizer", name: "bad", state: overlap });
    assert.equal(!badLineup.ok && badLineup.error.code, "invalid-state");
    assert.equal(storage.writes, 0);
  });

  it("keeps a hostile name as text; control characters become spaces", () => {
    assert.equal(normalizeName('=HYPERLINK("http://x")\n,"'), '=HYPERLINK("http://x") ,"');
    const { store } = fixture();
    const saved = ok(store.save({ kind: "qb", name: '=cmd|" /C calc"!A0', state: qbState }));
    assert.equal(saved.name, '=cmd|" /C calc"!A0');
  });

  it("stops at the saved-view limit", () => {
    const { store } = fixture();
    for (let i = 0; i < MAX_SAVED_ANALYSES; i++) ok(store.save({ kind: "qb", name: `v${i}`, state: qbState }));
    const r = store.save({ kind: "qb", name: "one more", state: qbState });
    assert.equal(!r.ok && r.error.code, "full");
  });
});

describe("saved analyses: damaged or unavailable storage", () => {
  it("reports invalid JSON, refuses to overwrite it, and clear() recovers", () => {
    const { store, storage } = fixture();
    storage.data.set(SAVED_ANALYSES_KEY, "{not json");
    const listed = store.list("qb");
    assert.equal(!listed.ok && listed.error.code, "corrupt");
    const saved = store.save({ kind: "qb", name: "x", state: qbState });
    assert.equal(!saved.ok && saved.error.code, "corrupt");
    assert.equal(storage.data.get(SAVED_ANALYSES_KEY), "{not json");
    ok(store.clear());
    assert.deepEqual(ok(store.list("qb")).analyses, []);
    ok(store.save({ kind: "qb", name: "x", state: qbState }));
  });

  it("leaves an unsupported schema version untouched", () => {
    const { store, storage } = fixture();
    const future = JSON.stringify({ schemaVersion: 2, analyses: [{ anything: true }] });
    storage.data.set(SAVED_ANALYSES_KEY, future);
    const listed = store.list("optimizer");
    assert.equal(!listed.ok && listed.error.code, "unsupported-version");
    assert.match(!listed.ok ? listed.error.message : "", /version 2/);
    assert.equal(store.save({ kind: "qb", name: "x", state: qbState }).ok, false);
    assert.equal(storage.data.get(SAVED_ANALYSES_KEY), future);
  });

  it("treats a wrong envelope shape as corrupt", () => {
    const { store, storage } = fixture();
    for (const text of ["null", "[]", "42", JSON.stringify({ analyses: [] }), JSON.stringify({ schemaVersion: 1, analyses: {} })]) {
      storage.data.set(SAVED_ANALYSES_KEY, text);
      const r = store.list("qb");
      assert.equal(!r.ok && r.error.code, "corrupt", text);
    }
  });

  it("skips unreadable records but writes them back unchanged", () => {
    const { store, storage } = fixture();
    const good = ok(store.save({ kind: "qb", name: "good", state: qbState }));
    const doc = JSON.parse(storage.data.get(SAVED_ANALYSES_KEY)!);
    const future = { ...good, id: "future", schemaVersion: 2 };
    const broken = { ...good, id: "broken", state: { ...qbState, pins: ["a", "a"] } };
    doc.analyses.push(future, broken, "junk");
    storage.data.set(SAVED_ANALYSES_KEY, JSON.stringify(doc));
    const listed = ok(store.list("qb"));
    assert.deepEqual(listed.analyses.map((a) => a.id), [good.id]);
    assert.equal(listed.skipped, 3);
    ok(store.rename("qb", good.id, "renamed"));
    const after = JSON.parse(storage.data.get(SAVED_ANALYSES_KEY)!);
    assert.deepEqual(after.analyses.slice(1), [future, broken, "junk"]);
  });

  it("reports storage that is missing, denied, or full without throwing", () => {
    const none = createAnalysisStore({ storage: null });
    for (const r of [none.list("qb"), none.save({ kind: "qb", name: "x", state: qbState }), none.clear()])
      assert.equal(!r.ok && r.error.code, "unavailable");

    const { store, storage } = fixture();
    storage.mode = "deny-read";
    assert.equal((store.list("qb") as { error: { code: string } }).error.code, "unavailable");
    assert.equal((store.clear() as { error: { code: string } }).error.code, "unavailable");

    storage.mode = "ok";
    ok(store.save({ kind: "qb", name: "kept", state: qbState }));
    const before = storage.data.get(SAVED_ANALYSES_KEY);
    storage.mode = "quota";
    const full = store.save({ kind: "qb", name: "too much", state: qbState });
    assert.equal(!full.ok && full.error.code, "quota");
    storage.mode = "deny-write";
    const denied = store.rename("qb", ok(store.list("qb")).analyses[0]!.id, "nope");
    assert.equal(!denied.ok && denied.error.code, "unavailable");
    assert.equal(storage.data.get(SAVED_ANALYSES_KEY), before);
  });
});
