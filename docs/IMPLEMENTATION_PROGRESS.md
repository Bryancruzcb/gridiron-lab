# Gridiron Lab implementation progress

Updated: 2026-09-12
Branch: handoff/eight-improvements (local only, not pushed)
Current HEAD: see `git log -1` (wave 1 merged at ceeb198)
Reviewed handoff baseline: ce5d6b1c0e2821305f47535b8cd6e4f1a98aabb5 (local main matched it exactly)

## Current next action

Wave 2 runs in parallel worktrees: Tasks 3+8 (constraint controller + worker solver), Task 7 (data freshness), Task 5 (study pipeline, then data run and regeneration). The owner merges and verifies, then wave 3 (Task 6, final Task 4 browser smokes and documentation check).

## Task status

| Task | Status | Evidence / remaining work |
|---|---|---|
| 1 Optimizer | Verified (wave 1) | Both handoff fixtures, 400-slate exhaustive oracle, validation codes, bite tests. See "Wave 1" below |
| 2 Scoring | Core verified (wave 1) | Ruleset, nflverse/ESPN normalizers, weekly isolation, ESPN DST orientation fixed. Study consumers + regeneration move to Task 5 |
| 3 Constraints | Not started (wave 2) | Initial auto-solve still ignores constraints |
| 4 CI/testing | Part 1 verified (wave 1) | Scaffold failures fixed at the root, npm test honest on Windows, CI gates test+build+lint. Remaining: browser smokes with deterministic data, final docs check |
| 5 Reproducibility | Not started (wave 2) | Study scripts already call strict exact-dp |
| 6 Sharing/saves | Not started (wave 3) | |
| 7 Data freshness | Not started (wave 2) | |
| 8 Worker | Not started (wave 2) | |

## Wave 1 (merged into this branch at ceeb198)

Branches `wip/task1-optimizer` (0834cbd), `wip/task2-scoring` (814bfb7) and `wip/task4-ci-baseline` (6aa53bc) were merged with `--no-ff`. The only conflicts were in `package.json` and `ci.yml`. CI keeps one `npm test` step, which already runs `test:domain`, so the domain suite is not run twice.

The wave 1 agents ran on Opus 5, because Fable 5.1 was out of usage credits at launch.

### Task 1: solver contract (src/lib/optimizer.ts, src/lib/football/lineup-validation.ts)

- `solveLineup({players, cap, locked?, excluded?, requireStack?, method})` runs exactly one method (`exact-dp | hill-climb | greedy-proj | greedy-value`) with no fallback. It returns `SolveOk {status:"ok", method, optimality:"proven"|"heuristic", lineup, fallbackReason?}` or a failure:
  - `invalid-input` with codes invalid-cap, duplicate-player-id, invalid-position, invalid-salary, non-finite-projection, lock-exclude-overlap, unknown-lock, incompatible-locks, locks-over-cap, insufficient-pool, salary-precision.
  - `infeasible/no-legal-roster`, which only exact DP can report.
  - `error` with codes stack-not-proven, heuristic-no-lineup, reconstruction-failed, illegal-lineup, solver-limit.
- `optimizeLineup(...)` runs exact DP. When a stack is required and the DP optimum is unstacked, it returns a hill-climb lineup labelled heuristic with `fallbackReason`. Internal errors are returned, never masked.
- An ok `Lineup` has `slots` (QB, RB, RB, WR, WR, WR, TE, FLEX, DST), `players`, `salary`, `proj` and `remaining`. `validateRoster` checks every ok result. `scoreLineup` returns `{pts, n, missing}`.
- The DP state counts players per position (240 states). Decisions are stored as one take bit per player layer × state × salary cell. Salaries are indexed in their GCD unit, capped at 2000 units per cap, and never rounded. The pool is sorted by id; ties go to lower salary, then to lower ids.
- Measured on Node 26: the real 114-player slate uses 3.64 MB and solves in about 16–20 ms, with an optimum of 146.02 at $50,000, proven. The deterministic 300-player fixture uses 6.43 MB and solves in about 50–60 ms.
- Stack: the wrapper result on the real slate is a 144.49 hill-climb heuristic. An exact stacked DP was not built (estimated about 18 × the work).
- Known UI leftovers for Task 3: the "Value greedy" card still shows the greedy-proj result (baseline behavior), and the initial auto-solve ignores constraints.

