"use strict";

import { parentPort, workerData } from "node:worker_threads";
import { restartServer } from "./utils.js";
import { printLog } from "./logger.js";
import { runTasks } from "./task.js";

(async () => {
  try {
    printLog("info", "Starting seed and clean up task...");

    /* Run task */
    await runTasks(workerData);

    /* Restart server */
    if (workerData.restartServerAfterTask === true) {
      printLog(
        "info",
        "Completed seed and clean up task. Restarting server..."
      );

      restartServer().catch((error) =>
        printLog("error", `Failed to restart server: ${error}`)
      );
    }
  } catch (error) {
    parentPort.postMessage({
      error: error,
    });
  }
})();
