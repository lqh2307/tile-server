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
import { Mutex } from "async-mutex";

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

    paths = {
      styles: path.join(dataDir, paths?.styles || ""),
      fonts: path.join(dataDir, paths?.fonts || ""),
      sprites: path.join(dataDir, paths?.sprites || ""),
      mbtiles: path.join(dataDir, paths?.mbtiles || ""),
      pmtiles: path.join(dataDir, paths?.pmtiles || ""),
    };

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

    process.exit(1);
  }
}

export function startServer(opts) {
  let config = loadConfigFile(opts);
  let startupComplete = false;
  let start = true;

  const mutex = new Mutex();

  const getConfig = () => config;

  const loadData = async () => {
    const release = await mutex.acquire();

    startupComplete = false;

    try {
      if (start === true) {
        start = false;

        printLog("info", "Loading data...");
      } else {
        printLog("info", "Reloading data...");

        const rendereds = config.repo.rendered;

        await Promise.all(
          Object.keys(rendereds).map(async (rendered) => {
            const renderer = rendereds[rendered].renderers;
            if (renderer) {
              await renderer.drain();
              await renderer.clear();
            }
          })
        );

        config = loadConfigFile(opts);
      }

      await Promise.all([
        serve_font.add(config),
        serve_sprite.add(config),
        serve_data
          .add(config)
          .then(() =>
            serve_style.add(config).then(() => serve_rendered.add(config))
          ),
      ]);

      printLog("info", "Load data complete!");

      startupComplete = true;
    } catch (error) {
      printLog("error", `Failed to load data: ${error}`);

      process.exit(1);
    } finally {
      release();
    }
  };

  loadData();

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
  } else if (opts.reload > 0) {
    printLog(
      "info",
      `Monitor config file changes each ${opts.reload}ms to reload data`
    );

    const newChokidar = chokidar.watch(
      path.resolve(opts.dataDir, "config.json"),
      {
        persistent: true,
        usePolling: true,
        awaitWriteFinish: true,
        interval: opts.reload,
        binaryInterval: opts.reload,
      }
    );

    newChokidar.on("change", () => {
      printLog("info", `Config file has changed. Reloading data...`);

      loadData();
    });
  }

  express()
    .disable("x-powered-by")
    .enable("trust proxy")
    .use(
      morgan(
        ":date[iso] [INFO] :method :url :status :res[content-length] :response-time :remote-addr :user-agent"
      )
    )
    .use(async (req, res, next) => {
      if (startupComplete === true) {
        return next();
      } else {
        return res.status(503).send("Starting");
      }
    })
    .get("/health", async (req, res, next) => {
      if (startupComplete === true) {
        return res.status(200).send("OK");
      } else {
        return res.status(503).send("Starting");
      }
    })
    .get("/reload", async (req, res, next) => {
      printLog("info", "Received reload request. Reloading data...");

      loadData();

      return res.status(200).send("OK");
    })
    .get("/kill", async (req, res, next) => {
      setTimeout(() => {
        printLog("info", "Received kill request. Killed server!");

        process.exit(0);
      }, 0);

      return res.status(200).send("OK");
    })
    .use("/fonts", serve_font.init(getConfig))
    .use("/sprites", serve_sprite.init(getConfig))
    .use("/data", serve_data.init(getConfig))
    .use("/styles", serve_style.init(getConfig))
    .use("/styles", serve_rendered.init(getConfig))
    .use("/", serve_template.init(getConfig))
    .listen(opts.port, () => {
      printLog("info", `Listening on port: ${opts.port}`);
    });
}
