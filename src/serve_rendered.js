"use strict";

import advancedPool from "advanced-pool";
import fs from "node:fs";
import path from "node:path";
import url from "url";
import zlib from "zlib";
import sharp from "sharp";
import Color from "color";
import express from "express";
import SphericalMercator from "@mapbox/sphericalmercator";
import mlgl from "@maplibre/maplibre-gl-native";
import MBTiles from "@mapbox/mbtiles";
import proj4 from "proj4";
import axios from "axios";
import {
  getFontsPbf,
  getTileUrls,
  fixTileJSONCenter,
  openPMtiles,
  getPMtilesInfo,
  getPMtilesTile,
  printLog,
  getUrl,
} from "./utils.js";

/**
 * Lookup of sharp output formats by file extension.
 */
const extensionToFormat = {
  ".jpg": "jpeg",
  ".jpeg": "jpeg",
  ".png": "png",
  ".webp": "webp",
  ".pbf": "pbf",
  ".geojson": "geojson",
};

const mercator = new SphericalMercator();

mlgl.on("message", (error) => {
  if (error.severity === "ERROR") {
    printLog("error", `mlgl: ${JSON.stringify(error)}`);
  } else if (error.severity === "WARNING") {
    printLog("warning", `mlgl: ${JSON.stringify(error)}`);
  }
});

/**
 * Cache of response data by sharp output format and color. Entry for empty
 * string is for unknown or unsupported formats.
 */
const cachedEmptyResponses = {
  "": Buffer.alloc(0),
};

/**
 * Create an appropriate mlgl response for http errors.
 * @param {string} format The format (a sharp format or 'pbf').
 * @param {string} color The background color (or empty string for transparent).
 * @param {Function} callback The mlgl callback.
 */
function createEmptyResponse(format, color, callback) {
  if (!format || format === "pbf") {
    callback(null, {
      data: cachedEmptyResponses[""],
    });

    return;
  }

  if (format === "jpg") {
    format = "jpeg";
  }

  if (!color) {
    color = "rgba(255,255,255,0)";
  }

  const cacheKey = `${format},${color}`;
  const data = cachedEmptyResponses[cacheKey];
  if (data) {
    callback(null, {
      data: data,
    });

    return;
  }

  // create an "empty" response image
  color = new Color(color);
  const array = color.array();
  const channels = array.length === 4 && format !== "jpeg" ? 4 : 3;
  sharp(Buffer.from(array), {
    raw: {
      width: 1,
      height: 1,
      channels,
    },
  })
    .toFormat(format)
    .toBuffer((error, buffer) => {
      if (!error) {
        cachedEmptyResponses[cacheKey] = buffer;
      }

      callback(null, {
        data: buffer,
      });
    });
}

function respondImage(config, item, z, lon, lat, tileSize, format, res) {
  if (Math.abs(lon) > 180 || Math.abs(lat) > 85.06) {
    res.header("Content-Type", "text/plain");

    return res.status(400).send("Invalid center");
  }

  if (format === "png" || format === "webp") {
  } else if (format === "jpg" || format === "jpeg") {
    format = "jpeg";
  } else {
    res.header("Content-Type", "text/plain");

    return res.status(400).send("Invalid format");
  }

  item.map.renderers.acquire((error, renderer) => {
    // For 512px tiles, use the actual maplibre-native zoom. For 256px tiles, use zoom - 1
    let mlglZ;
    if (tileSize === 512) {
      mlglZ = Math.max(0, z);
    } else {
      mlglZ = Math.max(0, z - 1);
    }

    const params = {
      zoom: mlglZ,
      center: [lon, lat],
      bearing: 0,
      pitch: 0,
      width: tileSize,
      height: tileSize,
    };

    // HACK(Part 1) 256px tiles are a zoom level lower than maplibre-native default tiles. this hack allows tile-server to support zoom 0 256px tiles, which would actually be zoom -1 in maplibre-native. Since zoom -1 isn't supported, a double sized zoom 0 tile is requested and resized in Part 2.
    if (z === 0 && tileSize === 256) {
      params.width *= 2;
      params.height *= 2;
    }
    // END HACK(Part 1)

    renderer.render(params, (error, data) => {
      item.map.renderers.release(renderer);

      const image = sharp(data, {
        raw: {
          premultiplied: true,
          width: params.width,
          height: params.height,
          channels: 4,
        },
      });

      // HACK(Part 2) 256px tiles are a zoom level lower than maplibre-native default tiles. this hack allows tile-server to support zoom 0 256px tiles, which would actually be zoom -1 in maplibre-native. Since zoom -1 isn't supported, a double sized zoom 0 tile is requested and resized here.
      if (z === 0 && tileSize === 256) {
        image.resize(tileSize, tileSize);
      }
      // END HACK(Part 2)

      if (format === "png") {
        image.png({ adaptiveFiltering: false });
      } else if (format === "jpeg") {
        image.jpeg({ quality: config.options.formatQuality?.[format] || 80 });
      } else if (format === "webp") {
        image.webp({ quality: config.options.formatQuality?.[format] || 90 });
      }

      image.toBuffer((error, buffer, info) => {
        if (!buffer) {
          res.header("Content-Type", "text/plain");

          return res.status(404).send("Not found");
        }

        res.header("Content-Type", `image/${format}`);

        return res.status(200).send(buffer);
      });
    });
  });
}

