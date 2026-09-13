/**
 * Trailing-mean backtest (exact DP vs the two greedy baselines) and the QB lag study, via the
 * shared study library. Defaults: 2025, the shipped slate, src/data/study-backtest.json and
 * src/data/study-qb-lag.json. Accepts the scripts/study.ts flags except --models (see --help).
 */
import { fileURLToPath } from "node:url";
import { toBacktestFile } from "./lib/study/legacy-files.ts";
import { runLegacyWrapper } from "./lib/study/wrapper.ts";

await runLegacyWrapper({
  repoRoot: fileURLToPath(new URL("..", import.meta.url)),
  argv: process.argv.slice(2),
  models: "backtest",
  qbLag: true,
  defaultOut: "src/data/study-backtest.json",
  toLegacy: toBacktestFile,
  pretty: false,
});
