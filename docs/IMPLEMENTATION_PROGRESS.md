# Gridiron Lab implementation progress

Updated: 2026-09-12, after the final review fixes
Branch: handoff/eight-improvements (local only, not pushed)
Current HEAD: 9abab2c (study review fixes merged) plus this record; see `git log -1`
Reviewed handoff baseline: ce5d6b1c0e2821305f47535b8cd6e4f1a98aabb5 (local main matched it exactly)

## Current next action

All eight tasks are implemented, merged and verified. The final independent review's 11 findings are fixed. Nothing is left inside the handoff's scope. Decisions for the user:
1. Push the branch or open a PR. The handoff did not authorize either, and GitHub Actions has never run on this branch; every CI gate was run locally on Windows and in Docker node:22 instead.
2. The user's pre-existing uncommitted `package-lock.json` change is still unstaged. Separately, the committed lockfile's root `engines` still says `>=20.19.0` while package.json says `>=22.12.0`. `npm ci` ignores it; the next deliberate lockfile update will sync it.

## Task status

| Task | Status | Evidence |
|---|---|---|
| 1 Optimizer | Verified | Both handoff fixtures; a 400-slate exhaustive oracle, plus 5,500 extra brute-force slates from the reviewer; validation codes; bite tests |
| 2 Scoring | Verified | Ruleset `gridiron-lab-ppr-dst@1` and live adapters (ESPN DST orientation fixed). All study consumers use it |
| 3 Constraints | Verified | Reducer + fingerprints, ui tests, optimizer browser flows 8/8 on the production preview. URL and saved persistence come from Task 6 |
| 4 CI/testing | Verified | CI gates: routes:generate, typecheck, `npm test` (scripts, TS scaffold, domain, ui), build without DATABASE_URL, lint, `npm run test:e2e` (production preview, fixture data, offline guard). Five deliberate-regression bite checks each fail the suite. `docs-agreement.test.ts` recomputes every README study number. GitHub Actions itself has not run (nothing pushed) |
| 5 Reproducibility | Verified | 2022–2025 inputs pinned in `docs/study/input-manifest.json`; strict exact runs for 2023–2025 plus the shipped slate; pinned offline rerun byte-identical (33/33 files); `docs/study/REGENERATION_REPORT.md`; opponent model corrected to `opp@2` after review |
| 6 Sharing/saves | Verified | URL state, saved views, JSON/CSV exports; analysis browser checks 11/11; README and guide document the features |
| 7 Data freshness | Verified | Pure feed-state and loader tests; data-freshness browser checks 11/11; `/live` late-reply race fixed after review |
| 8 Worker | Verified | Worker for initial, manual, comparison and hindsight solves; terminate-based cancel; `docs/perf/optimizer-worker.md` |

## Study review fixes (merged at 9abab2c)

Branch `wip/study-review-fixes` from 5a00c2f, four commits:
- c240b98 fixes the opponent model.
- febce1b adds the legacy wrapper guard.
- 1d57efb regenerates the data on refreshed inputs.
- a06604a corrects the docs.

**Opponent model.** `opp@1` divided the opponent's allowed average (all rows, backups included) by the universe pool's own position mean. On real data the RB/WR/TE factor medians were 0.49–0.66, and in 2023 every WR sat at the 0.7 clamp. `opp@2` divides by the league allowed mean over the same pre-cutoff rows, which gives factor medians of 0.92–1.02. Every model spec now carries a versioned definition (`opp@2`, the others `@1`) and the pipeline ref is `gridiron-lab-study-pipeline@2`, so every run id changed. Pool-independence and centred-factor tests were added; restoring the old denominator fails 4 of them.

**Wrapper guard.** The legacy wrappers refuse `legacy-study-dst@ce5d6b1` unless `--legacy-out` is outside `src/data`. The page-file adapters refuse attribution-only runs unless the caller opts in.

**Input drift.** Only nfldata `games.csv` moved upstream: 63beda7e… became 613dbce57073af64559ae689dd4e53527c1cc2e0c4417fbb23bedb5d21ba85da. In 2022–2025 rows only the `ftn` column changed (53 rows); the rest of the changes were 2026 rows. All eight nflverse stats files still hash as pinned. Running the 5a00c2f code on the refreshed bytes reproduced every published number, so drift changed nothing but hashes and run ids.