function getRenderedTileHandler(getConfig) {
  return async (req, res, next) => {
    const config = getConfig();
    const id = decodeURI(req.params.id);
    const item = config.repo.rendered[id];

    try {
      if (!item) {
        throw Error("Rendered data is not found");
      }

      const z = Number(req.params.z);
      const x = Number(req.params.x);
      const y = Number(req.params.y);
      const maxXY = Math.pow(2, z);

      if (
        !(0 <= z && z <= 22) ||
        !(0 <= x && x < maxXY) ||
        !(0 <= y && y < maxXY)
      ) {
        throw Error("Rendered data is out of bounds");
      }

      const tileCenter = mercator.ll(
        [
          ((x + 0.5) / (1 << z)) * (256 << z),
          ((y + 0.5) / (1 << z)) * (256 << z),
        ],
        z
      );

      return respondImage(
        config,
        item,
        z,
        tileCenter[0],
        tileCenter[1],
        Number(req.params.tileSize) || 256,
        req.params.format,
        res
      );
    } catch (error) {
      printLog("error", `Failed to get rendered data "${id}": ${error}`);

      res.header("Content-Type", "text/plain");

      return res.status(404).send("Rendered data is not found");
    }
  };
}

function getRenderedHandler(getConfig) {
  return async (req, res, next) => {
    const config = getConfig();
    const id = decodeURI(req.params.id);
    const item = config.repo.rendered[id];

    try {
      if (!item) {
        throw Error("Rendered data is not found");
      }

      const info = {
        ...item.tileJSON,
        tiles: getTileUrls(
          req,
          item.tileJSON.tiles,
          `styles/${id}`,
          Number(req.params.tileSize),
          item.tileJSON.format
        ),
      };

      res.header("Content-type", "application/json");

      return res.status(200).send(info);
    } catch (error) {
      printLog("error", `Failed to get rendered data "${id}": ${error}`);

      res.header("Content-Type", "text/plain");

      return res.status(404).send("Rendered data is not found");
    }
  };
}

function getRenderedsListHandler(getConfig) {
  return async (req, res, next) => {
    const config = getConfig();
    const rendereds = Object.keys(config.repo.rendered);

    const result = rendereds.map((rendered) => {
      const tileJSON = config.repo.rendered[rendered].tileJSON;

      return {
        id: rendered,
        name: tileJSON.name,
        url: `${getUrl(req)}styles/${rendered}/${req.params || ""}{z}/{x}/{y}.${tileJSON.format}`,
      };
    });

    res.header("Content-Type", "text/plain");

    return res.status(200).send(result);
  };
}

