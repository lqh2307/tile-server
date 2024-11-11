"use strict";

import { parentPort, workerData } from "node:worker_threads";
import { runTask } from "./task.js";

(async () => {
  try {
    await runTask(workerData);
  } catch (error) {
    parentPort.postMessage({
      error: error,
    });
  }
})();
