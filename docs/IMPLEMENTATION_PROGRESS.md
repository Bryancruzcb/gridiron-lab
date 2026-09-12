# Gridiron Lab implementation progress

Updated: 2026-09-12 (after wave 2 merges)
Branch: handoff/eight-improvements (local only, not pushed)
Current HEAD: see `git log -1` (wave 2 merged; last verified commit b17b0b9)
Reviewed handoff baseline: ce5d6b1c0e2821305f47535b8cd6e4f1a98aabb5 (local main matched it exactly)

## Current next action

All eight tasks' implementation branches are merged. Next:
- Run the final Task 4 wave: a `test:e2e` command and a CI browser job, the five deliberate-regression bite checks, and the README/guide agreement check, including the Task 6 feature docs.
- Then run one three-lens review (correctness, runtime/security, honesty + handoff §11 checklist) of ce5d6b1..HEAD, and fix what it confirms.

## Task status

| Task | Status | Evidence / remaining work |
|---|---|---|
| 1 Optimizer | Verified (wave 1) | Both handoff fixtures, a 400-slate exhaustive oracle, validation codes, bite tests |
| 2 Scoring | Verified | Ruleset + live adapters (wave 1); all study consumers use it and results are regenerated (Task 5B) |
| 3 Constraints | Verified (wave 2) | Reducer + fingerprints, 37 ui tests, optimizer browser flows 8/8 on the production preview after the merge. URL/saved persistence is handled in Task 6 |
| 4 CI/testing | Part 1 verified; final wave pending | npm test/build/lint gated. Pending: e2e command + CI browser job, bite checks, docs agreement |
| 5 Reproducibility | Verified (wave 2 + 5B) | 2022–2025 inputs in docs/study/input-manifest.json; strict exact runs for 2023–2025 + shipped slate; pinned offline rerun byte-identical; docs/study/REGENERATION_REPORT.md |
| 6 Sharing/saves | Verified (wave 3a) | 33 pure analysis tests (test:ui 70), `tests/e2e/analysis.mjs` 11/11 on the production preview with the fixture switch; optimizer flows 8/8 and data-freshness 11/11 still pass. Docs for the new features are pending (final Task 4 wave) |
| 7 Data freshness | Verified (wave 2) | 57 pure tests, data-freshness browser checks 11/11 on the production preview after the merge |
| 8 Worker | Verified (wave 2) | Worker for the initial, manual, comparison and hindsight solves; cancellation by terminate; perf evidence in docs/perf/optimizer-worker.md |

## Task 6 (merged at 0624bfb)

Branch `wip/task6-analyses`: f954808 (feature) and aeda864 (browser checks).

- `src/lib/analysis/state.ts`: Zod schemas plus encode/decode for the QB and lineup states. Lineup links go through `parseSelection`, so there is one selection schema. URL shapes:
  - QB: `?season=&down=&dist=&sit=&min=&sort=&pins=id.id`
  - Lineup: `?slate=&mode=&lock=id.id&bench=&stack=`
  - Defaults are left out of the URL, and `pins=` (empty) means explicitly no pins.
- Invalid keys are kept out of the validated search, so the page can report the raw value (TanStack otherwise overwrites it silently).
- `storage.ts`: one localStorage key `gridiron-lab:saved-analyses` with `{schemaVersion 1, analyses[]}`, Zod-validated per record.
  - Unreadable records are skipped but kept, and an unsupported envelope is read-only.
  - "Start over" (with confirmation) is the recovery path.
  - Limits: 50 views, 80-character names. Labelled this browser only.
- `export.ts`: lineup JSON (schema, refs, data version, configuration, solver metadata, slot rows with actual status, totals) plus `parseLineupExport`, which validates the schema and recomputes totals.
  - The CSV is a metadata table, a blank line, then the slot table, with RFC 4180 quoting and a formula guard on text cells.
  - Export is offered only for a current result.
- QB page: state comes from the route search, and defaults fill only absent values. The slider replaces history once, on commit. Pins that miss the current cut stay listed as unresolved, with an explanation and an Unpin button.
- Lineup page: the hook imports links and back/forward through the existing reducer `import` action, and writes edits back (push for edits, replace for a memory restore). The result card shows the input version (slate id, actuals version), Export JSON/CSV, Copy link and saved views.
- The `tests/e2e/optimizer-flows.mjs` URL wait now accepts a query string.

## Task 5 part B (merged at 4724f44)