### Task 2: scoring and weekly isolation (src/lib/football/*)

- Ruleset `gridiron-lab-ppr-dst@1` (`RULESET`, `RULESET_REF`):
  - Offense uses standard PPR weights: pass yd 0.04, pass TD 4, INT −2, rush/rec yd 0.1, rush/rec TD 6, reception 1, fumble lost −2, 2-pt 2, special-teams TD 6.
  - DST: sacks 1, INT 2, fumble recoveries 2, TD 6, safeties/defensive 2-pt 2, blocked kicks 2, plus DraftKings-style points-allowed tiers. Points allowed is the opponent's final score.
  - Each result is complete, partial (lists what's unavailable) or missing. There is no zero fill and no 24 fill.
- Real 2025 checks:
  - Offense scorer = nflverse `fantasy_points_ppr` on 18,540/18,540 REG rows.
  - All 272 REG games in nfldata `games.csv` have final scores.
  - Team points derived from team-week counts = final score on 544/544 team-games.
  - Team-week `def_sacks` is never fractional.
- ESPN team-box `interceptions`, `fumblesLost`, `sacksYardsLost` and `turnovers` are the team's own giveaways. This held on 28/28 team boxes in 2025 week 5. The live DST adapter was reversed and now reads takeaways from the opponent's box. On DET@CIN, event 401772854, the legacy adapter scored DET 6 / CIN 4; corrected: DET 10 / CIN 2, matching nflverse.
- nflverse DST takeaways come from the opponent's giveaway columns (`sacks_suffered`, `passing_interceptions`, `fumbles_lost_total`). The team's own `def_*` columns undercount sacks in 9/544 team-games and fumble recoveries in 3.
- Modules:
  - `csv.ts`: RFC 4180 parsing plus required-column errors.
  - `nflverse.ts`: `parsePlayerWeeks`, `parseTeamWeeks`, `parseSchedule`, `pointsAllowed`, `defenseWeeks`, `teamPointsFromCounts`.
  - `player-weeks.ts`: per-week rows keyed season + seasonType + week + player, and `aggregateSeason`.
  - `week-merge.ts`: `mergeCurrentWeek` joins only on the full week key, and a final zero counts.
  - `espn.ts`: pure ESPN parsing.
- `WeekSkill` gained `source` (`espn`/`nflverse`) and `score` meta. `WeekPpr`/`Scoreboard`/`LiveGame` gained `seasonType`, and `Scoreboard` gained `weekKey`.
- Fixtures in `tests/fixtures/football/` have `.source.json` sidecars (URL, retrieval date, original SHA-256).
- Not run: the live 2026 endpoints through the running app.

### Task 4 part 1: scaffold tests and CI

- Root causes of the baseline failures:
  - 8 grok-pwa tests read the repo's real `site.json`/`og.jpg` through `process.cwd()`. They now run in an empty workspace; there is no production bug.
  - 4 tests read gitignored Grok platform docs. They now skip with a stated reason when those docs are absent.
  - A real Windows bug in `with-app-env.mjs`: absolute executable paths went through cmd.exe unescaped, and that also created the stray `{}` file. Fixed, with a regression test.
  - Windows symlink EPERM, fixed with junctions, and a POSIX-only path assertion.
- `engines` is now `>=22.12.0`, verified on docker node:22.12.0 and node:22.23.2.
- The one lint error (empty catch) got a comment. CI now runs `npm test`, `npm run build` and `npm run lint` after typecheck.
- Leftover note: the root `packages[""]` engines field in package-lock.json still says `>=20.19.0`. It syncs on the next intentional lockfile update, and npm ci ignores it.

## Stage A baseline (2026-09-12, Windows 11, Node 26.3.0, npm 11.17.0)

Local checkout was on `main` at ce5d6b1 with one uncommitted user change: `package-lock.json` (67 deleted lines, optional peer entries ajv/fast-uri/json-schema-traverse/require-from-string). It is the user's change. Never stage or commit it.

No `AGENTS.md` or `CLAUDE.md` in the checkout (`AGENTS.md` and `.grok/*` are gitignored). GitHub Actions CI was green on ce5d6b1 (typecheck job only).

Installed versions: @tanstack/react-router 1.170.33, @tanstack/react-start 1.168.50, @tanstack/react-query 5.102.8, vite 8.2.2, zod 4.5.4, playwright 1.63.0 (Chromium 1243 installed locally), typescript 5.9.3, react 19.2.8. Docker 29.7.2 is available for Linux parity runs; WSL Ubuntu has no Node.

| Command | Baseline result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm test` | exit 0 but misleading on Windows: the single-quoted scripts glob matched 0 files under cmd.exe |
| `node --test scripts/*.test.mjs` | Windows 197 tests / 18 fail; Linux (docker node:22) 197 / 12 fail |
| `npm run lint` | exit 1: 1 error, 5 warnings |
| `npm run build` (no DATABASE_URL) | exit 0, migrator skipped |

Fantasy slate facts: 114 players (QB 18, RB 28, WR 36, TE 16, DST 16), every salary a multiple of $100 ($2,000–$9,200), no duplicate IDs, no negative projections.

## Decisions every task follows

1. **Test runner.** Native `node:test` with `node --experimental-strip-types --test`. Pure domain tests live in `tests/domain/**/*.test.ts`, pure controller/state tests in `tests/ui/**/*.test.ts`, small checked-in fixtures in `tests/fixtures/football/`. `tests` is in the tsconfig `include`. Quote globs with double quotes in package.json.
2. **Import rule for anything Node executes** (scripts, tests, the pure solver/scoring/state modules): relative imports with explicit `.ts` extensions, runtime imports never use the `@/` alias, `@/` is allowed only in `import type`. No runtime JSON imports in those modules; scripts read JSON with `fs`, and callers pass data in.
3. **Node version.** Node 22.12+ (engines), CI on Node 22.
4. **No new dependencies** unless a task cannot be done sensibly without one; no lockfile churn.
5. **Solver contract** is the Task 1 API above. Every caller uses it.
6. **Scoring** is `gridiron-lab-ppr-dst@1`, documented as the project's simplified DraftKings-inspired rules, not exact platform scoring. Missing inputs stay missing.
7. **Study regeneration happens once, in Task 5**, with a before/after report that attributes changes to solver, scoring, included weeks, and universe/multi-season separately.
8. **Git.** Each wave task works on its own branch off this integration branch and makes coherent local commits. Nothing is pushed, merged to `main`, or deployed.
9. Only the owner thread edits this file.

## Verification

| When | Command | Environment | Result |
|---|---|---|---|
| Wave 1 merge (ceeb198) | `npm run typecheck` | Windows, Node 26.3.0 | exit 0 |
| Wave 1 merge | `npm test` | Windows, Node 26.3.0 | scripts 198 tests: 194 pass, 0 fail, 4 skipped; TS scaffold 55/55; domain 131/131; exit 0 |
| Wave 1 merge | `npx eslint . --ignore-pattern ".claude/**"` | Windows | 0 errors, 5 warnings (the ignore only skips local agent worktrees) |
| Wave 1 merge | `npm run build` (no DATABASE_URL) | Windows | exit 0 |
| Wave 1 merge | clean `git archive` of HEAD: `npm ci`, routes:generate, typecheck, `npm test`, build, lint | Docker node:22.23.2 | all exit 0; same test counts; lint 0 errors |

GitHub Actions has not run on this branch (nothing pushed).

## Data artifacts

- Input cache path and hashes: pending Task 5 (Task 2 verified 2025 source bytes: stats_player_week_2025.csv sha256 e5e0615b…, stats_team_week_2025.csv 91058a59…, nfldata games.csv e5443356…, retrieved 2026-09-12)
- Ruleset: `gridiron-lab-ppr-dst@1`
- Generated outputs: `src/data/study-*.json` unchanged from baseline so far
- Regeneration status: not started (Task 5)

## Uncommitted work

- `package-lock.json`: user's pre-existing change, deliberately left unstaged.

## Blockers

None.

## Decisions not to repeat

- The broad source audit is done (handoff + Stage A reads). Do not repeat it; read the task section and the files it names.
- ESPN team-box takeaway orientation is settled (giveaways); do not re-derive it.
- Do not duplicate `test:domain` as its own CI step; `npm test` runs it.
