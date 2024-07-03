import chokidar from "chokidar";
import express from "express";
import morgan from "morgan";
import path from "node:path";
import cors from "cors";
import fs from "node:fs";
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
  const configFilePath = path.resolve(dataDir, "config.json");

  printLog("info", `Load config file: ${configFilePath}`);

  try {
    /* Read config.json file */
    const config = JSON.parse(fs.readFileSync(configFilePath, "utf8"));

    config.options = config.options || {};

    /* Asign resource path */
    config.options.paths = config.options.paths || {};
    config.options.paths.styles = path.join(
      dataDir,
      config.options.paths.styles || ""
    );
    config.options.paths.fonts = path.join(
      dataDir,
      config.options.paths.fonts || ""
    );
    config.options.paths.sprites = path.join(
      dataDir,
      config.options.paths.sprites || ""
    );
    config.options.paths.mbtiles = path.join(
      dataDir,
      config.options.paths.mbtiles || ""
    );
    config.options.paths.pmtiles = path.join(
      dataDir,
      config.options.paths.pmtiles || ""
    );

    Object.keys(config.options.paths).forEach((key) => {
      if (fs.statSync(config.options.paths[key]).isDirectory() === false) {
        throw Error(`"${key}" dir does not exist`);
      }
    });

    /* Asign format quality */
    config.options.formatQuality = config.options.formatQuality || {};
    config.options.formatQuality.jpeg =
      config.options.formatQuality.jpeg || 100;
    config.options.formatQuality.webp =
      config.options.formatQuality.webp || 100;

    /* Asign listen port */
    config.options.listenPort = config.options.listenPort || 8080;

    /* Asign action with server */
    config.options.watchToKill = config.options.watchToKill || 0;
    config.options.watchToRestart = config.options.watchToRestart || 1000;

    /* Asign enable endpoint */
    config.options.killEndpoint = config.options.killEndpoint || true;
    config.options.restartEndpoint = config.options.restartEndpoint || true;
    config.options.frontPage = config.options.frontPage || true;
    config.options.serveWMTS = config.options.serveWMTS || true;

    /* Asign scale render */
    config.options.maxScaleRender = config.options.maxScaleRender || 1;

    /* Asign pool size */
    config.options.minPoolSize = config.options.minPoolSize || 8;
    config.options.maxPoolSize = config.options.maxPoolSize || 16;

    /* Asign resource */
    config.styles = config.styles || {};
    config.data = config.data || {};
    config.sprites = config.sprites || {};
    config.fonts = config.fonts || {};

    /* Asign repo */
    config.repo = {
      styles: {},
      rendereds: {},
      datas: {},
      fonts: {},
      sprites: {},
    };

    return config;
  } catch (error) {
    printLog("error", `Failed to load config file: ${error}`);

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

    const newChokidar = chokidar.watch(path.resolve(dataDir, "config.json"), {
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

    const newChokidar = chokidar.watch(path.resolve(dataDir, "config.json"), {
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
    .catch(() => {
      printLog("error", `Failed to load data: ${error}`);

      process.exit(0);
    });

  /* Init server */
  const app = express()
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
