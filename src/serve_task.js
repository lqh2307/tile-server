"use strict";

import { checkReadyMiddleware } from "./middleware.js";
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
      setTimeout(
        () =>
          process.send({
            action: "startTask",
            cleanUpStyles: req.query.cleanUpStyles === "true",
            cleanUpDatas: req.query.cleanUpDatas === "true",
            seedStyles: req.query.seedStyles === "true",
            seedDatas: req.query.seedDatas === "true",
          }),
        0
      );

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
      setTimeout(
        () =>
          process.send({
            action: "cancelTask",
          }),
        0
      );

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
     *     parameters:
     *       - in: query
     *         name: cleanUpStyles
     *         schema:
     *           type: boolean
     *         required: false
     *         description: Run clean up styles
     *       - in: query
     *         name: cleanUpDatas
     *         schema:
     *           type: boolean
     *         required: false
     *         description: Run clean up datas
     *       - in: query
     *         name: seedStyles
     *         schema:
     *           type: boolean
     *         required: false
     *         description: Run seed styles
     *       - in: query
     *         name: seedDatas
     *         schema:
     *           type: boolean
     *         required: false
     *         description: Run seed datas
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