Branch `wip/task5-study-results` has two commits: 27ab68d (results) and 53d4fbf (narrative).

**Inputs and runs**
- Inputs: 2022–2025 nflverse player-week and team-week files, nfldata `games.csv` and `fantasy.json`. All ten are hashed in `docs/study/input-manifest.json`. `games.csv` changed upstream after wave 1 (e5443356… → 63beda7e…), and the runs pin the new bytes.
- Runs:
  - 2023–2024: role development.
  - 2025 on a pool built only from 2024: role retrospective.
  - 2025 on the shipped `fantasy.json` slate: look-ahead, disclosed.
  - Attribution-only legacy-scoring run and an exploratory EWMA sweep: not published.
- A new `study:build -- publish` step writes `src/data/study-seasons.json` (143 KB, 15.6 KB gzip). It re-checks every run file and refuses mixed configurations. The four legacy page files were regenerated through the wrappers. `study-qb-lag.json` has the same 409 pairs; only the pair order changed.
- Reproduction: a pinned offline rerun of every command was byte-identical for every artifact.

**Findings**
- Shipped-slate audit: the 114-player slate is built with look-ahead. Projection = 0.6 × full-season 2025 PPG + 0.4 × weeks 14–18 PPG for 114/114 players. Salary is linear in projection within each position (R² 0.996–0.998). The RB and WR pools are the top N by that projection.
- Replaying the ce5d6b1 scripts on the cached bytes reproduces 116.5 / 115.8 / 80.1 exactly, so the attribution below is not explained by upstream data drift. The chain:

  | Step | Result |
  |---|---|
  | Legacy published | 116.5 |
  | Solver repair (old DP returned nothing on 178 of 510 solves) | 114.1 |
  | Players on a bye removed from the slate | 122.1 |
  | Rest of the pipeline policy | 122.1 (unchanged for the trailing mean) |
  | Scoring repair (DST changed in about 45% of team-games) | 126.7 |
  | 2025 pool built from 2024 | 139.7 |

  No week was excluded in any run.
- Pooled 2023–2025 (51 weeks): exact 133.5, greedy-proj 132.2, greedy-value 112.0.
  - Exact − greedy = +1.4/week, with a 95% bootstrap range of −3.4 to +6.6.
  - Projection overshot the actual score in 51/51 weeks, while player-level bias was −0.02 (a selection effect).
  - Shrinkage has the best player MAE in every run.
  - EWMA 0.35 vs trailing mean: +10.5 pooled (+4.2 to +16.8), but −5.5 on the shipped slate.
- Narrative: study.tsx reads `study-seasons.json` (season picker, 95% ranges, and forecast/look-back/hindsight labels) with computed sentences. The guide and README were updated; "2025 holdout" became "retrospective".
- Known limits: nflverse omits active players who recorded nothing, so they count as inactive = 0 (49 lineup slots over 51 weeks). The shared parser skips 22 player-week rows per season.

## Wave 2 (merged)

Merges into this branch:
- `wip/task7-freshness` (cf7f6f6) as e48b066
- `wip/task5-study-lib` (0ff719a) as 7493078
- `wip/task3-8-lineup-worker` (42c45e8 + 470a938) as b636d13

Owner commits on top:
- 316ed8d: FeedStatus on the lineup page, which Task 7 was not allowed to edit.
- b17b0b9: fixes the optimizer browser stub, which still returned a bare WeekPpr instead of Task 7's FeedResponse envelope. Test-only; product behavior was correct.

Agents ran on Opus 5 (Fable 5.1 out of credits). The Tasks 3+8 agent and the first Task 5B attempt hit the Opus session limit (reset 3pm PT). The owner finished Tasks 3+8 from the agent's verified logs: wrote the perf doc, re-ran typecheck/test:ui/eslint and committed. Task 5B was relaunched.

### Tasks 3 + 8: constraint controller and worker solver

Modules:
- `src/lib/lineup/selection.ts`:
  - `LineupSelection {version 1, slate, mode, locked[], excluded[], stack}`, where locked and excluded are sorted, unique and never overlap.
  - `parseSelection` reports lock-exclude-overlap, too-many-ids (250), unsupported-version and malformed input, plus a slate-mismatch warning. It never picks a winner.
  - `slateId`, `actualsVersion`, `planLineup`/`planCompare` with request fingerprints over every solve input.
  - A reducer for selection edits, data, request start/result/failure, cancel, reset and import.
  - `autoRunKey`: mode, data or epoch changes recompute on their own; plain edits wait for Run and mark the old result outdated.
