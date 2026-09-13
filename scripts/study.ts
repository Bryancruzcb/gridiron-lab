// Reproducible study runs over versioned inputs. Usage: npm run study:build -- --help
import { fileURLToPath } from "node:url";
import {
  describeFailure,
  FACTS_USAGE,
  parseFactsArgs,
  parsePublishArgs,
  parseStudyArgs,
  PUBLISH_USAGE,
  STUDY_USAGE,
} from "./lib/study/cli.ts";
import { runFactsCommand, runPublishCommand, runStudyCommand } from "./lib/study/command.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

async function main() {
  const argv = process.argv.slice(2);
  const log = (message: string) => console.log(message);
  if (argv[0] === "publish") {
    const publish = parsePublishArgs(argv.slice(1));
    if (publish.help) console.log(PUBLISH_USAGE);
    else runPublishCommand(publish, { log });
    return;
  }
  if (argv[0] === "facts") {
    const facts = parseFactsArgs(argv.slice(1));
    if (facts.help) console.log(FACTS_USAGE);
    else runFactsCommand(facts, { log });
    return;
  }
  const opts = parseStudyArgs(argv, { repoRoot });
  if (opts.help) {
    console.log(STUDY_USAGE);
    return;
  }
  await runStudyCommand(opts, { repoRoot, command: argv, log });
}

main().catch((e) => {
  console.error(describeFailure(e));
  process.exitCode = 1;
});
