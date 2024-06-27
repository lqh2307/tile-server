import fs from "node:fs";
import path from "node:path";
import chokidar from "chokidar";
import express from "express";
import morgan from "morgan";
import cors from "cors";
import { serve_data } from "./serve_data.js";
import { serve_style } from "./serve_style.js";
import { serve_font } from "./serve_font.js";
import { serve_rendered } from "./serve_rendered.js";
import { serve_sprite } from "./serve_sprite.js";
import { serve_template } from "./serve_template.js";
import { printLog } from "./utils.js";

function loadConfigFile(opts) {
  const dataDir = opts.dataDir;

  const configFilePath = path.resolve(dataDir, "config.json");

  printLog("info", `Load config file: ${configFilePath}`);

  try {
    const config = JSON.parse(fs.readFileSync(configFilePath, "utf8"));

    config.options = config.options || {};
    config.styles = config.styles || {};
    config.data = config.data || {};
    config.sprites = config.sprites || {};

    const paths = config.options.paths;

    paths.styles = path.join(dataDir, paths?.styles || "");
    paths.fonts = path.join(dataDir, paths?.fonts || "");
    paths.sprites = path.join(dataDir, paths?.sprites || "");
    paths.mbtiles = path.join(dataDir, paths?.mbtiles || "");
    paths.pmtiles = path.join(dataDir, paths?.pmtiles || "");

    Object.keys(paths).forEach((key) => {
      if (fs.statSync(paths[key]).isDirectory() === false) {
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

    process.exit(0);
  }
}

export function startServer(opts) {
  const config = loadConfigFile(opts);
  let startupComplete = false;

  if (opts.kill > 0) {
    printLog(
      "info",
      `Monitor config file changes each ${opts.kill}ms to kill server`
    );

    const newChokidar = chokidar.watch(
      path.resolve(opts.dataDir, "config.json"),
      {
        persistent: true,
        usePolling: true,
        awaitWriteFinish: true,
        interval: opts.kill,
        binaryInterval: opts.kill,
      }
    );

    newChokidar.on("change", () => {
      printLog("info", `Config file has changed. Killed server!`);

      process.exit(0);
    });
  } else if (opts.restart > 0) {
    printLog(
      "info",
      `Monitor config file changes each ${opts.restart}ms to restart server`
    );

    const newChokidar = chokidar.watch(
      path.resolve(opts.dataDir, "config.json"),
      {
        persistent: true,
        usePolling: true,
        awaitWriteFinish: true,
        interval: opts.restart,
        binaryInterval: opts.restart,
      }
    );

    newChokidar.on("change", () => {
      printLog("info", `Config file has changed. Restarting server...`);

      process.exit(1);
    });
  }

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
    .get("/health", async (req, res, next) => {
      if (startupComplete === true) {
        return res.status(200).send("OK");
      } else {
        return res.status(503).send("Starting");
      }
    })
    .get("/restart", async (req, res, next) => {
      printLog("info", "Received restart request. Restarting server...");

      setTimeout(() => {
        process.exit(1);
      }, 0);

      return res.status(200).send("OK");
    })
    .get("/kill", async (req, res, next) => {
      printLog("info", "Received kill request. Killed server!");

      setTimeout(() => {
        process.exit(0);
      }, 0);

      return res.status(200).send("OK");
    })
    .use("/fonts", serve_font.init(config))
    .use("/sprites", serve_sprite.init(config))
    .use("/data", serve_data.init(config))
    .use("/styles", serve_style.init(config))
    .use("/styles", serve_rendered.init(config))
    .use("/", serve_template.init(config))
    .listen(opts.port, () => {
      printLog("info", `Listening on port: ${opts.port}`);
    });
}
