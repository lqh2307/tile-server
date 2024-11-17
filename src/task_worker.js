"use strict";

import { parentPort, workerData } from "node:worker_threads";
import { restartServer } from "./utils.js";
import { printLog } from "./logger.js";
import { runTask } from "./task.js";

(async () => {
  try {
    printLog("info", "Starting seed and clean up task...");

    /* Run task */
    await runTask(workerData);

    /* Restart server */
    if (workerData.restartServerAfterTask === true) {
      printLog(
        "info",
        "Completed seed and clean up task. Restarting server..."
      );

      restartServer().catch(() =>
        printLog("error", `Failed to restart server: ${error}`)
      );
    }
  } catch (error) {
    parentPort.postMessage({
      error: error,
    });
  }
})();
