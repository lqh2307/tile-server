"use strict";

import { cancelTask, startTask } from "./task.js";
import { StatusCodes } from "http-status-codes";
import { printLog } from "./logger.js";
import express from "express";

function startTaskHandler() {
  return async (req, res, next) => {
    try {
      setTimeout(() => {
        startTask().catch(() =>
          printLog("error", `Failed to start task: ${error}`)
        );
      }, 0);

      return res.status(StatusCodes.OK).send("OK");
    } catch (error) {
      printLog("error", `Failed to start task": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

function cancelTaskHandler() {
  return async (req, res, next) => {
    try {
      setTimeout(() => {
        cancelTask().catch(() =>
          printLog("error", `Failed to cancel task: ${error}`)
        );
      }, 0);

      return res.status(StatusCodes.OK).send("OK");
    } catch (error) {
      printLog("error", `Failed to cancel task": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
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
     *       400:
     *         description: Bad request
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
     *       400:
     *         description: Bad request
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
