"use strict";

import { serve_rendered } from "./serve_rendered.js";
import { serve_template } from "./serve_template.js";
import { serve_common } from "./serve_common.js";
import { serve_sprite } from "./serve_sprite.js";
import { serve_style } from "./serve_style.js";
import { loadConfigFile } from "./config.js";
import { serve_font } from "./serve_font.js";
import { serve_data } from "./serve_data.js";
import { printLog } from "./utils.js";
import express from "express";
import morgan from "morgan";
import cors from "cors";

/**
 * Start server
 * @returns {Promise<void>}
 */
export async function startServer() {
  try {
    printLog("info", `Loading config file...`);

    const config = await loadConfigFile();

    printLog("info", `Starting HTTP server...`);

    express()
      .disable("x-powered-by")
      .enable("trust proxy")
      .use(cors())
      .use(morgan(`[PID = ${process.pid}] ${config.options.loggerFormat}`))
      .use("/", serve_common.init())
      .use("/", serve_template.init())
      .use("/data", serve_data.init())
      .use("/fonts", serve_font.init())
      .use("/sprites", serve_sprite.init())
      .use("/styles", serve_style.init())
      .use("/styles", serve_rendered.init())
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
