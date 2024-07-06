import fs from "node:fs";
import cors from "cors";
import path from "node:path";
import morgan from "morgan";
import express from "express";
import chokidar from "chokidar";
import { serve_rendered } from "./serve_rendered.js";
import { serve_template } from "./serve_template.js";
import { serve_sprite } from "./serve_sprite.js";
import { serve_style } from "./serve_style.js";
import { serve_font } from "./serve_font.js";
import { serve_data } from "./serve_data.js";
import { printLog } from "./utils.js";

/**
 * Load config file and assign default
 * @param {string} dataDir
 * @returns {object}
 */
function loadConfigFile(dataDir) {
  const configFilePath = path.join(dataDir, "config.json");

  printLog("info", `Load config file: ${configFilePath}`);

  try {
    /* Read config.json file */
    const file = fs.readFileSync(configFilePath, "utf8");

    const config = JSON.parse(file);

    /* Asign options */
    const configObj = {
      options: {
        paths: {
          styles: path.join(dataDir, config.options?.paths?.styles || ""),
          fonts: path.join(dataDir, config.options?.paths?.fonts || ""),
          sprites: path.join(dataDir, config.options?.paths?.sprites || ""),
          mbtiles: path.join(dataDir, config.options?.paths?.mbtiles || ""),
          pmtiles: path.join(dataDir, config.options?.paths?.pmtiles || ""),
        },
        formatQuality: {
          jpeg: config.options?.formatQuality?.jpeg || 100,
          webp: config.options?.formatQuality?.webp || 100,
          avif: config.options?.formatQuality?.avif || 100,
        },
        listenPort: config.options?.listenPort || 8080,
        watchToKill: config.options?.watchToKill || 0,
        watchToRestart: config.options?.watchToRestart || 1000,
        killEndpoint: config.options?.killEndpoint ?? true,
        restartEndpoint: config.options?.restartEndpoint ?? true,
        frontPage: config.options?.frontPage ?? true,
        serveWMTS: config.options?.serveWMTS ?? true,
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
 * @param {string} dataDir
 * @returns {void}
 */
export function startServer(dataDir) {
  /* Load config file */
  const config = loadConfigFile(dataDir);

  /* Read params */
  const {
    watchToKill,
    watchToRestart,
    restartEndpoint,
    killEndpoint,
    listenPort,
  } = config.options;

  /* Setup watch config file */
  if (watchToKill > 0) {
    printLog(
      "info",
      `Watch config file changes interval ${watchToKill}ms to kill server`
    );

    const configFilePath = path.join(dataDir, "config.json");

    const newChokidar = chokidar.watch(configFilePath, {
      usePolling: true,
      awaitWriteFinish: true,
      interval: watchToKill,
    });

    newChokidar.on("change", () => {
      printLog("info", `Config file has changed. Killed server!`);

      process.exit(0);
    });
  } else if (watchToRestart > 0) {
    printLog(
      "info",
      `Watch config file changes interval ${watchToRestart}ms to restart server`
    );

    const configFilePath = path.join(dataDir, "config.json");

    const newChokidar = chokidar.watch(configFilePath, {
      usePolling: true,
      awaitWriteFinish: true,
      interval: watchToRestart,
    });

    newChokidar.on("change", () => {
      printLog("info", `Config file has changed. Restarting server...`);

      process.exit(1);
    });
  }

  let startupComplete = false;

  /* Load data */
  Promise.all([
    serve_font.add(config),
    serve_sprite.add(config),
    serve_data
      .add(config)
      .then(() =>
        serve_style.add(config).then(() => serve_rendered.add(config))
      ),
  ])
    .then(() => {
      printLog("info", "Load data complete!");

      startupComplete = true;
    })
    .catch((error) => {
      printLog("error", `Failed to load data: ${error}`);

      process.exit(0);
    });

  /* Init server */
  const logFormat =
    ":date[iso] [INFO] :method :url :status :res[content-length] :response-time :remote-addr :user-agent";

  const app = express()
    .disable("x-powered-by")
    .enable("trust proxy")
    .use(morgan(logFormat))
    .use(
      cors({
        origin: "*",
        methods: "GET",
      })
    );

  /* Asign endpoint */
  app.get("/health", async (req, res, next) => {
    if (startupComplete === true) {
      return res.status(200).send("OK");
    } else {
      return res.status(503).send("Starting");
    }
  });

  if (restartEndpoint === true) {
    app.get("/restart", async (req, res, next) => {
      printLog("info", "Received restart request. Restarting server...");

      setTimeout(() => {
        process.exit(1);
      }, 0);

      return res.status(200).send("OK");
    });
  }

  if (killEndpoint === true) {
    app.get("/kill", async (req, res, next) => {
      printLog("info", "Received kill request. Killed server!");

      setTimeout(() => {
        process.exit(0);
      }, 0);

      return res.status(200).send("OK");
    });
  }

  app.use("/fonts", serve_font.init(config));
  app.use("/sprites", serve_sprite.init(config));
  app.use("/data", serve_data.init(config));
  app.use("/styles", serve_style.init(config));
  app.use("/styles", serve_rendered.init(config));
  app.use("/", serve_template.init(config));

  /* Start listen */
  app.listen(listenPort, () => {
    printLog("info", `Listening on port: ${listenPort}`);
  });
}
