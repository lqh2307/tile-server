"use strict";

import fs from "node:fs";
import path from "node:path";
import chokidar from "chokidar";
import enableShutdown from "http-shutdown";
import express from "express";
import morgan from "morgan";
import { serve_data } from "./serve_data.js";
import { serve_style } from "./serve_style.js";
import { serve_font } from "./serve_font.js";
import { serve_rendered } from "./serve_rendered.js";
import { serve_sprite } from "./serve_sprite.js";
import { serve_template } from "./serve_template.js";
import {
  // createRepoFile,
  printLog,
} from "./utils.js";

function loadConfigFile(dataDir, configFilePath) {
  printLog("info", `Load config file: ${configFilePath}`);

  try {
    /* Read config file */
    const file = fs.readFileSync(configFilePath, "utf8");
    const config = JSON.parse(file);

    /* Add default values */
    config.options = config.options || {};
    config.styles = config.styles || {};
    config.data = config.data || {};
    config.sprites = config.sprites || {};
    config.icons = config.icons || [];

    /* Add paths option */
    config.options.paths = {
      styles: path.join(dataDir, config.options.paths?.styles || ""),
      fonts: path.join(dataDir, config.options.paths?.fonts || ""),
      sprites: path.join(dataDir, config.options.paths?.sprites || ""),
      mbtiles: path.join(dataDir, config.options.paths?.mbtiles || ""),
      pmtiles: path.join(dataDir, config.options.paths?.pmtiles || ""),
      icons: path.join(dataDir, config.options.paths?.icons || ""),
    };

    /* Check paths */
    Object.keys(config.options.paths).forEach((key) => {
      if (fs.statSync(config.options.paths[key]).isDirectory() === false) {
        throw Error(`"${key}" dir does not exist`);
      }
    });

    /* Create repo */
    config.repo = {
      styles: {},
      rendered: {},
      data: {},
      fonts: {},
      sprites: {},
      icons: [],
    };

    return config;
  } catch (error) {
    printLog("error", `Failed to load config file: ${error}`);

    process.exit(1);
  }
}

/**
 *
 * @param opts
 */
export function newServer(opts) {
  printLog("info", "Starting server...");

  let startupComplete = false;
  const configFilePath = path.resolve(opts.dataDir, "config.json");
  const config = loadConfigFile(opts.dataDir, configFilePath);
  const app = express()
    .disable("x-powered-by")
    .enable("trust proxy")
    .use(
      morgan(
        ":date[iso] [INFO] :method :url :status :res[content-length] :response-time :remote-addr :user-agent"
      )
    );

  app.get("/health", async (req, res, next) => {
    res.header("Content-Type", "text/plain");

    if (startupComplete) {
      return res.status(200).send("OK");
    } else {
      return res.status(503).send("Starting");
    }
  });

  /*  */
  Promise.all([
    serve_font.init(config).then((sub) => {
      app.use("/fonts", sub);
    }),
    serve_sprite.init(config).then((sub) => {
      app.use("/sprites", sub);
    }),
    serve_data.init(config).then((sub) => {
      app.use("/data", sub);
    }),
    serve_style.init(config).then((sub) => {
      app.use("/styles", sub);
    }),
    serve_rendered.init(config).then((sub) => {
      app.use("/styles", sub);
    }),
    serve_template.init(config).then((sub) => {
      app.use("/", sub);
    }),
    serve_font.add(config),
    serve_sprite.add(config),
    serve_data
      .add(config)
      .then(() =>
        serve_style.add(config).then(() => serve_rendered.add(config))
      ),
  ])
    .then(() => {
      printLog("info", "Startup complete!");

      // createRepoFile(config, "./repo.json");

      startupComplete = true;
    })
    .catch((error) => {
      printLog("error", `Failed to starting server: ${error}`);

      process.exit(1);
    });

  const server = app.listen(opts.port, function () {
    printLog("info", `Listening in port: ${this.address().port}`);
  });

  // To gracefully stop serving
  enableShutdown(server);

  let newChokidar;
  if (opts.kill > 0) {
    printLog(
      "info",
      `Monitor config file changes each ${opts.kill}ms to killing server`
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
  } else if (opts.refresh > 0) {
    printLog(
      "info",
      `Monitor config file changes each ${opts.refresh}ms to refreshing server`
    );

    newChokidar = chokidar.watch(configFilePath, {
      persistent: true,
      usePolling: true,
      awaitWriteFinish: true,
      interval: opts.refresh,
      binaryInterval: opts.refresh,
    });
    newChokidar.on("change", () => {
      printLog("info", `Config file has changed. Refreshing server...`);

      newChokidar.close();

      server.shutdown((error) => {
        if (error) {
          printLog("error", error);
        }

        newServer(opts);
      });
    });
  }

  app.get("/refresh", async (req, res, next) => {
    printLog("info", "Refreshing server...");

    if (opts.refresh > 0 && !(opts.kill > 0)) {
      newChokidar.close();
    }

    server.shutdown((error) => {
      if (error) {
        printLog("error", error);
      }

      newServer(opts);
    });

    res.header("Content-Type", "text/plain");

    return res.status(200).send("OK");
  });

  app.get("/kill", async (req, res, next) => {
    printLog("info", "Killed server!");

    if (opts.kill > 0) {
      newChokidar.close();
    }

    server.shutdown((error) => {
      if (error) {
        printLog("error", error);
      }

      process.exit(0);
    });

    res.header("Content-Type", "text/plain");

    return res.status(200).send("OK");
  });
}
