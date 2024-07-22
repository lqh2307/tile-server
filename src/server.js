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

/**
 * Load config file and assign default
 * @returns {object}
 */
function loadConfigFile() {
  printLog("info", "Load config file...");

  try {
    /* Read config file */
    const file = fs.readFileSync(CONFIG_FILE_PATH, "utf8");

    const config = JSON.parse(file);

    /* Asign options */
    const configObj = {
      options: {
        paths: {
          styles: path.join(DATA_DIR_PATH, config.options?.paths?.styles || ""),
          fonts: path.join(DATA_DIR_PATH, config.options?.paths?.fonts || ""),
          sprites: path.join(
            DATA_DIR_PATH,
            config.options?.paths?.sprites || ""
          ),
          mbtiles: path.join(
            DATA_DIR_PATH,
            config.options?.paths?.mbtiles || ""
          ),
          pmtiles: path.join(
            DATA_DIR_PATH,
            config.options?.paths?.pmtiles || ""
          ),
        },
        listenPort: config.options?.listenPort || 8080,
        watchToKill: config.options?.watchToKill || 0,
        watchToRestart: config.options?.watchToRestart || 1000,
        killEndpoint: config.options?.killEndpoint ?? true,
        restartEndpoint: config.options?.restartEndpoint ?? true,
        frontPage: config.options?.frontPage ?? true,
        serveWMTS: config.options?.serveWMTS ?? true,
        serveRendered: config.options?.serveRendered ?? true,
        maxScaleRender: config.options?.maxScaleRender || 1,
        minPoolSize: config.options?.minPoolSize || 8,
        maxPoolSize: config.options?.maxPoolSize || 16,
      },
      styles: config.styles || {},
      data: config.data || {},
      sprites: config.sprites || {},
      fonts: config.fonts || {},
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
    Object.values(configObj.options.paths).forEach((path) => {
      const stat = fs.statSync(path);

      if (stat.isDirectory() === false) {
        throw Error(`Directory "${path}" does not exist`);
      }
    });

    return configObj;
  } catch (error) {
    printLog("error", `Failed to load config file: ${error}. Exited!`);

    process.exit(0);
  }
}

/**
 * Start server
 * @returns {void}
 */
export function startServer() {
  /* Load config file */
  const config = loadConfigFile();

  /* Start http server */
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

  /* Setup watch config file */
  if (config.options.watchToKill > 0) {
    printLog(
      "info",
      `Watch config file changes interval ${config.options.watchToKill}ms to kill server`
    );

    const newChokidar = chokidar.watch(CONFIG_FILE_PATH, {
      usePolling: true,
      awaitWriteFinish: true,
      interval: config.options.watchToKill,
    });

    newChokidar.on("change", () => {
      printLog("info", `Config file has changed. Killed server!`);

      process.exit(0);
    });
  } else if (config.options.watchToRestart > 0) {
    printLog(
      "info",
      `Watch config file changes interval ${config.options.watchToRestart}ms to restart server`
    );

    const newChokidar = chokidar.watch(CONFIG_FILE_PATH, {
      usePolling: true,
      awaitWriteFinish: true,
      interval: config.options.watchToRestart,
    });

    newChokidar.on("change", () => {
      printLog("info", `Config file has changed. Restarting server...`);

      process.exit(1);
    });
  }

  /* Load data */
  Promise.all([
    serve_font.add(config),
    serve_sprite.add(config),
    serve_data.add(config),
  ])
    .then(() => serve_style.add(config))
    .then(() => serve_rendered.add(config))
    .then(() => {
      printLog("info", "Load data complete!");

      config.startupComplete = true;
    })
    .catch((error) => {
      printLog("error", `Failed to load data: ${error}`);

      process.exit(0);
    });
}
