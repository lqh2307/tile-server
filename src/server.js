import fs from "node:fs";
import cors from "cors";
import path from "node:path";
import morgan from "morgan";
import express from "express";
import chokidar from "chokidar";
import { serve_rendered } from "./serve_rendered.js";
import { serve_template } from "./serve_template.js";
import { serve_common } from "./serve_common.js";
import { serve_sprite } from "./serve_sprite.js";
import { serve_style } from "./serve_style.js";
import { serve_font } from "./serve_font.js";
import { serve_data } from "./serve_data.js";
import { printLog } from "./utils.js";

const DATA_DIR_PATH = path.resolve("data");
const CONFIG_FILE_PATH = path.join(DATA_DIR_PATH, "config.json");
const MBTILES_DIR_PATH = path.join(DATA_DIR_PATH, "mbtiles");
const PMTILES_DIR_PATH = path.join(DATA_DIR_PATH, "pmtiles");
const FONTS_DIR_PATH = path.join(DATA_DIR_PATH, "fonts");
const SPRITES_DIR_PATH = path.join(DATA_DIR_PATH, "sprites");
const STYLES_DIR_PATH = path.join(DATA_DIR_PATH, "styles");

/**
 * Start server
 * @returns {void}
 */
export function startServer() {
  /* Load config file */
  printLog("info", "Loading config file...");

  let config;

  try {
    /* Read config file */
    const fileData = fs.readFileSync(CONFIG_FILE_PATH, "utf8");
    const configData = JSON.parse(fileData);

    /* Asign options */
    config = {
      options: {
        paths: {
          styles: STYLES_DIR_PATH,
          fonts: FONTS_DIR_PATH,
          sprites: SPRITES_DIR_PATH,
          mbtiles: MBTILES_DIR_PATH,
          pmtiles: PMTILES_DIR_PATH,
        },
        listenPort: configData.options?.listenPort || 8080,
        watchToKill: configData.options?.watchToKill || 0,
        watchToRestart: configData.options?.watchToRestart || 0,
        killEndpoint: configData.options?.killEndpoint ?? true,
        restartEndpoint: configData.options?.restartEndpoint ?? true,
        frontPage: configData.options?.frontPage ?? true,
        serveWMTS: configData.options?.serveWMTS ?? true,
        serveRendered: configData.options?.serveRendered ?? true,
        renderedCompression: configData.options?.renderedCompression || 6,
        maxScaleRender: configData.options?.maxScaleRender || 1,
        minPoolSize: configData.options?.minPoolSize || 8,
        maxPoolSize: configData.options?.maxPoolSize || 16,
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
    };

    /* Check directory paths */
    Object.values(config.options.paths).forEach((path) => {
      const stat = fs.statSync(path);

      if (stat.isDirectory() === false) {
        throw new Error(`Directory "${path}" does not exist`);
      }
    });

    /* Setup watch config file */
    if (config.options.watchToKill > 0) {
      printLog(
        "info",
        `Watch config file changes interval ${config.options.watchToKill}ms to kill server`
      );

      chokidar
        .watch(CONFIG_FILE_PATH, {
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
        .watch(CONFIG_FILE_PATH, {
          usePolling: true,
          awaitWriteFinish: true,
          interval: config.options.watchToRestart,
        })
        .on("change", () => {
          printLog("info", `Config file has changed. Restarting server...`);

          process.exit(1);
        });
    }
  } catch (error) {
    printLog("error", `Failed to load config file: ${error}. Exited!`);

    process.exit(0);
  }

  /* Start http server */
  printLog("info", "Starting HTTP server...");

  express()
    .disable("x-powered-by")
    .enable("trust proxy")
    .use(
      morgan(
        ":date[iso] [INFO] :method :url :status :res[content-length] :response-time :remote-addr :user-agent"
      )
    )
    .use(
      cors({
        origin: "*",
        methods: "GET",
      })
    )
    .use("/", serve_common.init(config))
    .use("/", serve_template.init(config))
    .use("/fonts", serve_font.init(config))
    .use("/sprites", serve_sprite.init(config))
    .use("/data", serve_data.init(config))
    .use("/styles", serve_style.init(config))
    .use("/styles", serve_rendered.init(config))
    .listen(config.options.listenPort, () => {
      printLog("info", `Listening on port: ${config.options.listenPort}`);
    });

  /* Load data */
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
