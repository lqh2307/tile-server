"use strict";

import { config, loadConfigFile } from "./config.js";
import { serve_common, serveReadyHandler } from "./serve_common.js";
import { serve_rendered } from "./serve_rendered.js";
import { serve_template } from "./serve_template.js";
import { serve_sprite } from "./serve_sprite.js";
import { serve_style } from "./serve_style.js";
import { serve_font } from "./serve_font.js";
import { serve_data } from "./serve_data.js";
import { printLog } from "./utils.js";
import express from "express";
import morgan from "morgan";
import cors from "cors";

/**
 * Start server
 * @param {string} dataDir
 * @returns {Promise<void>}
 */
export async function startServer(dataDir) {
  try {
    printLog("info", `Loading config file...`);

    await loadConfigFile(dataDir);

    printLog("info", `Starting HTTP server...`);

    express()
      .disable("x-powered-by")
      .enable("trust proxy")
      .use(cors())
      .use(morgan(`[PID = ${process.pid}] ${config.options.loggerFormat}`))
      .use("/", serve_common.init())
      .use("/", serveReadyHandler(), serve_template.init())
      .use("/data", serveReadyHandler(), serve_data.init())
      .use("/fonts", serveReadyHandler(), serve_font.init())
      .use("/sprites", serveReadyHandler(), serve_sprite.init())
      .use("/styles", serveReadyHandler(), serve_style.init())
      .use("/styles", serveReadyHandler(), serve_rendered.init())
      .listen(config.options.listenPort, () => {
        printLog(
          "info",
          `HTTP server is listening on port: ${config.options.listenPort}`
        );
      })
      .on("error", (error) => {
        printLog("error", `HTTP server is stopped by: ${error}`);
      });

    printLog("info", `Loading data...`);

    Promise.all([serve_font.add(), serve_sprite.add(), serve_data.add()])
      .then(() => serve_style.add())
      .then(() => serve_rendered.add())
      .then(() => {
        printLog("info", `Completed startup!`);

        config.startupComplete = true;
      })
      .catch((error) => {
        printLog("error", `Failed to load data: ${error}. Exited!`);

        process.kill(Number(process.env.MAIN_PID), "SIGINT");
      });
  } catch (error) {
    printLog("error", `Failed to start server: ${error}. Exited!`);

    process.kill(Number(process.env.MAIN_PID), "SIGINT");
  }
}
