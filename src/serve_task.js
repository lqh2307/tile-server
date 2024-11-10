"use strict";

import { StatusCodes } from "http-status-codes";
import { Worker } from "node:worker_threads";
import { config } from "./config.js";
import express from "express";

let currentTaskWorker;

function startTaskHandler() {
  return (req, res) => {
    if (currentTaskWorker !== undefined) {
      return res
        .status(StatusCodes.BAD_REQUEST)
        .send("A task is already running");
    }

    currentTaskWorker = new Worker("src/task_worker.js", {
      workerData: {
        dataDir: config.paths.dir,
        removeOldCacheLocks: req.query.removeOldCacheLocks === "true",
        cleanUp: req.query.cleanUp === "true",
        seed: req.query.seed === "true",
      },
    });

    currentTaskWorker.on("message", (message) => {
      if (message.error) {
        printLog("error", `Task failed: ${message.error}`);
      }

      currentTaskWorker = undefined;
    });

    currentTaskWorker.on("error", (error) => {
      printLog("error", `Worker error: ${error}`);

      currentTaskWorker = undefined;
    });

    currentTaskWorker.on("exit", (code) => {
      if (code !== 0) {
        printLog("error", `Worker stopped with exit code: ${code}`);
      }

      currentTaskWorker = undefined;
    });

    res.status(StatusCodes.OK).send("Task started successfully");
  };
}

function cancelTaskHandler() {
  return (req, res) => {
    if (!currentTaskWorker) {
      return res
        .status(StatusCodes.BAD_REQUEST)
        .send("No task is currently running");
    }

    currentTaskWorker.terminate().then(
      () => {
        res.status(StatusCodes.OK).send("Task has been cancelled");

        currentTaskWorker = undefined;
      },
      (error) => {
        printLog("error", `Failed to cancel task: ${error}`);

        res
          .status(StatusCodes.INTERNAL_SERVER_ERROR)
          .send(`Failed to cancel task: ${error.message}`);
      }
    );
  };
}

export const serve_task = {
  init: () => {
    const app = express();

    /**
     * @swagger
     * tags:
     *   - name: Task
     *     description: Task related endpoints
     * /tasks/start:
     *   get:
     *     tags:
     *       - Task
     *     summary: Start task
     *     parameters:
     *       - name: removeOldCacheLocks
     *         in: query
     *         required: false
     *         schema:
     *           type: boolean
     *         description: Whether to remove old cache locks
     *       - name: cleanUp
     *         in: query
     *         required: false
     *         schema:
     *           type: boolean
     *         description: Whether to perform cleanup
     *       - name: seed
     *         in: query
     *         required: false
     *         schema:
     *           type: boolean
     *         description: Whether to perform seeding
     *     responses:
     *       200:
     *         description: Task started successfully
     *       404:
     *         description: Not found
     *       503:
     *         description: Server is starting up
     *         content:
     *           text/plain:
     *             schema:
     *               type: string
     *               example: Starting...
     *       500:
     *         description: Internal server error
     */
    app.get("/start", startTaskHandler());

    /**
     * @swagger
     * tags:
     *   - name: Task
     *     description: Task related endpoints
     * /tasks/cancel:
     *   get:
     *     tags:
     *       - Task
     *     summary: Cancel the running task
     *     responses:
     *       200:
     *         description: Task cancelled successfully
     *       404:
     *         description: Not found
     *       503:
     *         description: Server is starting up
     *         content:
     *           text/plain:
     *             schema:
     *               type: string
     *               example: Starting...
     *       500:
     *         description: Internal server error
     */
    app.get("/cancel", cancelTaskHandler());

    return app;
  },
};
