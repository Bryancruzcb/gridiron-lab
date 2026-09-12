import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { CsvColumnError } from "../../src/lib/football/csv.ts";
import { StudyInputError } from "../../scripts/lib/study/errors.ts";
import { canonicalJson, hashJson, sha256Hex } from "../../scripts/lib/study/hash.ts";
import { acquireInput, acquireInputs, describeInput, type FetchLike } from "../../scripts/lib/study/inputs.ts";
import { playerWeekSpec, seasonSpecs } from "../../scripts/lib/study/sources.ts";
import { dropColumn, encode, fixtureText, GAMES, playersFile, teamsFile } from "../fixtures/football/study-fixture.ts";

const temp: string[] = [];
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "gridiron-study-inputs-"));
  temp.push(dir);
  return dir;
}
after(() => {
  for (const dir of temp) rmSync(dir, { recursive: true, force: true });
});

const spec = playerWeekSpec(2041);
const text = fixtureText(playersFile(2041));
const changed = text.replace("AAA.QB", "AAA.QC");
const fixedNow = () => new Date("2026-09-12T12:00:00.000Z");
const LAST_MODIFIED = "Thu, 13 Aug 2026 16:48:13 GMT";

function fakeFetch(bodies: Record<string, string> | string, calls: string[], status = 200): FetchLike {
  return async (url) => {
    calls.push(url);
    const body = typeof bodies === "string" ? bodies : bodies[url];
    if (body == null) return new Response("not found", { status: 404 });
    return new Response(body, { status, headers: { etag: '"v1"', "last-modified": LAST_MODIFIED } });
  };
}

describe("study fixtures", () => {
  it("match their recorded hashes", () => {
    const manifest = JSON.parse(fixtureText("study-fixtures.sha256.json")) as { files: Record<string, string> };
    assert.equal(Object.keys(manifest.files).length, 6);
    for (const [name, sha] of Object.entries(manifest.files)) assert.equal(sha256Hex(fixtureText(name)), sha, name);
  });
});

describe("canonical JSON", () => {
  it("sorts keys at every level and rejects values JSON would silently change", () => {
    assert.equal(canonicalJson({ b: 1, a: { d: [1, { f: 2, e: 3 }], c: null } }), '{"a":{"c":null,"d":[1,{"e":3,"f":2}]},"b":1}');
    assert.equal(hashJson({ x: 1, y: [2, 3] }), hashJson({ y: [2, 3], x: 1 }));
    assert.throws(() => canonicalJson({ a: Number.NaN }), /non-finite/);
    assert.throws(() => canonicalJson([undefined]), /undefined array item/);
  });
});

