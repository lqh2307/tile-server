"use strict";

import fs from "node:fs";
import path from "node:path";
import chokidar from "chokidar";
import enableShutdown from "http-shutdown";
import express from "express";
import morgan from "morgan";
import chalk from "chalk";
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

const logFormat = `${chalk.gray(":date[iso]")} ${chalk.green("[INFO]")} :method :url :status :res[content-length] :response-time :remote-addr :user-agent`;

function loadConfigFile(configFilePath) {
  printLog("info", `Load config file: ${configFilePath}`);

  try {
    /* Read config file */
    const config = JSON.parse(fs.readFileSync(configFilePath, "utf8"));

    /* Add default values */
    config.options = config.options || {};
    config.styles = config.styles || {};
    config.data = config.data || {};
    config.sprites = config.sprites || {};
    config.icons = config.icons || [];

    const rootPath = config.options.paths?.root || "";

    /* Add paths option */
    config.options.paths = {
      root: path.resolve(rootPath),
      styles: path.resolve(rootPath, config.options.paths?.styles || ""),
      fonts: path.resolve(rootPath, config.options.paths?.fonts || ""),
      sprites: path.resolve(rootPath, config.options.paths?.sprites || ""),
      mbtiles: path.resolve(rootPath, config.options.paths?.mbtiles || ""),
      pmtiles: path.resolve(rootPath, config.options.paths?.pmtiles || ""),
      icons: path.resolve(rootPath, config.options.paths?.icons || ""),
    };

    /* Check paths */
    Object.keys(config.options.paths).forEach((key) => {
      if (fs.statSync(config.options.paths[key]).isDirectory() === false) {
        throw Error(`"${key}" dir does not exist`);
      }
    });

    return config;
  } catch (error) {
    printLog("error", `Failed to load config file: ${error}`);

    process.exit(1);
  }
}

function createRepo() {
  return {
    styles: {},
    rendered: {},
    data: {},
    fonts: {},
    sprites: {},
    icons: [],
  };
}

/**
 *
 * @param opts
 */
export function newServer(opts) {
  printLog("info", "Starting server...");

  const config = loadConfigFile(opts.config);
  const repo = createRepo();
  const app = express()
    .disable("x-powered-by")
    .enable("trust proxy")
    .use(morgan(logFormat));

  let startupComplete = false;

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
    serve_font.init(config, repo).then((sub) => {
      app.use("/fonts", sub);
    }),
    serve_sprite.init(config, repo).then((sub) => {
      app.use("/sprites", sub);
    }),
    serve_data.init(config, repo).then((sub) => {
      app.use("/data", sub);
    }),
    serve_style.init(config, repo).then((sub) => {
      app.use("/styles", sub);
    }),
    serve_rendered.init(config, repo).then((sub) => {
      app.use("/styles", sub);
    }),
    serve_template.init(config, repo).then((sub) => {
      app.use("/", sub);
    }),
    serve_font.add(config, repo),
    serve_sprite.add(config, repo),
    serve_data
      .add(config, repo)
      .then(() =>
        serve_style
          .add(config, repo)
          .then(() => serve_rendered.add(config, repo))
      ),
  ])
    .then(() => {
      printLog("info", "Startup complete!");

      // createRepoFile(repo, "./repo.json");

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

  const newChokidar = chokidar.watch(opts.config, {
    persistent: false,
    usePolling: true,
    awaitWriteFinish: true,
    interval: 1000,
    binaryInterval: 1000,
  });
  if (opts.kill) {
    printLog("info", "Enable killing server after changing config file");

    newChokidar.on("change", () => {
      printLog("info", `Config file has changed. Killed server!`);

      process.exit(0);
    });
  } else if (opts.refresh) {
    printLog("info", "Enable refreshing server after changing config file");

    newChokidar.on("change", () => {
      printLog("info", `Config file has changed. Refreshing server...`);

      newChokidar.close();

      server.shutdown((error) => {
        printLog("error", error);

        newServer(opts);
      });
    });
  }

  app.get("/refresh", async (req, res, next) => {
    printLog("info", "Refreshing server...");

    if (opts.autoRefresh) {
      newChokidar.close();
    }

    server.shutdown((error) => {
      printLog("error", error);

      newServer(opts);
    });

    res.header("Content-Type", "text/plain");

    return res.status(200).send("OK");
  });

  app.get("/kill", async (req, res, next) => {
    printLog("info", "Killed server!");

    server.shutdown((error) => {
      printLog("error", error);

      process.exit(0);
    });

    res.header("Content-Type", "text/plain");

    return res.status(200).send("OK");
  });
}
