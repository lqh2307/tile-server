"use strict";

import { checkReadyMiddleware } from "./middleware.js";
import { cancelTask, startTask } from "./utils.js";
import { StatusCodes } from "http-status-codes";
import { printLog } from "./logger.js";
import express from "express";

/**
 * Start task handler
 * @returns {(req: any, res: any, next: any) => Promise<any>}
 */
function startTaskHandler() {
  return async (req, res, next) => {
    try {
      setTimeout(() => startTask(), 0);

      return res.status(StatusCodes.OK).send("OK");
    } catch (error) {
      printLog("error", `Failed to start task": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

/**
 * Cancel task handler
 * @returns {(req: any, res: any, next: any) => Promise<any>}
 */
function cancelTaskHandler() {
  return async (req, res, next) => {
    try {
      setTimeout(() => cancelTask(), 0);

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
    const app = express().disable("x-powered-by");

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
    app.get("/start", checkReadyMiddleware(), startTaskHandler());

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
    app.get("/cancel", checkReadyMiddleware(), cancelTaskHandler());

    return app;
  },
};