- `worker-protocol.ts`: validated request/response messages, and a pure `handleWorkerRequest` that Node tests exercise.
- `use-lineup-solver.ts`: one module worker per channel (lineup, compare), created after mount. Cancel = terminate + recreate, with monotonic request ids + fingerprint checks. Construction, runtime and malformed-reply failures become recoverable errors with no synchronous fallback. The last selection is kept in an in-memory window global for leave/re-enter.
- `src/workers/optimizer.worker.ts`: the worker entry.

Page (`src/routes/optimizer.tsx`):
- Shows the solver method and whether the result is proven or heuristic.
- A lock without an actual score is marked in hindsight mode.
- Outdated results are dimmed.
- Hindsight is labelled a retrospective upper bound; not-final scores are marked; missing actuals are not counted as zero.
- The "Value greedy" card now really shows greedy-value.

Browser flows: `tests/e2e/optimizer-flows.mjs --base <url>` covers 8 scenarios (worker asset served in production; rapid runs construct 8 and terminate 8). Perf: `tests/e2e/optimizer-perf.mjs`.
- On the 300-player fixture the main-thread solve produced 10 long tasks up to 263 ms; the worker produced 0 long tasks with frame gaps under 30 ms.
- On the real 114-player slate the solve takes about 20 ms and was never the bottleneck. Typing latency is React table rendering, and no improvement is claimed there.

### Task 7: data provenance and refresh

- `src/lib/live/feed-state.ts`: pure transitions. A failed attempt never stamps data with a time it wasn't retrieved. Freshness is derived from `FEED_POLICY`.
- `loader.ts`: owned AbortController, per-attempt timeout and deadline covering the gzip stream. Bounded retries with backoff, 429 Retry-After honored, no schema retries, one upstream call per concurrent group.
- `feed-store.ts`: independent feeds, lease-based shared polling (live.tsx no longer runs its own loop), bounded follow-ups on pending answers.
- Server functions return `FeedResponse<T> {data, source live|cache|none, fetchedAt, respondedAt, error, partial[]}`.
- `mergeLabs` keeps per-section provenance. `withWeekFallback` was removed.
- DataStatus/FeedStatus appear on /, /qb, /play-calling, /players, /live and /optimizer.
- The server-only fixture switch is `GRIDIRON_LIVE_FIXTURE` (spec or `cookie`; scenarios fresh, cached, stale, snapshot-only, partial, empty, unavailable, malformed, recovered; header of `src/lib/live/fixtures.server.ts`).
- Browser checks: `npm run build && node tests/e2e/data-freshness.mjs` (starts its own preview on 8081).
- A real-network smoke through the built app worked: live week 1 scoreboard, live pbp, 48 nflverse-published + 5 provisional ESPN lines.

### Task 5 part A: study pipeline library

- `scripts/lib/study/*.ts` (18 modules), a `scripts/study.ts` CLI and `npm run study:build`. The three old scripts are thin wrappers.
- Content-addressed input cache `.study-cache/` (gitignored) with a SHA-256-verified manifest, offline mode, and input pins.
- Causal projection snapshots (future rows and scores stripped); opponents come from the schedule.
- Universes: `legacy-fantasy-json` (flagged look-ahead) and `synthetic-prior-season@1` (prior-season-only pool and salaries).
- One common slate per week; strict exact-dp solves with method requested/used; a common week set with exclusion reasons.
- Run id = hash of inputs/config/policies; operational metadata lives in a separate .meta.json.
- Summaries are recomputed from week records, with a paired weekly difference and a fixed-seed bootstrap over weeks.
- The legacy DST scoring variant `legacy-study-dst@ce5d6b1` is attribution-only.
- 62 offline tests.

## Wave 1 (merged into this branch at ceeb198)

Branches `wip/task1-optimizer` (0834cbd), `wip/task2-scoring` (814bfb7) and `wip/task4-ci-baseline` (6aa53bc).

### Task 1: solver contract (src/lib/optimizer.ts, src/lib/football/lineup-validation.ts)

