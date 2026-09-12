/**
 * Exploratory EWMA alpha sweep against the trailing mean via the shared study library. Defaults:
 * 2025, the shipped slate, src/data/study-ewma.json. Accepts the scripts/study.ts flags except
 * --models (see --help).
 */
import { fileURLToPath } from "node:url";
import { toEwmaFile } from "./lib/study/legacy-files.ts";
import { runLegacyWrapper } from "./lib/study/wrapper.ts";

await runLegacyWrapper({
  repoRoot: fileURLToPath(new URL("..", import.meta.url)),
  argv: process.argv.slice(2),
  models: "ewma-sweep",
  qbLag: false,
  defaultOut: "src/data/study-ewma.json",
  toLegacy: toEwmaFile,
  pretty: true,
});
