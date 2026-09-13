# Optimizer worker: responsiveness evidence

Measured 2026-09-12 by `tests/e2e/optimizer-perf.mjs` in headless Chromium 153.0.8010.12 through Playwright 1.63. Machine: Windows 11 (10.0.26200), Intel Core Ultra 7 155H (22 logical), 15.5 GB RAM, Node 26.3.0. "Before" is integration commit c769532, where every solve runs on the main thread. "After" is this branch, where solves run in the module worker. Before and after ran against their own dev servers and their own production builds (`vite preview`), with the week-score server function stubbed by a fixed fixture so both sides solved identical inputs. Each configuration ran twice (r1, r2). The two sides alternated on the same machine, which was also running other builds, so a single number moves by tens of milliseconds between runs. Treat the ranges below as ranges.

Metrics: **long tasks** = Long Tasks API entries in the window (count / longest / total ms). **Frame gap** = longest gap between `requestAnimationFrame` callbacks. **Key latency** = keydown timestamp to the next animation frame while a script types into an input.

## The solver on its own (probes)

Probes load the solver modules from the dev server. They run the same lineup job, first without and then with a stack requirement, five times on the main thread ("main") or through the optimizer worker ("worker"), while keys go into a plain input on an otherwise empty page.

| Pool | Where | Solver median (ms) | Round trip median (ms) | Long tasks | Max frame gap (ms) | Key latency median / max (ms) |
|---|---|---|---|---|---|---|
| Real slate, 114 players, $50k | main | 19–25 | — | 0 | 51–61 | 7–12 / 47–58 |
| Real slate, 114 players, $50k | worker | 20–23 | 32–44 | 0 | 59–77 | 7–10 / 55–76 |
| Fixture, 300 players, $50k | main | 66–181 | — | 10 (longest 91–263, total 682–1,834) | 95–268 | 9–11 / 91–209 |
| Fixture, 300 players, $50k | worker | 76–87 | 94–100 | 0 | 26–29 | 6–7 / 21–26 |

Results matched on both sides: exact-dp, proven, 146.02 on the real slate and 261.03 on the fixture; the stacked request was hill-climb, heuristic, 144.49 and 256.80.

The 300-player fixture is `randomPool(seeded(300), 300, { unit: 100, teams: 12 })` from `tests/domain/support/slates.ts`.

## The page (real 114-player slate)

Three windows go through the page's own controls:
- *week arrives*: week scores load and the whole-slate comparison runs.
- *hindsight toggle + typing*: the mode switches to actuals while the script types into the search box.
- *stacked run + typing*: the stack box is checked, Build lineup is pressed, and the script types.

| Window | Build | Before: long tasks / max gap / key median | After: long tasks / max gap / key median |
|---|---|---|---|
| Week arrives | preview | 1 (53–57 ms) / 59–66 ms / — | 0 / 63–122 ms / — |
| Hindsight toggle + typing | preview | 13 (90–98 ms) / 116–153 ms / 65–70 ms | 8–12 (84–89 ms) / 139–153 ms / 78–84 ms |
| Stacked run + typing | preview | 3–4 (77–101 ms) / 110–146 ms / 25–27 ms | 6–7 (69–77 ms) / 126–159 ms / 57–76 ms |
| Week arrives | dev | 1 (235–499 ms) / 247–499 ms / — | 1 (182–331 ms) / 34–341 ms / — |

Dev-server page windows varied by up to about 3x between runs on both sides (unbundled modules, React development checks), so they are not used for conclusions.

## What this shows

- **The worker removes solver-induced main-thread blocking.** On the 300-player pool the main-thread solve produced 10 long tasks up to 263 ms and frame gaps up to 268 ms. Through the worker there were no long tasks, and frame gaps stayed under 30 ms. The solve took about the same time; it just stopped blocking the page.
- **On the shipped 114-player slate the solver was never the bottleneck.** An exact solve takes about 20 ms, under the 50 ms long-task threshold, and neither side showed solver-attributable long tasks. The page's remaining long tasks and key latency during typing come from React re-rendering the filtered player table and tooltips on each keystroke, which happens in both builds. The worker does not change that, and this branch does not claim a typing-latency improvement on the real slate. The "after" key medians in the production page windows are somewhat higher. That fits the page also re-rendering the status and result card as worker replies arrive, and it is within this machine's run-to-run spread. A typing-only A/B (no solves) to separate those costs was not run.
- **Behavior checks** (`tests/e2e/optimizer-flows.mjs`, 8/8 against both dev and preview):
  - initial solve in the worker, with the production worker asset served from `/assets/optimizer.worker-*.js`
  - constraints kept across a mode switch and restore
  - a conflicting import rejected with no lineup
  - cancel stops the running solve
  - rapid repeated runs: 8 workers constructed, 8 terminated, 6 superseded, 0 left after leaving the route
  - navigating away mid-solve
  - worker construction failure, and a worker script error, each shown as a recoverable error

## Reproduce

```bash
npm run build
node scripts/with-app-env.mjs vite preview --port 18481 --strictPort   # after build
node tests/e2e/optimizer-perf.mjs --base http://127.0.0.1:18481 --label after-preview
node scripts/with-app-env.mjs vite dev --host 127.0.0.1 --port 18480 --strictPort
node tests/e2e/optimizer-perf.mjs --base http://127.0.0.1:18480 --label after-dev --probe main,worker
```

For "before", check out c769532 into a separate directory, build or start it on another port, and pass that base URL. Probes need a dev server of the "after" code, because the worker probe loads `src/workers/optimizer.worker.ts`.