export const serve_rendered = {
  init: (getConfig) => {
    const app = express();

    app.get(
      "/(:tileSize(256|512)/)?rendered.json",
      getRenderedsListHandler(getConfig)
    );

    app.get(
      `/:id/(:tileSize(256|512)/)?:z(\\d+)/:x(\\d+)/:y(\\d+).:format((pbf|jpg|png|jpeg|webp|geojson){1})`,
      getRenderedTileHandler(getConfig)
    );

    app.get("/(:tileSize(256|512)/)?:id.json", getRenderedHandler(getConfig));

    return app;
  },

  add: async (config) => {
    const createPool = (map, style, styleJSON, min, max) => {
      return new advancedPool.Pool({
        min,
        max,
        create: (createCallback) => {
          const renderer = new mlgl.Map({
            mode: "tile",
            request: async (req, callback) => {
              const protocol = req.url.split(":")[0];

              if (protocol === "sprites") {
                const filePath = path.join(
                  config.options.paths.sprites,
                  decodeURIComponent(req.url).substring(protocol.length + 3)
                );

                fs.readFile(filePath, (error, data) => {
                  callback(error, {
                    data: data,
                  });
                });
              } else if (protocol === "fonts") {
                const parts = decodeURIComponent(req.url).split("/");
                const fonts = parts[2];
                const range = parts[3].split(".")[0];

                try {
                  callback(null, {
                    data: await getFontsPbf(
                      config.options.paths.fonts,
                      fonts,
                      range
                    ),
                  });
                } catch (error) {
                  callback(error, {
                    data: null,
                  });
                }
              } else if (protocol === "mbtiles" || protocol === "pmtiles") {
                const parts = decodeURIComponent(req.url).split("/");
                const sourceId = parts[2];
                const source = map.sources[sourceId];
                const sourceType = map.sourceTypes[sourceId];
                const sourceInfo = styleJSON.sources[sourceId];
                const z = Number(parts[3]) || 0;
                const x = Number(parts[4]) || 0;
                const y = Number(parts[5]?.split(".")[0]) || 0;
                const format = parts[5]?.split(".")[1] || "";

                if (sourceType === "mbtiles") {
                  source.getTile(z, x, y, (error, data) => {
                    if (error) {
                      printLog(
                        "warning",
                        `MBTiles source "${sourceId}" error: ${error}. Serving empty`
                      );

                      createEmptyResponse(
                        sourceInfo.format,
                        sourceInfo.color,
                        callback
                      );

                      return;
                    }

                    const response = {};

                    if (format === "pbf") {
                      try {
                        response.data = zlib.unzipSync(data);
                      } catch (error) {
                        printLog(
                          "error",
                          `Skipping incorrect header for tile mbtiles://${style}/${z}/${x}/${y}.pbf`
                        );
                      }
                    } else {
                      response.data = data;
                    }

                    callback(null, response);
                  });
                } else if (sourceType === "pmtiles") {
                  const { data } = await getPMtilesTile(source, z, x, y);

                  if (!data) {
                    printLog(
                      "warning",
                      `PMTiles source "${sourceId}" error: ${error}. Serving empty`
                    );

                    createEmptyResponse(
                      sourceInfo.format,
                      sourceInfo.color,
                      callback
                    );

                    return;
                  }

                  callback(null, {
                    data: data,
                  });
                }
              } else if (protocol === "http" || protocol === "https") {
                try {
                  const { data } = await axios.get(req.url, {
                    responseType: "arraybuffer",
                  });

                  callback(null, {
                    data: data,
                  });
                } catch (error) {
                  const ext = path
                    .extname(url.parse(req.url).pathname)
                    .toLowerCase();

                  createEmptyResponse(extensionToFormat[ext], "", callback);
                }
              }
            },
          });

          renderer.load(styleJSON);

          createCallback(null, renderer);
        },
        destroy: (renderer) => {
          renderer.release();
        },
      });
    };

    const styles = Object.keys(config.repo.styles);

    await Promise.all(
      styles.map(async (style) => {
        const item = config.styles[style];
        const map = {
          sources: {},
          sourceTypes: {},
        };

        try {
          const file = fs.readFileSync(
            path.join(config.options.paths.styles, item.style)
          );

          const styleJSON = JSON.parse(file);

          const tileJSON = {
            tilejson: "2.2.0",
            name: styleJSON.name,
            attribution: "",
            minzoom: 0,
            maxzoom: 24,
            bounds: [-180, -85.0511, 180, 85.0511],
            format: "png",
            type: "baselayer",
            tiles: config.options.domains,
          };

          const attributionOverride = !!item.tilejson?.attribution;

          if (styleJSON.center?.length === 2 && styleJSON.zoom) {
            tileJSON.center = styleJSON.center.concat(
              Math.round(styleJSON.zoom)
            );
          }

          Object.assign(tileJSON, item.tilejson);

          fixTileJSONCenter(tileJSON);

          const repoobj = {
            tileJSON,
            map,
            dataProjWGStoInternalWGS: null,
          };

          config.repo.rendered[style] = repoobj;

          const queue = [];
          const sources = Object.keys(styleJSON.sources);
          for (const name of sources) {
            const source = styleJSON.sources[name];

            if (
              source.url?.startsWith("pmtiles://") ||
              source.url?.startsWith("mbtiles://")
            ) {
              const sourceURL = source.url.slice(10);

              // found pmtiles or mbtiles source, replace with info from local file
              delete source.url;

              if (!sourceURL.startsWith("{") || !sourceURL.endsWith("}")) {
                throw Error(`Source data "${name}" is invalid`);
              }

              const sourceID = sourceURL.slice(1, -1);

              if (config.repo.data[sourceID]?.sourceType === "mbtiles") {
                queue.push(
                  new Promise((resolve, reject) => {
                    const inputFile = path.resolve(
                      config.options.paths.mbtiles,
                      config.data[sourceID].mbtiles
                    );

                    const stat = fs.statSync(inputFile);
                    if (stat.isFile() === false || stat.size === 0) {
                      throw Error(`MBTiles source data "${name}" is invalid`);
                    }

                    map.sourceTypes[name] = "mbtiles";
                    map.sources[name] = new MBTiles(
                      inputFile + "?mode=ro",
                      (error, mbtiles) => {
                        if (error) {
                          reject(error);
                        }

                        mbtiles.getInfo((error, info) => {
                          if (error) {
                            reject(error);
                          }

                          if (!repoobj.dataProjWGStoInternalWGS && info.proj4) {
                            // how to do this for multiple sources with different proj4 defs?
                            const to3857 = proj4("EPSG:3857");
                            const toDataProj = proj4(info.proj4);
                            repoobj.dataProjWGStoInternalWGS = (xy) =>
                              to3857.inverse(toDataProj.forward(xy));
                          }

                          const type = source.type;

                          Object.assign(source, info);

                          source.type = type;
                          source.tiles = [
                            // meta url which will be detected when requested
                            `mbtiles://${name}/{z}/{x}/{y}.${info.format || "pbf"}`,
                          ];

                          if (
                            !attributionOverride &&
                            source.attribution?.length > 0
                          ) {
                            if (
                              !tileJSON.attribution.includes(source.attribution)
                            ) {
                              if (tileJSON.attribution.length > 0) {
                                tileJSON.attribution += " | ";
                              }

                              tileJSON.attribution += source.attribution;
                            }
                          }

                          resolve();
                        });
                      }
                    );
                  })
                );
              } else if (config.repo.data[sourceID]?.sourceType === "pmtiles") {
                const inputFile = path.join(
                  config.options.paths.pmtiles,
                  config.data[sourceID].pmtiles
                );

                const stat = fs.statSync(inputFile);
                if (stat.isFile() === false || stat.size === 0) {
                  throw Error(`PMTiles source data "${name}" is invalid`);
                }

                map.sources[name] = openPMtiles(inputFile);
                map.sourceTypes[name] = "pmtiles";

                const metadata = await getPMtilesInfo(map.sources[name]);

                if (!repoobj.dataProjWGStoInternalWGS && metadata.proj4) {
                  // how to do this for multiple sources with different proj4 defs?
                  const to3857 = proj4("EPSG:3857");
                  const toDataProj = proj4(metadata.proj4);
                  repoobj.dataProjWGStoInternalWGS = (xy) =>
                    to3857.inverse(toDataProj.forward(xy));
                }

                const type = source.type;

                Object.assign(source, metadata);

                source.type = type;
                source.tiles = [
                  // meta url which will be detected when requested
                  `pmtiles://${name}/{z}/{x}/{y}.${metadata.format || "pbf"}`,
                ];

                if (!attributionOverride && source.attribution?.length > 0) {
                  if (!tileJSON.attribution.includes(source.attribution)) {
                    if (tileJSON.attribution.length > 0) {
                      tileJSON.attribution += " | ";
                    }

                    tileJSON.attribution += source.attribution;
                  }
                }
              }
            }
          }

          await Promise.all(queue);

          map.renderers = createPool(
            map,
            style,
            styleJSON,
            config.options.minPoolSize || 8,
            config.options.maxPoolSize || 16
          );
        } catch (error) {
          printLog(
            "error",
            `Failed to load rendered data "${style}": ${error}. Skipping...`
          );
        }
      })
    );
  },

  remove: async (config) => {
    const rendereds = Object.keys(config.repo.rendered);

    rendereds.map(async (rendered) => {
      config.repo.rendered[rendered].map.renderers.close();
    });

    config.repo.rendered = {};
  },
};
