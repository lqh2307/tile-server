"use strict";

import { parentPort, workerData } from "node:worker_threads";
import { startTask } from "./seed_and_cleanup.js";

(async () => {
  try {
    await startTask(workerData.opts);

    parentPort.postMessage({
      success: true,
    });
  } catch (error) {
    parentPort.postMessage({
      error: error.message,
    });
  }
})();
