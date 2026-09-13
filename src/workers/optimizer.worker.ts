// Module worker entry for lineup solves. All logic lives in handleWorkerRequest so Node tests run
// the same code; the page terminates this worker to cancel a solve.
import { optimizeLineup, solveLineup } from "../lib/optimizer.ts";
import { handleWorkerRequest } from "../lib/lineup/worker-protocol.ts";

const solvers = { optimizeLineup, solveLineup };

self.onmessage = (event: MessageEvent<unknown>) => {
  self.postMessage(handleWorkerRequest(event.data, solvers));
};
