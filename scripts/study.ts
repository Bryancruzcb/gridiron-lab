// Reproducible study runs over versioned inputs. Usage: npm run study:build -- --help
import { fileURLToPath } from "node:url";
import { describeFailure, parsePublishArgs, parseStudyArgs, PUBLISH_USAGE, STUDY_USAGE } from "./lib/study/cli.ts";
import { runPublishCommand, runStudyCommand } from "./lib/study/command.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === "publish") {
    const publish = parsePublishArgs(argv.slice(1));
    if (publish.help) console.log(PUBLISH_USAGE);
    else runPublishCommand(publish, { log: (message) => console.log(message) });
    return;
  }
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
