"use strict";

import fs from "node:fs";
import path from "node:path";
import fnv1a from "@sindresorhus/fnv1a";
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
import { getTileUrls, isValidHttpUrl, findFiles, printLog } from "./utils.js";

const mercator = new SphericalMercator();

const logFormat = `${chalk.gray(":date[iso]")} ${chalk.green("[INFO]")} :method :url :status :res[content-length] :response-time :remote-addr :user-agent`;

function loadConfigFile(configFilePath) {
  printLog("info", `Load config file: ${configFilePath}`);

  try {
    const config = JSON.parse(fs.readFileSync(configFilePath, "utf8"));

    config.options = config.options || {};

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
        throw Error(`Dir does not exist: ${config.options.paths[key]}`);
      }
    });

    config.styles = config.styles || {};
    config.data = config.data || {};
    config.sprites = config.sprites || {};
    config.icons = config.icons || [];

    return config;
  } catch (err) {
    printLog("error", `Failed to load config file: ${err.message}`);

    process.exit(1);
  }
}

/**
 *
 * @param opts
 */
export function newServer(opts) {
  printLog("info", "Starting server...");

  const config = loadConfigFile(opts.config);

  const serving = {
    styles: {},
    rendered: {},
    data: {},
    fonts: {},
    sprites: {},
    icons: [],
  };

  const app = express()
    .disable("x-powered-by")
    .enable("trust proxy")
    .use(morgan(logFormat))
    .use("/fonts", serve_font.init(config, serving.fonts))
    .use("/data/", serve_data.init(config.options, serving.data))
    .use("/styles/", serve_style.init(config.options, serving.styles))
    .use("/sprites/", serve_sprite.init(config, serving.sprites));

  const startupPromises = [];

  startupPromises.push(
    serve_rendered.init(config.options, serving.rendered).then((sub) => {
      app.use("/styles/", sub);
    })
  );

  startupPromises.push(serve_font.add(config, serving.fonts));
  startupPromises.push(serve_sprite.add(config, serving.sprites));

  const addStyle = (id, item, allowMoreData) => {
    let success = true;
    if (item.serve_data !== false) {
      success = serve_style.add(
        config.options,
        serving.styles,
        item,
        id,
        (styleSourceId, protocol) => {
          let dataItemId;
          for (const id of Object.keys(config.data)) {
            if (id === styleSourceId) {
              // Style id was found in data ids, return that id
              dataItemId = id;
            } else {
              const fileType = Object.keys(config.data[id])[0];
              if (config.data[id][fileType] === styleSourceId) {
                // Style id was found in data filename, return the id that filename belong to
                dataItemId = id;
              }
            }
          }

          if (dataItemId) {
            // input files exists in the data config, return found id
            return dataItemId;
          } else {
            if (!allowMoreData) {
              printLog(
                "error",
                `Style "${item.style}" using unknown file "${styleSourceId}". Skipping...`
              );

              return undefined;
            } else {
              let id =
                styleSourceId.substr(0, styleSourceId.lastIndexOf(".")) ||
                styleSourceId;
              if (isValidHttpUrl(styleSourceId)) {
                id =
                  fnv1a(styleSourceId) + "_" + id.replace(/^.*\/(.*)$/, "$1");
              }
              while (config.data[id]) id += "_"; //if the data source id already exists, add a "_" untill it doesn't
              //Add the new data source to the data array.
              config.data[id] = {
                [protocol]: styleSourceId,
              };

              return id;
            }
          }
        }
      );
    }

    if (success && item.serve_rendered !== false) {
      startupPromises.push(
        serve_rendered.add(
          config.options,
          serving.rendered,
          item,
          id,
          function dataResolver(styleSourceId) {
            let fileType;
            let inputFile;
            for (const id of Object.keys(config.data)) {
              fileType = Object.keys(config.data[id])[0];
              if (styleSourceId == id) {
                inputFile = config.data[id][fileType];

                break;
              } else if (config.data[id][fileType] == styleSourceId) {
                inputFile = config.data[id][fileType];

                break;
              }
            }
            if (!isValidHttpUrl(inputFile)) {
              inputFile = path.resolve(
                config.options.paths[fileType],
                inputFile
              );
            }

            return { inputFile, fileType };
          }
        )
      );
    }
  };

  for (const id of Object.keys(config.styles)) {
    const item = config.styles[id];
    if (!item.style || item.style.length === 0) {
      printLog("error", `Missing "style" property for ${id}`);

      continue;
    }

    addStyle(id, item, true);
  }

  for (const id of Object.keys(config.data)) {
    const item = config.data[id];
    const fileType = Object.keys(config.data[id])[0];
    if (!fileType || !(fileType === "pmtiles" || fileType === "mbtiles")) {
      printLog(
        "error",
        `Missing "pmtiles" or "mbtiles" property for ${id} data source`
      );

      continue;
    }

    startupPromises.push(
      serve_data.add(config.options, serving.data, item, id)
    );
  }

  const addTileJSONs = (arr, req, type, tileSize) => {
    for (const id of Object.keys(serving[type])) {
      const info = clone((serving[type][id] || {}).tileJSON || {});
      let path = "";
      if (type === "rendered") {
        path = `styles/${id}`;
      } else {
        path = `${type}/${id}`;
      }

      info.tiles = getTileUrls(req, info.tiles, path, tileSize, info.format, {
        pbf: config.options.pbfAlias,
      });

      arr.push(info);
    }

    return arr;
  };

  app.get("/(:tileSize(256|512)/)?rendered.json", (req, res, next) => {
    const tileSize = parseInt(req.params.tileSize, 10) || undefined;

    res.send(addTileJSONs([], req, "rendered", tileSize));
  });

  app.get("/(:tileSize(256|512)/)?index.json", (req, res, next) => {
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

  app.get("/data.json", (req, res, next) => {
    res.send(addTileJSONs([], req, "data", undefined));
  });

  let startupComplete = false;

  app.get("/health", (req, res, next) => {
    if (startupComplete) {
      return res.status(200).send("OK");
    } else {
      return res.status(503).send("Starting");
    }
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
            reject(err.message);

            return;
          }

          const compiled = handlebars.compile(content.toString());

          app.use(urlPath, (req, res, next) => {
            let data = {};
            if (dataGetter) {
              data = dataGetter(req);
              if (!data) {
                return res.status(404).send("Not found");
              }
            }

            data.key_query_part = req.query.key
              ? `key=${encodeURIComponent(req.query.key)}&amp;`
              : "";
            data.key_query = req.query.key
              ? `?key=${encodeURIComponent(req.query.key)}`
              : "";

            if (template === "wmts") res.set("Content-Type", "text/xml");

            return res.status(200).send(compiled(data));
          });

          resolve();
        });
      })
    );
  };

  serveTemplate("/$", "index", (req) => {
    let styles = {};
    for (const id of Object.keys(serving.styles)) {
      let style = {
        ...serving.styles[id],
        serving_data: serving.styles[id],
        serving_rendered: serving.rendered[id],
      };

      if (style.serving_rendered) {
        const { center } = style.serving_rendered.tileJSON;
        if (center) {
          style.viewer_hash = `#${center[2]}/${center[1].toFixed(5)}/${center[0].toFixed(5)}`;

          const centerPx = mercator.px([center[0], center[1]], center[2]);
          // Set thumbnail default size to be 256px x 256px
          style.thumbnail = `${center[2]}/${Math.floor(centerPx[0] / 256)}/${Math.floor(centerPx[1] / 256)}.png`;
        }

        const tileSize = 256;
        style.xyz_link = getTileUrls(
          req,
          style.serving_rendered.tileJSON.tiles,
          `styles/${id}`,
          tileSize,
          style.serving_rendered.tileJSON.format
        )[0];
      }

      styles[id] = style;
    }

    let datas = {};
    for (const id of Object.keys(serving.data)) {
      let data = clone(serving.data[id] || {});

      const { tileJSON } = serving.data[id];
      const { center } = tileJSON;

      if (center) {
        data.viewer_hash = `#${center[2]}/${center[1].toFixed(
          5
        )}/${center[0].toFixed(5)}`;
      }

      data.is_vector = tileJSON.format === "pbf";
      if (!data.is_vector) {
        if (center) {
          const centerPx = mercator.px([center[0], center[1]], center[2]);
          data.thumbnail = `${center[2]}/${Math.floor(centerPx[0] / 256)}/${Math.floor(centerPx[1] / 256)}.${tileJSON.format}`;
        }
      }

      const tileSize = undefined;
      data.xyz_link = getTileUrls(
        req,
        tileJSON.tiles,
        `data/${id}`,
        tileSize,
        tileJSON.format,
        {
          pbf: config.options.pbfAlias,
        }
      )[0];

      if (data.filesize) {
        let suffix = "kB";
        let size = parseInt(tileJSON.filesize, 10) / 1024;
        if (size > 1024) {
          suffix = "MB";
          size /= 1024;
        }
        if (size > 1024) {
          suffix = "GB";
          size /= 1024;
        }
        data.formatted_filesize = `${size.toFixed(2)} ${suffix}`;
      }

      datas[id] = data;
    }

    return {
      styles: Object.keys(styles).length ? styles : null,
      data: Object.keys(datas).length ? datas : null,
    };
  });

  serveTemplate("/styles/:id/$", "viewer", (req) => {
    const { id } = req.params;
    const style = serving.styles[id]?.styleJSON;

    if (!style) {
      return null;
    }

    return {
      ...style,
      id,
      name: (serving.styles[id] || serving.rendered[id]).name,
      serving_data: serving.styles[id],
      serving_rendered: serving.rendered[id],
    };
  });

  serveTemplate("/styles/:id/wmts.xml", "wmts", (req) => {
    const { id } = req.params;
    const wmts = serving.styles[id];

    if (!wmts) {
      return null;
    }

    if (wmts.hasOwnProperty("serve_rendered") && !wmts.serve_rendered) {
      return null;
    }

    return {
      ...wmts,
      id,
      name: (serving.styles[id] || serving.rendered[id]).name,
      baseUrl: `${req.get("X-Forwarded-Protocol") ? req.get("X-Forwarded-Protocol") : req.protocol}://${req.get("host")}/`,
    };
  });

  serveTemplate("/data/:id/$", "data", (req) => {
    const { id } = req.params;
    const data = serving.data[id];

    if (!data) {
      return null;
    }

    return {
      ...data,
      id,
      is_vector: data.tileJSON.format === "pbf",
    };
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
    interval: 100,
    binaryInterval: 100,
  });
  if (opts.kill || (opts.kill && opts.refresh)) {
    printLog("info", "Enable kill server after changing config file");

    newChokidar.on("change", () => {
      printLog("info", `Config file has changed. Kill server...`);

      process.exit(0);
    });
  } else if (opts.refresh) {
    printLog("info", "Enable refresh server after changing config file");

    newChokidar.on("change", () => {
      printLog("info", `Config file has changed. Refreshing server...`);

      newChokidar.close();

      server.shutdown((err) => {
        newServer(opts);
      });
    });
  }

  app.get("/refresh", (req, res, next) => {
    printLog("info", "Refreshing server...");

    if (opts.autoRefresh) {
      newChokidar.close();
    }

    server.shutdown((err) => {
      newServer(opts);
    });

    return res.status(200).send("OK");
  });

  app.get("/kill", (req, res, next) => {
    printLog("info", "Killed server!");

    server.shutdown((err) => {
      process.exit(0);
    });

    return res.status(200).send("OK");
  });

  Promise.all(startupPromises)
    .then(() => {
      printLog("info", "Startup complete!");

      startupComplete = true;
    })
    .catch((err) => {
      printLog("error", `Failed to starting server: ${err.message}`);

      process.exit(1);
    });
}
