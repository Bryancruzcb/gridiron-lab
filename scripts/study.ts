// Reproducible study runs over versioned inputs. Usage: npm run study:build -- --help
import { fileURLToPath } from "node:url";
import { describeFailure, parseStudyArgs, STUDY_USAGE } from "./lib/study/cli.ts";
import { runStudyCommand } from "./lib/study/command.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

async function main() {
  const argv = process.argv.slice(2);
  const opts = parseStudyArgs(argv, { repoRoot });
  if (opts.help) {
    console.log(STUDY_USAGE);
    return;
  }
  await runStudyCommand(opts, { repoRoot, command: argv, log: (message) => console.log(message) });
}

main().catch((e) => {
  console.error(describeFailure(e));
  process.exitCode = 1;
});