- `solveLineup({players, cap, locked?, excluded?, requireStack?, method})` runs exactly one method with no fallback. It returns `SolveOk {status:"ok", method, optimality, lineup, fallbackReason?}` or one of:
  - `invalid-input` (invalid-cap, duplicate-player-id, invalid-position, invalid-salary, non-finite-projection, lock-exclude-overlap, unknown-lock, incompatible-locks, locks-over-cap, insufficient-pool, salary-precision)
  - `infeasible/no-legal-roster` (exact DP only)
  - `error` (stack-not-proven, heuristic-no-lineup, reconstruction-failed, illegal-lineup, solver-limit)
- `optimizeLineup` runs exact DP. The hill-climb heuristic (labelled, with fallbackReason) is used only when a stack is required and the DP optimum is unstacked.
- A `Lineup` has `slots`, `players`, `salary`, `proj` and `remaining`. `scoreLineup` returns `{pts, n, missing}`.
- The DP state counts players per position (240 states) and stores one take bit per layer × state × salary cell. Salaries are counted in their GCD unit (≤ 2000 units) and never rounded. The pool is sorted by id; ties go to lower salary, then lower ids.
- The real slate solves to 146.02, proven, in about 16–20 ms / 3.64 MB. The 300-player fixture takes about 50–60 ms / 6.43 MB.

### Task 2: scoring and weekly isolation (src/lib/football/*)

- Ruleset `gridiron-lab-ppr-dst@1`: standard PPR offense (equals nflverse `fantasy_points_ppr` on 18,540/18,540 2025 REG rows) and DraftKings-style DST. Points allowed is the opponent's final score from nfldata `games.csv`. Results are complete, partial or missing, never filled.
- ESPN team-box takeaway fields are the team's own giveaways (28/28 in 2025 week 5). The live DST adapter was reversed; on DET@CIN 401772854 it scored DET 6 / CIN 4, corrected to 10 / 2. nflverse DST takeaways come from the opponent's giveaway columns.
- Per-week rows are keyed season + seasonType + week + player and kept separate from `aggregateSeason`. `mergeCurrentWeek` joins only on the full week key; a final zero counts.

### Task 4 part 1: scaffold tests and CI

- Root causes:
  - 8 grok-pwa tests read the repo's real site identity; they now run in an empty workspace.
  - 4 tests read gitignored Grok docs; they skip with a reason when the docs are absent.
  - A Windows spawn bug in with-app-env (fixed with a regression test) was also the source of the `{}` file leak.
  - Windows symlink EPERM, fixed with junctions.
- engines is `>=22.12.0`. CI runs routes:generate, typecheck, `npm test` (scripts, TS scaffold, test:domain, test:ui), build without DATABASE_URL, and lint (0 errors).

## Stage A baseline (2026-09-12, Windows 11, Node 26.3.0, npm 11.17.0)

Local checkout was on `main` at ce5d6b1 with one uncommitted user change: `package-lock.json` (67 deleted lines, optional peer entries). It is the user's change. Never stage or commit it.

No `AGENTS.md` or `CLAUDE.md` in the checkout. GitHub Actions CI was green on ce5d6b1 (typecheck only). Installed: @tanstack/react-router 1.170.33, @tanstack/react-start 1.168.50, vite 8.2.2, zod 4.5.4, playwright 1.63.0, typescript 5.9.3, react 19.2.8. Docker 29.7.2 for Linux parity.

