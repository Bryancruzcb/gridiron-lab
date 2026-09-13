/**
 * Causal projection bake-off (the eight methods, strict exact DP) via the shared study library.
 * Defaults: 2025, the shipped slate, src/data/study-projections.json. Accepts the scripts/study.ts
 * flags except --models (see --help).
 */
import { fileURLToPath } from "node:url";
import { toProjectionFile } from "./lib/study/legacy-files.ts";
import { runLegacyWrapper } from "./lib/study/wrapper.ts";

await runLegacyWrapper({
  repoRoot: fileURLToPath(new URL("..", import.meta.url)),
  argv: process.argv.slice(2),
  models: "projections",
  qbLag: false,
  defaultOut: "src/data/study-projections.json",
  toLegacy: toProjectionFile,
  pretty: true,
});
