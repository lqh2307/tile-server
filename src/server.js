import fs from "node:fs";
import path from "node:path";
import chokidar from "chokidar";
import express from "express";
import morgan from "morgan";
import { serve_data } from "./serve_data.js";
import { serve_style } from "./serve_style.js";
import { serve_font } from "./serve_font.js";
import { serve_rendered } from "./serve_rendered.js";
import { serve_sprite } from "./serve_sprite.js";
import { serve_template } from "./serve_template.js";
import { printLog } from "./utils.js";

function loadConfigFile(opts) {
  const configFilePath = path.resolve(opts.dataDir, "config.json");

  printLog("info", `Load config file: ${configFilePath}`);

  try {
    const file = fs.readFileSync(configFilePath, "utf8");
    const config = JSON.parse(file);

    config.options = config.options || {};
    config.styles = config.styles || {};
    config.data = config.data || {};
    config.sprites = config.sprites || {};

    config.options.paths = {
      styles: path.join(opts.dataDir, config.options.paths?.styles || ""),
      fonts: path.join(opts.dataDir, config.options.paths?.fonts || ""),
      sprites: path.join(opts.dataDir, config.options.paths?.sprites || ""),
      mbtiles: path.join(opts.dataDir, config.options.paths?.mbtiles || ""),
      pmtiles: path.join(opts.dataDir, config.options.paths?.pmtiles || ""),
    };

    Object.keys(config.options.paths).forEach((key) => {
      if (fs.statSync(config.options.paths[key]).isDirectory() === false) {
        throw Error(`"${key}" dir does not exist`);
      }
    });

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

    process.exit(1);
  }
}

export function newServer(opts) {
  printLog("info", "Starting server...");

  const app = express()
    .disable("x-powered-by")
    .enable("trust proxy")
    .use(
      morgan(
        ":date[iso] [INFO] :method :url :status :res[content-length] :response-time :remote-addr :user-agent"
      )
    );

  let startupComplete = false;
  let config = loadConfigFile(opts);

  const getConfig = () => config;

  const initService = async () => {
    await Promise.all([
      serve_font.add(config),
      serve_sprite.add(config),
      serve_data
        .add(config)
        .then(() =>
          serve_style.add(config).then(() => serve_rendered.add(config))
        ),
    ])
      .then(() => {
        printLog("info", "Start service complete!");

        startupComplete = true;
      })
      .catch((error) => {
        printLog("error", `Failed to start service: ${error}`);

        process.exit(1);
      });
  };

  app.get("/health", async (req, res, next) => {
    res.header("Content-Type", "text/plain");

    if (startupComplete === true) {
      return res.status(200).send("OK");
    } else {
      return res.status(503).send("Starting");
    }
  });

  app.get("/reload", async (req, res, next) => {
    printLog("info", "Reloading server...");

    config = loadConfigFile(opts);
    initService();

    res.header("Content-Type", "text/plain");

    return res.status(200).send("OK");
  });

  app.get("/kill", async (req, res, next) => {
    setTimeout(() => {
      printLog("info", "Killed server!");

      process.exit(0);
    }, 0);

    res.header("Content-Type", "text/plain");

    return res.status(200).send("OK");
  });

  app.use("/fonts", serve_font.init(getConfig));
  app.use("/sprites", serve_sprite.init(getConfig));
  app.use("/data", serve_data.init(getConfig));
  app.use("/styles", serve_style.init(getConfig));
  app.use("/styles", serve_rendered.init(getConfig));
  app.use("/", serve_template.init(getConfig));

  initService();

  app.listen(opts.port, () => {
    printLog("info", `Listening on port: ${opts.port}`);
  });

  const configFilePath = path.resolve(opts.dataDir, "config.json");
  let newChokidar;

  if (opts.kill > 0) {
    printLog(
      "info",
      `Monitor config file changes each ${opts.kill}ms to kill server`
    );

    newChokidar = chokidar.watch(configFilePath, {
      persistent: true,
      usePolling: true,
      awaitWriteFinish: true,
      interval: opts.kill,
      binaryInterval: opts.kill,
    });

    newChokidar.on("change", () => {
      printLog("info", `Config file has changed. Killed server!`);

      process.exit(0);
    });
  } else if (opts.reload > 0) {
    printLog(
      "info",
      `Monitor config file changes each ${opts.reload}ms to reload server`
    );

    newChokidar = chokidar.watch(configFilePath, {
      persistent: true,
      usePolling: true,
      awaitWriteFinish: true,
      interval: opts.reload,
      binaryInterval: opts.reload,
    });

    newChokidar.on("change", () => {
      printLog("info", `Config file has changed. Reloading server...`);

      startupComplete = false;

      config = loadConfigFile(opts);
      initService();
    });
  }
}