**Model-fix effect.** Only the opponent model moved. 2,363 of 2,363 non-opp model-weeks are identical, and all 102 opp model-weeks changed.

| Opponent-adjusted trail | Lineup mean | Player MAE | Bias | vs trailing mean [95%] |
|---|---|---|---|---|
| 2023 | 137.8 → 138.2 | 6.42 → 6.34 | −3.12 → −0.18 | +5.9 → +6.2 [−10.2, +22.1] |
| 2024 | 126.5 → 133.2 | 6.47 → 6.41 | −3.31 → −0.19 | −2.4 → +4.3 [−8.9, +18.6] |
| 2025 | 147.4 → 143.4 | 6.27 → 6.32 | −2.98 → +0.04 | +7.6 [+0.5, +15.4] → +3.7 [−10.6, +19.3] |
| Pooled 2023–2025 | 137.3 → 138.3 | 6.39 → 6.36 | −3.13 → −0.11 | +3.7 → +4.7 [−3.8, +14.1] |
| Shipped slate | 129.8 → 122.7 | 7.12 → 6.86 | −4.18 → −0.87 | +3.0 → −4.1 [−16.8, +8.7] |

The published claim that the opponent adjustment helped is gone. Its 2025 range now includes zero.

**Docs.**
- The report's exclude-zero sentence is now computed from the records: in 2025 only usage × rate excludes zero; on the shipped slate only the 60/40 blend does, and it loses (−12.3).
- The README says "cheap points-per-dollar picks" instead of "stars and scrubs".
- Replay-only counts (178/510, 487/544, the old 116.5/115.8/80.1, 121.5 at α 0.30, the old 67.8) moved from the README into the report.
- A committed `docs/study/study-facts.json` (`npm run study:build -- facts`) backs the README numbers that are not in the page files.
- `docs-agreement.test.ts` recomputes every number in the README's Result and What failed sections from `study-seasons.json`, `study-ewma.json`, `fantasy.json` and `study-facts.json`. It fails on any number that no check reads, and it requires the report's result tables and exclude-zero list verbatim. Mutating the README broke it for 185 of 185 numbers, and the report bite checks caught 6 of 6.

**Unchanged:** the exact vs greedy headline, the EWMA findings, the shrinkage result and the QB lag.

New run ids and hashes are listed in the report's "New run ids": `study-seasons.json` e932d030…, `study-facts.json` 884fbd8b…, core modelsSha256 f1de4cbc….

## Final review (at 5a00c2f)

Three independent reviewers, run on Opus 5 because Fable 5.1 had no credits:
- **Domain correctness:** its own brute force over 5,500 extra slates agreed with exact DP everywhere.
- **Runtime robustness and security:** no worker leaks; the fixture switch can't be turned on without the env var; no server code leaked into client assets.
- **Honesty and docs agreement:** recomputed every published number and walked the §11 checklist item by item with evidence.

The owner confirmed every finding against the code before fixing it.