describe("input acquisition", () => {
  it("describes bytes by hash, size and header, and a one-byte change changes the hash", () => {
    const a = describeInput(spec, encode(text)).identity;
    const b = describeInput(spec, encode(changed)).identity;
    assert.equal(a.bytes, encode(text).byteLength);
    assert.equal(b.bytes, a.bytes);
    assert.equal(a.sha256, sha256Hex(text));
    assert.notEqual(b.sha256, a.sha256);
    assert.equal(b.schema.headerSha256, a.schema.headerSha256);
    assert.equal(a.schema.columns, 33);
    assert.equal(a.url, "https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_2041.csv");
  });

  it("fetches once into a content-addressed cache, then reads the cache (also offline)", async () => {
    const dir = tempDir();
    const calls: string[] = [];
    const first = await acquireInput(spec, { cacheDir: dir, offline: false, fetchImpl: fakeFetch(text, calls), now: fixedNow });
    assert.deepEqual(calls, [spec.url]);
    assert.equal(first.text, text);
    assert.deepEqual(first.entry, {
      ...first.identity,
      localPath: `snapshots/${sha256Hex(text)}/stats_player_week_2041.csv`,
      retrievedAt: "2026-09-12T12:00:00.000Z",
      http: { etag: '"v1"', lastModified: LAST_MODIFIED },
    });
    const again = await acquireInput(spec, { cacheDir: dir, offline: false, fetchImpl: fakeFetch(text, calls) });
    assert.equal(calls.length, 1);
    assert.deepEqual(again.entry, first.entry);
    const offline = await acquireInput(spec, { cacheDir: dir, offline: true });
    assert.deepEqual(offline.entry, first.entry);
  });

  it("fails clearly offline when an input is absent", async () => {
    await assert.rejects(
      acquireInput(spec, { cacheDir: tempDir(), offline: true }),
      (e: unknown) =>
        e instanceof StudyInputError &&
        e.message.includes("offline: stats_player_week_2041 is not cached") &&
        e.message.includes(spec.url),
    );
  });

  it("refuses a cached snapshot whose bytes were modified", async () => {
    const dir = tempDir();
    const got = await acquireInput(spec, { cacheDir: dir, offline: false, fetchImpl: fakeFetch(text, []) });
    writeFileSync(join(dir, got.entry.localPath), changed);
    await assert.rejects(acquireInput(spec, { cacheDir: dir, offline: true }), /the cache was modified/);
  });

  it("keeps old snapshots for pinned runs after a refresh", async () => {
    const dir = tempDir();
    const v1 = await acquireInput(spec, { cacheDir: dir, offline: false, fetchImpl: fakeFetch(text, []) });
    const v2 = await acquireInput(spec, { cacheDir: dir, offline: false, refresh: true, fetchImpl: fakeFetch(changed, []) });
    assert.notEqual(v2.identity.sha256, v1.identity.sha256);
    assert.equal((await acquireInput(spec, { cacheDir: dir, offline: true })).identity.sha256, v2.identity.sha256);
    const pins = new Map([[spec.id, v1.identity.sha256]]);
    const pinned = await acquireInput(spec, { cacheDir: dir, offline: true, pins });
    assert.equal(pinned.text, text);
    await assert.rejects(
      acquireInput(spec, { cacheDir: dir, offline: true, pins: new Map([[spec.id, "0".repeat(64)]]) }),
      /pinned to sha256 0{64} is not in the cache/,
    );
    await assert.rejects(
      acquireInput(spec, { cacheDir: tempDir(), offline: false, pins, fetchImpl: fakeFetch(changed, []) }),
      /the upstream file changed/,
    );
  });

  it("rejects HTTP errors and files missing a required column without caching them", async () => {
    const dir = tempDir();
    await assert.rejects(acquireInput(spec, { cacheDir: dir, offline: false, fetchImpl: fakeFetch({}, []) }), /returned HTTP 404/);
    await assert.rejects(
      acquireInput(spec, { cacheDir: dir, offline: false, fetchImpl: fakeFetch(dropColumn(text, "targets"), []) }),
      (e: unknown) => e instanceof CsvColumnError && e.missing.includes("targets"),
    );
    assert.equal(existsSync(join(dir, "current", `${spec.id}.json`)), false);
  });

  it("acquires the shared schedule once across seasons", async () => {
    const calls: string[] = [];
    const bodies: Record<string, string> = {};
    for (const season of [2040, 2041]) {
      const [p, t, s] = seasonSpecs(season);
      bodies[p!.url] = fixtureText(playersFile(season));
      bodies[t!.url] = fixtureText(teamsFile(season));
      bodies[s!.url] = fixtureText(GAMES);
    }
    const got = await acquireInputs([...seasonSpecs(2040), ...seasonSpecs(2041)], {
      cacheDir: tempDir(),
      offline: false,
      fetchImpl: fakeFetch(bodies, calls),
    });
    assert.deepEqual([...got.keys()].sort(), [
      "nfldata_games",
      "stats_player_week_2040",
      "stats_player_week_2041",
      "stats_team_week_2040",
      "stats_team_week_2041",
    ]);
    assert.equal(calls.length, 5);
  });
});