| Command | Baseline result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm test` | exit 0 but misleading on Windows (single-quoted glob matched 0 script tests) |
| `node --test scripts/*.test.mjs` | Windows 197 / 18 fail; Linux 197 / 12 fail |
| `npm run lint` | exit 1: 1 error, 5 warnings |
| `npm run build` (no DATABASE_URL) | exit 0 |

Fantasy slate: 114 players (QB 18, RB 28, WR 36, TE 16, DST 16), salaries multiples of $100 ($2,000–$9,200), no duplicate IDs.

## Decisions every task follows

1. **Test runner.** Native `node:test` with `--experimental-strip-types`. Domain tests in `tests/domain/**/*.test.ts`, controller/state tests in `tests/ui/**/*.test.ts`, fixtures in `tests/fixtures/football/`, browser checks as plain Playwright scripts in `tests/e2e/*.mjs`. tsconfig includes `tests` and `scripts/**/*.ts` with checkJs, so e2e scripts need JSDoc types. Quote globs with double quotes in package.json.
2. **Import rule for anything Node executes:** relative imports with explicit `.ts` extensions; `@/` only in `import type`; no runtime JSON imports.
3. **Node 22.12+** (engines), CI on Node 22.
4. **No new dependencies**; no lockfile churn.
5. **Solver contract** = the Task 1 API.
6. **Scoring** = `gridiron-lab-ppr-dst@1`, documented as simplified DraftKings-inspired rules; missing inputs stay missing.
7. **Study regeneration happens once, in Task 5B**, with attribution to solver, scoring, week policy, and universe/multi-season separately.
8. **Git.** Task branches off this integration branch, local commits only. Nothing is pushed, merged to `main`, or deployed.
9. Only the owner thread edits this file.

## Verification

| When | Command | Environment | Result |
|---|---|---|---|
| Wave 1 merge (ceeb198) | typecheck, npm test, build, lint | Windows Node 26 + clean Docker node:22.23.2 | all exit 0; scripts 194 pass + 4 skipped, TS 55, domain 131; lint 0 errors |
| After Task 7 + 5A merge (7493078) | clean `git archive`: npm ci, routes:generate, typecheck, npm test, build, lint | Docker node:22.23.2 | all exit 0; scripts 194 + 4 skipped, TS 55, domain 250; lint 0 errors / 4 warnings |
| After Tasks 3+8 merge (b636d13) | same | Docker node:22.23.2 | all exit 0; scripts 194 + 4 skipped, TS 55, domain 250, ui 37; lint 0 errors |
| 316ed8d | typecheck, eslint optimizer.tsx, npm test, build | Windows Node 26 | all exit 0; same counts |
| 316ed8d | `node tests/e2e/data-freshness.mjs` (production preview + fixture switch) | Windows, Chromium 153 | 11/11 |
| 316ed8d | `node tests/e2e/optimizer-flows.mjs` against production preview | Windows, Chromium 153 | 5/8: a stale test stub (bare WeekPpr) left the actuals checkbox disabled |
| b17b0b9 | typecheck; optimizer-flows against production preview | Windows, Chromium 153 | typecheck 0; 8/8 (production worker asset 200; 8 constructed / 8 terminated) |
| Task 5B head (53d4fbf) | typecheck, test:domain (257), npm test, build, lint; /study and /guide rendered at 1280 and 400 px | Windows Node 26, Chromium | all exit 0; no console errors, no horizontal overflow (agent report) |
| After Task 5B merge (4724f44) | clean `git archive`: npm ci, routes:generate, typecheck, npm test, build, lint | Docker node:22.23.2 | all exit 0; scripts 194 + 4 skipped, TS 55, domain 257, ui 37; lint 0 errors / 4 warnings; study client chunk 157.6 kB (36.7 kB gzip) |
| Task 6 head (aeda864) | typecheck, test:ui (70), npm test, build, lint; `tests/e2e/analysis.mjs`; optimizer-flows; data-freshness | Windows Node 26, Chromium 153; test:ui also Docker node:22 | all exit 0; analysis 11/11, optimizer 8/8, data 11/11 (agent report) |
| After Task 6 merge (0624bfb) | clean `git archive`: npm ci, routes:generate, typecheck, npm test, build, lint | Docker node:22.23.2 | all exit 0; scripts 194 + 4 skipped, TS 55, domain 257, ui 70; lint 0 errors / 4 warnings |

GitHub Actions has not run on this branch (nothing pushed).

## Data artifacts

- Input cache: `.study-cache/` (gitignored, content-addressed). Task 2 verified 2025 bytes: stats_player_week_2025.csv sha256 e5e0615b…, stats_team_week_2025.csv 91058a59…, nfldata games.csv e5443356… (retrieved 2026-09-12). Task 5B commits the full manifest.
- Ruleset: `gridiron-lab-ppr-dst@1`; study solver ref `gridiron-lab-solveLineup@1`.
- Generated outputs: `src/data/study-*.json` still baseline (legacy numbers).
- Regeneration status: in progress (Task 5B).

## Uncommitted work

- `package-lock.json`: user's pre-existing change, deliberately left unstaged.
- Worktrees under `.claude/worktrees/` for running agents (excluded via `.git/info/exclude`). While they exist, run lint as `npx eslint . --ignore-pattern ".claude/**"`.

## Blockers

None. Usage limits: Fable 5.1 has no credits; Opus hit a session limit once (reset 3pm PT).

## Decisions not to repeat

- The broad source audit is done. Do not repeat it.
- ESPN team-box takeaway orientation is settled (giveaways).
- Do not duplicate `test:domain` as its own CI step; `npm test` runs it.
- Browser stubs of server functions must use the `FeedResponse` envelope.