| # | Severity | Finding | Resolution |
|---|---|---|---|
| 1 | medium | Study "opp" model compared an all-rows opponent mean with a pool-only position mean (RB/WR/TE factors clamped at 0.7; the ce5d6b1 compare-proj.ts had the same mismatch), so the published opponent-adjustment claims were wrong | c240b98 + 1d57efb + a06604a: `opp@2`, regenerated, claims corrected |
| 2 | medium | Lineup export labelled every in-progress score "partial" (ESPN lines are always partial), so "not-final" could never appear | 65ff670: not-final takes precedence and the export uses games in progress; unit and browser expectations updated |
| 3 | medium | `/live` applied a late game-detail reply for a game the user had left, blanking the selected box score until the next poll (regression from the baseline's cancelled flag) | 65ff670: replies for a game that is no longer selected are dropped; the reviewer's race probe stays "ready" |
| 4 | medium | Home page Study card said "2025 test." | 65ff670: "2023–2025 look back." |
| 5 | medium | Progress file sections were stale | This rewrite |
| 6 | low | Legacy wrappers could write attribution-only scoring into the page's data files | febce1b: wrappers and adapters refuse; tests added |
| 7 | low | docs-agreement test checked fewer README numbers than claimed; some README numbers came only from an uncommitted replay harness | 1d57efb + a06604a: facts file, full README coverage guard, replay-only numbers moved to the report |
| 8 | low | Report said only usage and opponent adjustment exclude zero in 2025; the shipped-slate 60/40 blend also does | a06604a: computed list, checked verbatim by the test |
| 9 | low | Lineup Backtest card linked the study as "2025 weeks 2–18" | 65ff670: "Study: 2023–2025, weeks 2–18" |
| 10 | low | README called the Pts/$ greedy baseline "stars and scrubs" | 1d57efb: "cheap points-per-dollar picks" |
| 11 | low | Saved-views storage dropped stored records past the 500-entry read cap on the next write | 65ff670: records past the cap are carried along unread; unit test; the reviewer's probe keeps 520 of 520 |

Also in 65ff670, prompted by a timing failure rather than a finding: the `optimizer-flows` rapid-runs scenario keeps each instrumented worker busy 1.5 s instead of 0.3 s. Under CPU load one click took longer than 0.3 s, so a superseded solve replied before it was terminated. The shown-result invariant never broke; the termination assertion is timing-dependent.

## Task 4 final (merged at 8949724)

Branch `wip/task4-final` has two commits: 49dd4de (browser gate) and 257befd (docs). The agent hit the Opus session limit after committing both, so the owner collected the evidence from its logs.
- `npm run test:e2e` runs `node tests/e2e/run.mjs`. It starts one production preview (`GRIDIRON_LIVE_FIXTURE=cookie`) on a free port and waits for it to answer, then runs:
  - the page smoke `tests/e2e/pages.mjs`: 8 routes at 1280 px and 390 px, checking HTTP 200, page errors, console errors and horizontal overflow
  - `data-freshness.mjs`, `optimizer-flows.mjs`, `analysis.mjs`
  - `offline-guard.mjs`: fails if the server made any request outside 127.0.0.1

  It always stops the server. It is not part of `npm test`.
- CI after build and lint: resolve the Playwright version from the lockfile, cache `~/.cache/ms-playwright`, `npx playwright install --with-deps chromium`, `npm run test:e2e`. `timeout-minutes` is 20.
- Bite checks. Each regression was introduced temporarily; nothing was committed.

  | Introduced regression | Failing tests |
  |---|---|
  | 1. Illegal lineup | Oracle, roster-shape, salary-precision, heuristic-label and real-slate tests |
  | 2. Time-leaking projection | Forecast causality for weeks 2–4 in every method, projection-method tests, offline study command |
  | 3. Weekly total from the season aggregate | "keeps week 2 at 20 while the season total is 30" |
  | 4. Reducer accepts a stale result | "3. refreshed scores during a solve: only the newest configuration and data result lands" |
  | 5. Failed attempt advances timestamps | "keeps a snapshot's old timestamp after a failed request", "never stamps live data with the time of a failed attempt" |

- Docs:
  - README: Labs routes (saved views, copy link, exports, data status), command table (study:build, test:ui, test:e2e), CI gates.
  - Guide: data status, copy link, saved views, exports, proven vs heuristic, hindsight as an upper bound.
  - `tests/domain/docs-agreement.test.ts` recomputes every number in the README's Result and What failed sections (details under "Study review fixes").
- The browser gate at 257befd caught a pre-existing 246 px horizontal overflow on mobile `/optimizer`. The player-table card is a grid item with `min-width: auto`, so it stretched to the table's 620 px minimum. Fixed in 5f04c15 with `min-w-0`.

## Task 6 (merged at 0624bfb)

Branch `wip/task6-analyses`: f954808 (feature) and aeda864 (browser checks).

- `src/lib/analysis/state.ts`: Zod schemas and encode/decode for the QB and lineup states. Lineup links go through `parseSelection`, so there is one selection schema.
  - QB URL: `?season=&down=&dist=&sit=&min=&sort=&pins=id.id`
  - Lineup URL: `?slate=&mode=&lock=id.id&bench=&stack=`
  - Defaults are omitted from the URL. `pins=` (empty) means explicitly no pins. Invalid keys stay out of the validated search so the page can report the raw value.
- `storage.ts`: one localStorage key `gridiron-lab:saved-analyses` holding `{schemaVersion 1, analyses[]}`, with Zod validation per record.
  - Unreadable records, and records past the read cap, are carried along untouched.
  - An unsupported envelope is read-only. "Start over" (with confirmation) is the recovery.
  - 50 views, 80-character names, labelled this browser only.
- `export.ts`: lineup JSON (schema, refs, data version, configuration, solver metadata, slot rows with actual status complete / partial / not-final / missing, totals) plus `parseLineupExport`. The CSV is a metadata table, a blank line, then the slot table, with RFC 4180 quoting and a formula guard on text cells. Export is offered only for a current result.
- QB page: state comes from the route search, and defaults fill only absent values. The slider replaces the history entry once, on commit. Unresolved pins stay listed with an explanation.
- Lineup page: links and back/forward import through the reducer's `import` action, and edits write back to the URL. The result card shows the input version, Export JSON/CSV, Copy link and saved views.

## Task 5 part B (merged at 4724f44)

Branch `wip/task5-study-results`: 27ab68d (results) and 53d4fbf (narrative). The opponent-adjusted numbers in this section were superseded by `opp@2` (see "Study review fixes"). The `games.csv` pin is now 613dbce5…. Everything else below still holds.

**Inputs and runs**
- Inputs: 2022–2025 nflverse player-week and team-week files, nfldata `games.csv`, and `fantasy.json`, all hashed in `docs/study/input-manifest.json`.
- Runs: 2023–2024 development; 2025 retrospective on a pool built only from 2024; 2025 on the shipped `fantasy.json` slate (look-ahead, disclosed). Also an attribution-only legacy-scoring run and exploratory EWMA sweeps; neither is published.
- `study:build -- publish` writes `src/data/study-seasons.json`. It re-checks every run file and refuses mixed configurations. The four legacy page files come from the wrappers.

**Findings**
- The shipped 114-player slate has look-ahead built in. Projection = 0.6 × full-season 2025 PPG + 0.4 × weeks 14–18 PPG for 114/114 players. Salary is linear in projection within each position (R² 0.996–0.998). The RB and WR pools are the top N by that projection.
- Replaying the ce5d6b1 scripts on the cached bytes reproduces 116.5 / 115.8 / 80.1 exactly. The attribution chain:

  | Step | Result |
  |---|---|
  | Legacy published | 116.5 |
  | Solver repair (old DP returned nothing on 178 of 510 solves) | 114.1 |
  | Players on a bye removed | 122.1 |
  | Rest of the pipeline policy | 122.1 |
  | Scoring repair (DST changed in about 45% of team-games) | 126.7 |
  | 2025 pool built from 2024 | 139.7 |

- Pooled 2023–2025 (51 weeks): exact 133.5, greedy-proj 132.2, greedy-value 112.0.
  - Exact − greedy is +1.4 a week, 95% bootstrap range −3.4 to +6.6.
  - Projection overshot the actual score in 51/51 weeks, while player-level bias was −0.02 (a selection effect).
  - Shrinkage has the best player MAE in every run.
  - EWMA 0.35 vs trailing mean: +10.5 pooled (+4.2 to +16.8), but −5.5 on the shipped slate.
- Known limits:
  - nflverse omits active players who recorded nothing, so they count as inactive = 0.
  - The shared parser skips 22 player-week rows per season.

## Wave 2 (merged)

- `wip/task7-freshness` (cf7f6f6) as e48b066
- `wip/task5-study-lib` (0ff719a) as 7493078
- `wip/task3-8-lineup-worker` (42c45e8 + 470a938) as b636d13

Owner commits: 316ed8d (FeedStatus on the lineup page) and b17b0b9 (the optimizer browser stub now uses the FeedResponse envelope).

Agents ran on Opus 5 because Fable 5.1 had no credits. The Tasks 3+8 agent and the first Task 5B attempt hit the Opus session limit. The owner finished Tasks 3+8 from the agent's verified logs.

### Tasks 3 + 8: constraint controller and worker solver

`src/lib/lineup/selection.ts`:
- `LineupSelection {version 1, slate, mode, locked[], excluded[], stack}`
- `parseSelection` reports conflicts instead of picking a winner
- `slateId`, `actualsVersion`, `planLineup`/`planCompare` with request fingerprints over every solve input
- a reducer for edits, data, request start/result/failure, cancel, reset and import
- `autoRunKey`: mode, data or epoch changes recompute; plain edits wait for Run and mark the old result outdated

Worker plumbing:
- `worker-protocol.ts`: validated messages and a pure `handleWorkerRequest`.
- `use-lineup-solver.ts`: one module worker per channel, created after mount. Cancel is terminate + recreate. Monotonic request ids with fingerprint checks. Recoverable errors, with no synchronous fallback.
- `src/workers/optimizer.worker.ts`: the worker entry.

Page: shows the solver method and proven vs heuristic, marks locks without actuals in hindsight mode, dims outdated results, labels hindsight a retrospective upper bound, and does not count missing actuals as zero. The "Value greedy" card now shows greedy-value.

Perf (`docs/perf/optimizer-worker.md`):
- 300-player fixture: the main-thread solve produced 10 long tasks up to 263 ms; the worker produced 0, with frame gaps under 30 ms.
- Real 114-player slate: the solve takes about 20 ms and was never the bottleneck. No typing-latency improvement is claimed.

### Task 7: data provenance and refresh

- `feed-state.ts`: a failed attempt never stamps data with a time it wasn't retrieved. Freshness is derived from `FEED_POLICY`.
- `loader.ts`: owned AbortController, per-attempt timeout and deadline covering the gzip stream. Bounded retries, 429 Retry-After honored, no schema retries, one upstream call per concurrent group.
- `feed-store.ts`: independent feeds, lease-based shared polling, bounded follow-ups on pending answers.
- Server functions return `FeedResponse<T> {data, source live|cache|none, fetchedAt, respondedAt, error, partial[]}`. `mergeLabs` keeps per-section provenance, and `withWeekFallback` is removed.
- DataStatus/FeedStatus appear on /, /qb, /play-calling, /players, /live and /optimizer.
- Server-only fixture switch `GRIDIRON_LIVE_FIXTURE` (header of `src/lib/live/fixtures.server.ts`).
- A real-network smoke through the built app worked.

### Task 5 part A: study pipeline library

- `scripts/lib/study/*.ts`, a `scripts/study.ts` CLI and `npm run study:build`. The old scripts are thin wrappers.
- Content-addressed `.study-cache/` with a SHA-256-verified manifest, offline mode and input pins.
- Causal projection snapshots; opponents come from the schedule.
- Universes: `legacy-fantasy-json` (look-ahead) and `synthetic-prior-season@1`.
- One common slate per week; strict exact-dp solves with method requested/used; a common week set with exclusion reasons.
- Run id = hash of inputs/config/policies; operational metadata lives in `.meta.json`. Summaries are recomputed from week records, with a fixed-seed bootstrap over weeks.

## Wave 1 (merged at ceeb198)

Branches: `wip/task1-optimizer` (0834cbd), `wip/task2-scoring` (814bfb7), `wip/task4-ci-baseline` (6aa53bc).

### Task 1: solver contract (src/lib/optimizer.ts, src/lib/football/lineup-validation.ts)

- `solveLineup({players, cap, locked?, excluded?, requireStack?, method})` runs exactly one method with no fallback. It returns `SolveOk {status:"ok", method, optimality, lineup, fallbackReason?}`, or:
  - `invalid-input`: invalid-cap, duplicate-player-id, invalid-position, invalid-salary, non-finite-projection, lock-exclude-overlap, unknown-lock, incompatible-locks, locks-over-cap, insufficient-pool, salary-precision
  - `infeasible/no-legal-roster`: exact DP only
  - `error`: stack-not-proven, heuristic-no-lineup, reconstruction-failed, illegal-lineup, solver-limit
- `optimizeLineup` runs exact DP. The labelled hill-climb is used only when a stack is required and the DP optimum is unstacked.
- A `Lineup` has `slots`, `players`, `salary`, `proj` and `remaining`. `scoreLineup` returns `{pts, n, missing}`.
- The DP state counts players per position (240 states), with one take bit per layer × state × salary cell. Salaries are counted in their GCD unit (≤ 2000 units) and never rounded. The pool is sorted by id; ties go to lower salary, then lower ids.
- Real slate: 146.02, proven, about 16–20 ms / 3.64 MB.

### Task 2: scoring and weekly isolation (src/lib/football/*)

- Ruleset `gridiron-lab-ppr-dst@1`: standard PPR offense, which equals nflverse `fantasy_points_ppr` on 18,540/18,540 2025 REG rows, and DraftKings-style DST. Points allowed is the opponent's final score. Results are complete, partial or missing, never filled.
- ESPN team-box takeaway fields are the team's own giveaways (28/28 in 2025 week 5). The live DST adapter was reversed and is fixed.
- Per-week rows are keyed season + seasonType + week + player and kept separate from `aggregateSeason`. `mergeCurrentWeek` joins only on the full week key.

### Task 4 part 1: scaffold tests and CI

Root causes of the baseline failures:
- 8 grok-pwa tests read the repo's real site identity; they now run in an empty workspace.
- 4 tests read gitignored Grok docs; they skip with a reason when the docs are absent.
- A Windows spawn bug in with-app-env (the `{}` leak) is fixed, with a regression test.
- Windows symlink EPERM is fixed with junctions.

engines is `>=22.12.0`.

## Stage A baseline (2026-09-12, Windows 11, Node 26.3.0, npm 11.17.0)

Local checkout was `main` at ce5d6b1 with one uncommitted user change: `package-lock.json` (67 deleted lines, optional peer entries). It is the user's change; it is never staged or committed.

There was no `AGENTS.md` or `CLAUDE.md`. GitHub Actions CI was green on ce5d6b1 (typecheck only). Installed: @tanstack/react-router 1.170.33, @tanstack/react-start 1.168.50, vite 8.2.2, zod 4.5.4, playwright 1.63.0, typescript 5.9.3, react 19.2.8. Docker 29.7.2 was used for Linux parity.

| Command | Baseline result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm test` | exit 0 but misleading on Windows: the single-quoted glob matched 0 script tests |
| `node --test scripts/*.test.mjs` | Windows 197 / 18 fail; Linux 197 / 12 fail |
| `npm run lint` | exit 1: 1 error, 5 warnings |
| `npm run build` (no DATABASE_URL) | exit 0 |

Fantasy slate: 114 players (QB 18, RB 28, WR 36, TE 16, DST 16), salaries in multiples of $100 ($2,000–$9,200), no duplicate IDs.

## Decisions every task followed

1. **Test runner.** Native `node:test` with `--experimental-strip-types`.
   - Domain tests: `tests/domain/**/*.test.ts`.
   - Controller/state tests: `tests/ui/**/*.test.ts`.
   - Fixtures: `tests/fixtures/football/`.
   - Browser checks: plain Playwright scripts in `tests/e2e/*.mjs`.
   - tsconfig includes `tests` and `scripts/**/*.ts` with checkJs, so e2e scripts carry JSDoc types.
2. **Import rule for anything Node executes:** relative imports with explicit `.ts` extensions; `@/` only in `import type`; no runtime JSON imports.
3. **Node 22.12+** (engines), CI on Node 22.
4. **No new dependencies**; no lockfile churn.
5. **Solver contract** = the Task 1 API.
6. **Scoring** = `gridiron-lab-ppr-dst@1`, documented as simplified DraftKings-inspired rules; missing inputs stay missing.
7. **Study results are never hand-edited.** They were regenerated in Task 5B and again after the review's opponent-model fix. Each regeneration attributes its changes: solver, scoring, week policy, universe, then input drift vs model fix.
8. **Git.** Task branches off this integration branch, local commits only. Nothing pushed, merged to `main`, or deployed.
9. Only the owner thread edits this file.

## Verification

| When | Command | Environment | Result |
|---|---|---|---|
| Wave 1 merge (ceeb198) | typecheck, npm test, build, lint | Windows Node 26 + clean Docker node:22.23.2 | all exit 0; scripts 194 + 4 skipped, TS 55, domain 131; lint 0 errors |
| After Task 7 + 5A merge (7493078) | clean `git archive`: npm ci, routes:generate, typecheck, npm test, build, lint | Docker node:22.23.2 | all exit 0; domain 250; lint 0 errors / 4 warnings |
| After Tasks 3+8 merge (b636d13) | same | Docker node:22.23.2 | all exit 0; domain 250, ui 37 |
| 316ed8d | `data-freshness.mjs`; `optimizer-flows.mjs` (production preview) | Windows, Chromium 153 | 11/11; 5/8 (stale test stub, fixed in b17b0b9) |
| b17b0b9 | typecheck; optimizer-flows (production preview) | Windows, Chromium 153 | typecheck 0; 8/8 |
| After Task 5B merge (4724f44) | clean `git archive` full suite | Docker node:22.23.2 | all exit 0; domain 257, ui 37 |
| After Task 6 merge (0624bfb) | clean `git archive` full suite | Docker node:22.23.2 | all exit 0; domain 257, ui 70 |
| Task 4 final head (257befd) | `npm test`; `npm run test:e2e`; five bite checks | Docker node:22.23.2; Windows and Linux Playwright (`--network none`) | tests green (domain 262); e2e 47/48 on both (pre-existing mobile overflow); each bite check fails its suite |
| Overflow fix (5f04c15) | `npm run test:e2e`; clean `git archive` full suite | Windows Chromium 153; Docker node:22.23.2 | 48/48; all exit 0 (domain 262, ui 70) |
| Review fixes (65ff670) | typecheck, eslint, test:ui, build, reviewer probes, `npm run test:e2e` | Windows Node 26, Chromium 153, under load | all exit 0; test:ui 71/71; storage probe keeps 520/520; live-race probe stays ready; 48/48 in 376 s |
| Study review fixes head (a06604a) | typecheck, npm test, build, lint, `npm run test:e2e`, pinned offline rerun, README mutation check, bite checks; test:domain in Docker node:22 | Windows Node 26 + Docker node:22 (agent report) | all exit 0; e2e 48/48; rerun 33/33 byte-identical; 185/185 README mutations and 6/6 report mutations caught; domain 288 in Docker |
| Final merged head (9abab2c) | clean `git archive`: npm ci, routes:generate, typecheck, npm test, build, lint; then Windows build + `npm run test:e2e` | Docker node:22.23.2; Windows Node 26, Chromium 153 | all exit 0; scripts 194 + 4 skipped, TS scaffold 55, domain 288, ui 71; lint 0 errors / 4 warnings; browser gate 48/48 in 305 s (pages 16/16, data-freshness 11/11, optimizer-flows 8/8, analysis 11/11, no server request outside 127.0.0.1) |

GitHub Actions has not run on this branch (nothing pushed).

## Data artifacts

- Input manifest `docs/study/input-manifest.json`: 10 inputs, each with URL, SHA-256, bytes, Last-Modified and retrieval time. nfldata `games.csv` is 613dbce57073af64559ae689dd4e53527c1cc2e0c4417fbb23bedb5d21ba85da (retrieved 2026-09-13T04:58Z). The eight 2022–2025 nflverse stats files are unchanged from Task 5B.
- Raw bytes live in the gitignored content-addressed `.study-cache/`. To repeat with the committed bytes, run `--offline --pin-inputs docs/study/input-manifest.json`.
- Versions: ruleset `gridiron-lab-ppr-dst@1`; pipeline `gridiron-lab-study-pipeline@2` (models versioned, `opp@2`); solver ref `gridiron-lab-solveLineup@1`.
- Published outputs:
  - `src/data/study-seasons.json` (per-season, pooled and shipped-slate results, weekly records).
  - The four legacy page files `src/data/study-backtest.json`, `study-projections.json`, `study-ewma.json`, `study-qb-lag.json`.
  - `docs/study/study-facts.json` (README facts not in the page files).
  - `docs/study/REGENERATION_REPORT.md` (attribution, run ids, reproduction commands).

## Uncommitted work

- `package-lock.json`: the user's pre-existing change, deliberately left unstaged.
- No agent worktrees remain.

## Blockers

None. Usage limits during the run: Fable 5.1 had no credits for the whole session (every agent ran on the Opus 5 fallback), and Opus hit a session limit twice (reset 3pm and 8pm PT). Both times the owner resumed from committed work or agent logs.

## Decisions not to repeat

- The broad source audit is done. Do not repeat it.
- ESPN team-box takeaway orientation is settled (giveaways).
- Do not duplicate `test:domain` as its own CI step; `npm test` runs it.
- Browser stubs of server functions must use the `FeedResponse` envelope.
- Unpinned study runs fetch whatever upstream serves. `games.csv` has changed twice in one day, so publish only from pinned inputs and record drift before attributing a change to code.
