"use strict";

import { parentPort, workerData } from "node:worker_threads";
import { startTask } from "./seed_and_cleanup.js";

(async () => {
  try {
    await startTask(workerData);
  } catch (error) {
    parentPort.postMessage({
      error: error,
    });
  }
})();
