"use strict";

import { updateServerInfoFileWithLock } from "./utils.js";
import { Worker } from "node:worker_threads";
import fsPromise from "node:fs/promises";
import { printLog } from "./logger.js";
import { config } from "./config.js";

let currentTaskWorker;

export function startTaskInWorker() {
  if (currentTaskWorker === undefined) {
    new Worker("./src/task_worker.js", {
      workerData: {
        dataDir: config.paths.dir,
        removeOldCacheLocks: req.query.removeOldCacheLocks === "true",
        cleanUp: req.query.cleanUp === "true",
        seed: req.query.seed === "true",
      },
    })
      .on("message", (message) => {
        if (message.error) {
          printLog("error", `Task failed: ${message.error}`);
        }

        currentTaskWorker = undefined;
      })
      .on("error", (error) => {
        printLog("error", `Task worker error: ${error}`);

        currentTaskWorker = undefined;
      })
      .on("exit", (code) => {
        if (code !== 0) {
          printLog("error", `Task worker stopped with exit code: ${code}`);
        }

        currentTaskWorker = undefined;
      });
  } else {
    printLog("warning", "A task is already running. Skipping start task...");
  }
}

export function cancelTaskInWorker() {
  if (currentTaskWorker !== undefined) {
    currentTaskWorker
      .terminate()
      .then(() => {
        currentTaskWorker = undefined;
      })
      .catch((error) => {
        printLog("error", `Task worker error: ${error}`);
      });
  } else {
    printLog(
      "warning",
      "No task is currently running. Skipping cancel task..."
    );
  }
}

/**
 * Start task
 * @returns {Promise<void>}
 */
export async function startTask() {
  const taskPID = await getTaskPID();

  if (taskPID === undefined) {
    await updateServerInfoFileWithLock(
      {
        taskPID: process.pid,
      },
      60000 // 1 mins
    );

    process.kill(process.pid, "SIGUSR1");
  } else {
    process.kill(taskPID, "SIGUSR1");
  }
}

/**
 * Cancel task
 * @returns {Promise<void>}
 */
export async function cancelTask() {
  const taskPID = await getTaskPID();

  if (taskPID !== undefined) {
    await updateServerInfoFileWithLock(
      {
        taskPID: undefined,
      },
      60000 // 1 mins
    );

    process.kill(taskPID, "SIGUSR2");
  }
}
/**
 * Get task PID
 * @returns {Promise<number>}
 */
async function getTaskPID() {
  try {
    const data = await fsPromise.readFile("server-info.json", "utf8");

    return JSON.parse(data).taskPID;
  } catch (error) {
    if (error.code === "ENOENT") {
      return;
    }

    throw error;
  }
}
