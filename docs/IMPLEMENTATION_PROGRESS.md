# Gridiron Lab implementation progress

Updated: 2026-09-12
Branch: handoff/eight-improvements (local only, not pushed)
Current HEAD: see `git log -1`
Reviewed handoff baseline: ce5d6b1c0e2821305f47535b8cd6e4f1a98aabb5 (local main matched it exactly)

## Current next action

Stage B + C + scaffold-test diagnosis run in parallel worktrees (wave 1), then the owner merges them into this branch.

## Task status

| Task | Status | Evidence / remaining work |
|---|---|---|
| 1 Optimizer | In progress (wave 1) | |
| 2 Scoring | In progress (wave 1: scoring module, live adapters, weekly isolation) | Study regeneration moves to Task 5 |
| 3 Constraints | Not started (wave 2) | |
| 4 CI/testing | In progress (wave 1: scaffold failures, Node alignment, build gate) | Browser smokes in the final wave |
| 5 Reproducibility | Not started (wave 2) | |
| 6 Sharing/saves | Not started (wave 3) | |
| 7 Data freshness | Not started (wave 2) | |
| 8 Worker | Not started (wave 2) | |

## Stage A baseline (2026-09-12, Windows 11, Node 26.3.0, npm 11.17.0)

Local checkout was on `main` at ce5d6b1 with one uncommitted user change: `package-lock.json` (67 deleted lines, optional peer entries ajv/fast-uri/json-schema-traverse/require-from-string). It is the user's change. Never stage or commit it.

No `AGENTS.md` or `CLAUDE.md` in the checkout (`AGENTS.md` and `.grok/*` are gitignored). GitHub Actions CI was green on ce5d6b1 (typecheck job only).

Installed versions: @tanstack/react-router 1.170.33, @tanstack/react-start 1.168.50, @tanstack/react-query 5.102.8, vite 8.2.2, zod 4.5.4, playwright 1.63.0 (Chromium 1243 installed locally), typescript 5.9.3, react 19.2.8. Docker 29.7.2 is available for Linux parity runs; WSL Ubuntu has no Node.

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm test` | exit 0, but misleading on Windows: the single-quoted glob `'scripts/**/*.test.mjs'` matched 0 files under cmd.exe; only the 4 TS files ran (55 tests pass) |
| `node --test scripts/*.test.mjs` | 197 tests, 179 pass, 18 fail on Windows (3x missing gitignored `.grok/skills/og/SKILL.md`, 8x grok-pwa-plugin og:title/og:image expectations, symlink EPERM, with-app-env spawn tests, vite local-package test, og hand-over test). Linux behavior not yet checked |
| `npm run lint` | exit 1: 1 error (`src/lib/app-data/client.server.ts:281` no-empty), 5 warnings |
| `npm run build` (no DATABASE_URL) | exit 0, Vercel output in `.vercel/output`, migrator skipped |

Fantasy slate facts: 114 players (QB 18, RB 28, WR 36, TE 16, DST 16), every salary a multiple of $100 ($2,000–$9,200), no duplicate IDs, no negative projections.

## Decisions every task follows

1. **Test runner.** Native `node:test` with `node --experimental-strip-types --test`. Pure domain tests live in `tests/domain/**/*.test.ts`, pure controller/state tests in `tests/ui/**/*.test.ts`, small checked-in fixtures in `tests/fixtures/football/`. `tests` is added to the tsconfig `include` so tests typecheck. Quote globs with double quotes in package.json (single quotes break on Windows cmd).
2. **Import rule for anything Node executes** (scripts, tests, the pure solver/scoring/state modules): relative imports with explicit `.ts` extensions, runtime imports never use the `@/` alias, `@/` is allowed only in `import type`. No runtime JSON imports in those modules; scripts read JSON with `fs`, and callers pass data in.
3. **Node version.** Target Node 22.12+ (Vite 8 floor, strip-types available). CI stays on Node 22. Engines and README get aligned to that.
4. **No new dependencies** unless a task cannot be done sensibly without one; no lockfile churn. Playwright, Zod, TanStack Router/Query are already installed.
5. **Solver contract** (Task 1 owns it): `SolveResult` = `{status:"ok", method, optimality:"proven"|"heuristic", lineup, fallbackReason?}` or `{status:"invalid-input"|"infeasible"|"error", code, message}`. Every caller migrates; no nullable legacy API left in use.
6. **Scoring** (Task 2 owns it): one pure, named, versioned ruleset in `src/lib/football/scoring.ts`, documented as the project's simplified DraftKings-inspired PPR/DST rules, not exact platform scoring. Points allowed = opponent's final game score from a schedule/game source. Missing inputs stay missing (no 24-point or zero fill).
7. **Study regeneration happens once, in Task 5**, with a before/after report that attributes changes to scoring, solver, included weeks, and model comparison separately.
8. **Git.** Each wave task works on its own branch off this integration branch and makes coherent local commits. Nothing is pushed, merged to `main`, or deployed.
9. Only the owner thread edits this file.

## Verification

(filled per stage)

## Data artifacts

- Input cache path and hashes: pending Task 5
- Ruleset/model configuration: pending Tasks 2 and 5
- Generated outputs: unchanged from baseline so far
- Regeneration status: not started

## Uncommitted work

- `package-lock.json`: user's pre-existing change, deliberately left unstaged.

## Blockers

None yet.

## Decisions not to repeat

- The broad source audit is done (handoff + Stage A reads). Do not repeat it; read the task section and the files it names.
