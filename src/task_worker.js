"use strict";

import { parentPort, workerData } from "node:worker_threads";
import { printLog } from "./logger.js";
import { runTasks } from "./task.js";

(async () => {
  try {
    printLog("info", "Starting seed and clean up task...");

    /* Run task */
    await runTasks(workerData);

    /* Restart server */
    if (workerData.restartServerAfterTask !== "false") {
      printLog(
        "info",
        "Completed seed and clean up task. Restarting server..."
      );

      parentPort.postMessage({
        action: "restartServer",
      });
    }
  } catch (error) {
    parentPort.postMessage({
      error: error,
    });
  }
})();
