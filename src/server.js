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

function loadConfigFile(opts) {
  const configFilePath = path.resolve(opts.dataDir, "config.json");

  printLog("info", `Load config file: ${configFilePath}`);

  try {
    /* Read config.json file */
    const config = JSON.parse(fs.readFileSync(configFilePath, "utf8"));

    config.options = config.options || {};

    /* Asign resource path */
    config.options.paths = config.options.paths || {};
    config.options.paths.styles = path.join(
      opts.dataDir,
      config.options.paths.styles || ""
    );
    config.options.paths.fonts = path.join(
      opts.dataDir,
      config.options.paths.fonts || ""
    );
    config.options.paths.sprites = path.join(
      opts.dataDir,
      config.options.paths.sprites || ""
    );
    config.options.paths.mbtiles = path.join(
      opts.dataDir,
      config.options.paths.mbtiles || ""
    );
    config.options.paths.pmtiles = path.join(
      opts.dataDir,
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
      rendered: {},
      data: {},
      fonts: {},
      sprites: {},
    };

    return config;
  } catch (error) {
    printLog("error", `Failed to load config file: ${error}`);

    process.exit(0);
  }
}

export function startServer(opts) {
  /* Load config file */
  const config = loadConfigFile(opts);

  if (config.options.watchToKill > 0) {
    printLog(
      "info",
      `Watch config file changes interval ${config.options.watchToKill}ms to kill server`
    );

    const newChokidar = chokidar.watch(
      path.resolve(opts.dataDir, "config.json"),
      {
        usePolling: true,
        awaitWriteFinish: true,
        interval: config.options.watchToKill,
      }
    );

    newChokidar.on("change", () => {
      printLog("info", `Config file has changed. Killed server!`);

      process.exit(0);
    });
  } else if (config.options.watchToRestart > 0) {
    printLog(
      "info",
      `Watch config file changes interval ${config.options.watchToRestart}ms to restart server`
    );

    const newChokidar = chokidar.watch(
      path.resolve(opts.dataDir, "config.json"),
      {
        usePolling: true,
        awaitWriteFinish: true,
        interval: config.options.watchToRestart,
      }
    );

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

  if (config.options.restartEndpoint === true) {
    app.get("/restart", async (req, res, next) => {
      printLog("info", "Received restart request. Restarting server...");

      setTimeout(() => {
        process.exit(1);
      }, 0);

      return res.status(200).send("OK");
    });
  }

  if (config.options.killEndpoint === true) {
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
  app.listen(config.options.listenPort, () => {
    printLog("info", `Listening on port: ${config.options.listenPort}`);
  });
}
