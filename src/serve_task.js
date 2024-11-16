"use strict";

import { cancelTask, startTask } from "./utils.js";
import { StatusCodes } from "http-status-codes";
import fsPromise from "node:fs/promises";
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

function getTaskInfoHandler() {
  return async (req, res, next) => {
    try {
      let taskInfo = {};

      try {
        taskInfo = await fsPromise.readFile("server-info.json", "utf8");
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
      }

      res.header("Content-Type", "application/json");

      return res.status(StatusCodes.OK).send(taskInfo);
    } catch (error) {
      printLog("error", `Failed to get task info": ${error}`);

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

    /**
     * @swagger
     * tags:
     *   - name: Task
     *     description: Task related endpoints
     * /tasks/info:
     *   get:
     *     tags:
     *       - Task
     *     summary: Get task info
     *     responses:
     *       200:
     *         content:
     *           application/json:
     *             schema:
     *               type: object
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
    app.get("/info", getTaskInfoHandler());

    return app;
  },
};
