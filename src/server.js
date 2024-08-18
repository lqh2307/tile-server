"use strict";

import { serve_rendered } from "./serve_rendered.js";
import { serve_template } from "./serve_template.js";
import { serve_common } from "./serve_common.js";
import { serve_sprite } from "./serve_sprite.js";
import { serve_style } from "./serve_style.js";
import { serve_font } from "./serve_font.js";
import { serve_data } from "./serve_data.js";
import { printLog } from "./utils.js";
import chokidar from "chokidar";
import express from "express";
import path from "node:path";
import morgan from "morgan";
import fs from "node:fs";
import cors from "cors";
import os from "os";

function loadConfig() {
  printLog("info", "Loading config file...");

  try {
    /* Read config.json file */
    const configFilePath = path.resolve("data", "config.json");
    const fileData = fs.readFileSync(configFilePath, "utf8");
    const configData = JSON.parse(fileData);

    const config = {
      options: {
        paths: {
          styles: path.resolve("data", "styles"),
          fonts: path.resolve("data", "fonts"),
          sprites: path.resolve("data", "sprites"),
          mbtiles: path.resolve("data", "mbtiles"),
          pmtiles: path.resolve("data", "pmtiles"),
        },
        listenPort: configData.options?.listenPort || 8080,
        watchToKill: configData.options?.watchToKill || 0,
        watchToRestart: configData.options?.watchToRestart || 0,
        killEndpoint: configData.options?.killEndpoint ?? true,
        restartEndpoint: configData.options?.restartEndpoint ?? true,
        frontPage: configData.options?.frontPage ?? true,
        serveWMTS: configData.options?.serveWMTS ?? true,
        serveRendered: configData.options?.serveRendered ?? true,
        serveSwagger: configData.options?.serveSwagger ?? true,
        renderedCompression: configData.options?.renderedCompression || 6,
        loggerFormat:
          configData.options?.loggerFormat ||
          ":date[iso] [INFO] :method :url :status :res[content-length] :response-time :remote-addr :user-agent",
        maxScaleRender: configData.options?.maxScaleRender || 1,
        minPoolSize: configData.options?.minPoolSize || os.cpus().length,
        maxPoolSize: configData.options?.maxPoolSize || os.cpus().length * 2,
      },
      styles: configData.styles || {},
      data: configData.data || {},
      sprites: configData.sprites || {},
      fonts: configData.fonts || {},
      repo: {
        styles: {},
        rendereds: {},
        datas: {},
        fonts: {},
        sprites: {},
      },
      startupComplete: false,
      filePath: configFilePath,
    };

    /* Validate dirs */
    Object.values(config.options.paths).forEach((path) => {
      const stat = fs.statSync(path);

      if (stat.isDirectory() === false) {
        throw new Error(`Directory "${path}" does not exist`);
      }
    });

    return config;
  } catch (error) {
    printLog("error", `Failed to load config file: ${error}. Exited!`);

    process.exit(0);
  }
}

function setupWatchConfigFile(config) {
  if (config.options.watchToKill > 0) {
    printLog(
      "info",
      `Watch config file changes interval ${config.options.watchToKill}ms to kill server`
    );

    chokidar
      .watch(config.filePath, {
        usePolling: true,
        awaitWriteFinish: true,
        interval: config.options.watchToKill,
      })
      .on("change", () => {
        printLog("info", `Config file has changed. Killed server!`);

        process.exit(0);
      });
  } else if (config.options.watchToRestart > 0) {
    printLog(
      "info",
      `Watch config file changes interval ${config.options.watchToRestart}ms to restart server`
    );

    chokidar
      .watch(config.filePath, {
        usePolling: true,
        awaitWriteFinish: true,
        interval: config.options.watchToRestart,
      })
      .on("change", () => {
        printLog("info", `Config file has changed. Restarting server...`);

        process.exit(1);
      });
  }
}

function setupServer(config) {
  printLog("info", "Starting HTTP server...");

  express()
    .disable("x-powered-by")
    .enable("trust proxy")
    .use(cors())
    .use(morgan(config.options.loggerFormat))
    .use("/", serve_common.init(config))
    .use("/", serve_template.init(config))
    .use("/data", serve_data.init(config))
    .use("/fonts", serve_font.init(config))
    .use("/sprites", serve_sprite.init(config))
    .use("/styles", serve_style.init(config))
    .use("/styles", serve_rendered.init(config))
    .listen(config.options.listenPort, () => {
      printLog("info", `Listening on port: ${config.options.listenPort}`);
    });
}

function loadData(config) {
  printLog("info", "Loading data...");

  Promise.all([
    serve_font.add(config),
    serve_sprite.add(config),
    serve_data.add(config),
  ])
    .then(() => serve_style.add(config))
    .then(() => serve_rendered.add(config))
    .then(() => {
      printLog("info", "Completed startup!");

      config.startupComplete = true;
    })
    .catch((error) => {
      printLog("error", `Failed to load data: ${error}. Exited!`);

      process.exit(0);
    });
}

export function startServer() {
  const config = loadConfig();

  setupWatchConfigFile(config);

  setupServer(config);

  loadData(config);
}
