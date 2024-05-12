"use strict";

import fs from "node:fs";
import path from "node:path";
import chokidar from "chokidar";
import enableShutdown from "http-shutdown";
import express from "express";
import handlebars from "handlebars";
import SphericalMercator from "@mapbox/sphericalmercator";
import morgan from "morgan";
import clone from "clone";
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
      if (!fs.statSync(config.options.paths[key]).isDirectory()) {
        throw Error(`"${key}" dir does not exist`);
      }
    });

    return config;
  } catch (error) {
    printLog("error", `Failed to load config file: ${error.message}`);

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

  const startupPromises = [];

  startupPromises.push(
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
      )
  );

  const addTileJSONs = (arr, req, type, tileSize) => {
    for (const id of Object.keys(repo[type])) {
      const info = clone((repo[type][id] || {}).tileJSON || {});
      let path = "";
      if (type === "rendered") {
        path = `styles/${id}`;
      } else {
        path = `${type}/${id}`;
      }

      info.tiles = getTileUrls(req, info.tiles, path, tileSize, info.format);

      arr.push(info);
    }

    return arr;
  };

  app.get("/(:tileSize(256|512)/)?rendered.json", async (req, res, next) => {
    const tileSize = parseInt(req.params.tileSize, 10) || undefined;

    res.send(addTileJSONs([], req, "rendered", tileSize));
  });

  app.get("/(:tileSize(256|512)/)?index.json", async (req, res, next) => {
    const tileSize = parseInt(req.params.tileSize, 10) || undefined;
    res.send(
      addTileJSONs(
        addTileJSONs([], req, "rendered", tileSize),
        req,
        "data",
        undefined
      )
    );
  });

  app.get("/data.json", async (req, res, next) => {
    res.send(addTileJSONs([], req, "data", undefined));
  });

  // serve web presentations
  app.use("/", express.static(path.resolve("public", "resources")));

  const serveTemplate = (urlPath, template, dataGetter) => {
    if (template === "index" && config.options.frontPage === false) {
      return;
    }

    const templatePath = path.resolve(
      "public",
      "templates",
      `${template}.tmpl`
    );

    startupPromises.push(
      new Promise((resolve, reject) => {
        fs.readFile(templatePath, (err, content) => {
          if (err) {
            reject(err);

            return;
          }

          const compiled = handlebars.compile(content.toString());

          app.use(urlPath, (req, res, next) => {
            let data = {};
            if (dataGetter) {
              data = dataGetter(req);
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

          resolve();
        });
      })
    );
  };

  serveTemplate("/$", "index", (req) => {
    const styles = {};

    Object.keys(repo.rendered).forEach((id) => {
      const style = repo.rendered[id];
      const {
        center = "",
        tiles = "",
        format = "",
        name = "",
      } = style.tileJSON;

      let viewer_hash = "";
      let thumbnail = "";
      if (center) {
        viewer_hash = `#${center[2]}/${center[1].toFixed(5)}/${center[0].toFixed(5)}`;

        const centerPx = mercator.px([center[0], center[1]], center[2]);

        // Set thumbnail (default size: 256px x 256px)
        thumbnail = `${center[2]}/${Math.floor(centerPx[0] / 256)}/${Math.floor(centerPx[1] / 256)}.png`;
      }

      styles[id] = {
        xyz_link: getTileUrls(req, tiles, `styles/${id}`, 256, format)[0],
        viewer_hash,
        thumbnail,
        name,
      };
    });

    const datas = {};

    Object.keys(repo.data).forEach((id) => {
      const data = repo.data[id];
      const { center, filesize, format, tiles, name } = data.tileJSON;

      let viewer_hash = "";
      let thumbnail = "";
      if (center) {
        viewer_hash = `#${center[2]}/${center[1].toFixed(5)}/${center[0].toFixed(5)}`;

        if (!(format === "pbf")) {
          const centerPx = mercator.px([center[0], center[1]], center[2]);

          // Set thumbnail (default size: 256px x 256px)
          thumbnail = `${center[2]}/${Math.floor(centerPx[0] / 256)}/${Math.floor(centerPx[1] / 256)}.${format}`;
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
        xyz_link: getTileUrls(req, tiles, `data/${id}`, undefined, format)[0],
        viewer_hash,
        thumbnail,
        sourceType: data.sourceType,
        is_vector: format === "pbf",
        formatted_filesize,
        name: name,
      };
    });

    return {
      styles: Object.keys(styles).length ? styles : null,
      data: Object.keys(datas).length ? datas : null,
    };
  });

  serveTemplate("/styles/:id/$", "viewer", (req) => {
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
  });

  serveTemplate("/styles/:id/wmts.xml", "wmts", (req) => {
    const id = decodeURI(req.params.id);
    const wmts = repo.rendered[id];
    const { name = "" } = wmts.tileJSON;

    if (!wmts) {
      return null;
    }

    return {
      id,
      name,
      baseUrl: `${req.get("X-Forwarded-Protocol") ? req.get("X-Forwarded-Protocol") : req.protocol}://${req.get("host")}/`,
    };
  });

  serveTemplate("/data/:id/$", "data", (req) => {
    const id = decodeURI(req.params.id);
    const data = repo.data[id];
    const { name = "", format = "" } = data.tileJSON;

    if (!data) {
      return null;
    }

    return {
      id,
      name,
      is_vector: format === "pbf",
    };
  });

  let startupComplete = false;

  app.get("/health", async (req, res, next) => {
    res.header("Content-Type", "text/plain");

    if (startupComplete) {
      return res.status(200).send("OK");
    } else {
      return res.status(503).send("Starting");
    }
  });

  Promise.all(startupPromises)
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
    .catch((err) => {
      printLog("error", `Failed to starting server: ${err}`);

      process.exit(1);
    });

  const server = app.listen(opts.port, function () {
    printLog("info", `Listening in port: ${this.address().port}`);
  });

  // add server.shutdown() to gracefully stop serving
  enableShutdown(server);

  const newChokidar = chokidar.watch(opts.config, {
    persistent: false,
    usePolling: true,
    awaitWriteFinish: true,
    interval: 1000,
    binaryInterval: 1000,
  });
  if (opts.kill || (opts.kill && opts.refresh)) {
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
