"use strict";

import fs from "node:fs";
import path from "node:path";
import chokidar from "chokidar";
import enableShutdown from "http-shutdown";
import express from "express";
import handlebars from "handlebars";
import SphericalMercator from "@mapbox/sphericalmercator";
import morgan from "morgan";
import chalk from "chalk";
import { serve_data } from "./serve_data.js";
import { serve_style } from "./serve_style.js";
import { serve_font } from "./serve_font.js";
import { serve_rendered } from "./serve_rendered.js";
import { serve_sprite } from "./serve_sprite.js";
import { getTileUrls, printLog } from "./utils.js";

const mercator = new SphericalMercator();

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
    .use(morgan(logFormat))
    .use("/", express.static(path.resolve("public", "resources")));

  let startupComplete = false;

  app.get("/health", async (req, res, next) => {
    res.header("Content-Type", "text/plain");

    if (startupComplete) {
      return res.status(200).send("OK");
    } else {
      return res.status(503).send("Starting");
    }
  });

  const serveTemplate = async (urlPath, template) => {
    let dataGetter = null;

    if (template === "index") {
      if (config.options.frontPage === false) {
        return;
      }

      dataGetter = async (req) => {
        const styles = {};

        await Promise.all(
          Object.keys(repo.rendered).map(async (id) => {
            const style = repo.rendered[id];
            const { center, tiles, format = "", name = "" } = style.tileJSON;
            const tileSize = 256;
            const xyzLink = getTileUrls(
              req,
              tiles,
              `styles/${id}`,
              tileSize,
              format
            )[0];

            let viewer_hash = "";
            let thumbnail = "";
            if (center) {
              viewer_hash = `#${center[2]}/${center[1].toFixed(5)}/${center[0].toFixed(5)}`;

              const centerPx = mercator.px([center[0], center[1]], center[2]);

              // Set thumbnail (default size: 256px x 256px)
              thumbnail = `${center[2]}/${Math.floor(centerPx[0] / tileSize)}/${Math.floor(centerPx[1] / tileSize)}.png`;
            }

            styles[id] = {
              xyz_link: xyzLink,
              viewer_hash,
              thumbnail,
              name,
            };
          })
        );

        const datas = {};

        await Promise.all(
          Object.keys(repo.data).map(async (id) => {
            const data = repo.data[id];
            const {
              center,
              filesize,
              format = "",
              tiles,
              name = "",
            } = data.tileJSON;
            const tileSize = 256;
            const xyzLink = getTileUrls(
              req,
              tiles,
              `data/${id}`,
              undefined,
              format
            )[0];

            let viewer_hash = "";
            let thumbnail = "";
            if (center) {
              viewer_hash = `#${center[2]}/${center[1].toFixed(5)}/${center[0].toFixed(5)}`;

              if (format !== "pbf") {
                const centerPx = mercator.px([center[0], center[1]], center[2]);

                // Set thumbnail (default size: 256px x 256px)
                thumbnail = `${center[2]}/${Math.floor(centerPx[0] / tileSize)}/${Math.floor(centerPx[1] / tileSize)}.${format}`;
              }
            }

            let formatted_filesize = "";
            if (filesize) {
              let suffix = "kB";
              let size = parseInt(filesize, 10) / 1024;

              if (size > 1024) {
                suffix = "MB";
                size /= 1024;
              }

              if (size > 1024) {
                suffix = "GB";
                size /= 1024;
              }

              formatted_filesize = `${size.toFixed(2)} ${suffix}`;
            }

            datas[id] = {
              xyz_link: xyzLink,
              viewer_hash,
              thumbnail,
              source_type: data.sourceType,
              is_vector: format === "pbf",
              formatted_filesize,
              name: name,
            };
          })
        );

        return {
          styles: Object.keys(styles).length ? styles : null,
          data: Object.keys(datas).length ? datas : null,
        };
      };
    } else if (template === "viewer") {
      dataGetter = async (req) => {
        const id = decodeURI(req.params.id);
        const style = repo.rendered[id];
        const { name = "" } = style.tileJSON;

        if (!style) {
          return null;
        }

        return {
          id,
          name,
        };
      };
    } else if (template === "wmts") {
      dataGetter = async (req) => {
        const id = decodeURI(req.params.id);
        const wmts = repo.rendered[id];
        const { name = "" } = wmts.tileJSON;

        if (!wmts) {
          return null;
        }

        return {
          id,
          name,
          base_url: `${req.get("X-Forwarded-Protocol") ? req.get("X-Forwarded-Protocol") : req.protocol}://${req.get("host")}/`,
        };
      };
    } else if (template === "data") {
      dataGetter = async (req) => {
        const id = decodeURI(req.params.id);
        const data = repo.data[id];
        const { name = "", format } = data.tileJSON;

        if (!data) {
          return null;
        }

        return {
          id,
          name,
          is_vector: format === "pbf",
        };
      };
    } else {
      return;
    }

    const templatePath = path.resolve(
      "public",
      "templates",
      `${template}.tmpl`
    );

    const file = fs.readFileSync(templatePath);

    const compiled = handlebars.compile(file.toString());

    app.use(urlPath, async (req, res, next) => {
      let data = {};

      if (dataGetter) {
        data = await dataGetter(req);

        if (!data) {
          res.header("Content-Type", "text/plain");

          return res.status(404).send("Not found");
        }
      }

      data.key_query_part = req.query.key
        ? `key=${encodeURIComponent(req.query.key)}&amp;`
        : "";
      data.key_query = req.query.key
        ? `?key=${encodeURIComponent(req.query.key)}`
        : "";

      if (template === "wmts") {
        res.header("Content-Type", "text/xml");
      }

      return res.status(200).send(compiled(data));
    });
  };

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
    serve_font.add(config, repo),
    serve_sprite.add(config, repo),
    serve_data
      .add(config, repo)
      .then(() =>
        serve_style
          .add(config, repo)
          .then(() => serve_rendered.add(config, repo))
      ),
    serveTemplate("/$", "index"),
    serveTemplate("/styles/:id/$", "viewer"),
    serveTemplate("/styles/:id/wmts.xml", "wmts"),
    serveTemplate("/data/:id/$", "data"),
  ])
    .then(() => {
      printLog("info", "Startup complete!");

      startupComplete = true;

      /* function removeCircularReferences(obj, seen = new Set()) {
      if (typeof obj === "object" && obj !== null) {
        if (seen.has(obj)) {
          return undefined;
        }

        seen.add(obj);

        for (const key in obj) {
          obj[key] = removeCircularReferences(obj[key], seen);
        }
      }

      return obj;
    }

    const cleanedObject = removeCircularReferences(repo);

    const jsonData = JSON.stringify(cleanedObject);

    fs.writeFile("./repo.json", jsonData, "utf8", (err) => {
      if (err) {
        throw err;
      }
    }); */
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

      server.shutdown((err) => {
        newServer(opts);
      });
    });
  }

  app.get("/refresh", async (req, res, next) => {
    printLog("info", "Refreshing server...");

    if (opts.autoRefresh) {
      newChokidar.close();
    }

    server.shutdown((err) => {
      newServer(opts);
    });

    res.header("Content-Type", "text/plain");

    return res.status(200).send("OK");
  });

  app.get("/kill", async (req, res, next) => {
    printLog("info", "Killed server!");

    server.shutdown((err) => {
      process.exit(0);
    });

    res.header("Content-Type", "text/plain");

    return res.status(200).send("OK");
  });
}
