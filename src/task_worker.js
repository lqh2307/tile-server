"use strict";

import { parentPort, workerData } from "node:worker_threads";
import { runTask, updateTaskInfoFile } from "./task.js";

(async () => {
  try {
    /* Store start task time */
    await updateTaskInfoFile({
      startTask: new Date().toISOString(),
    });

    /* Run task */
    await runTask(workerData);

    /* Store done task time */
    await updateTaskInfoFile({
      doneTask: new Date().toISOString(),
    });
  } catch (error) {
    parentPort.postMessage({
      error: error,
    });
  }
})();
