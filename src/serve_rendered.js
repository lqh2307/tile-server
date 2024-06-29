"use strict";

import { createPool } from "generic-pool";
import fs from "node:fs";
import path from "node:path";
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
  fixTileJSONCenter,
  getPMtilesInfo,
  getPMtilesTile,
  getFontsPbf,
  openPMtiles,
  printLog,
  getUrl,
} from "./utils.js";

mlgl.on("message", (error) => {
  if (error.severity === "ERROR") {
    printLog("error", `mlgl: ${JSON.stringify(error)}`);
  } else if (error.severity === "WARNING") {
    printLog("warning", `mlgl: ${JSON.stringify(error)}`);
  }
});

const mercator = new SphericalMercator();

/**
 * Cache of response data by sharp output format and color.
 * Entry for empty string is for unknown or unsupported formats.
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
  if (format === "jpg") {
    format = "jpeg";
  } else if (
    format === "pbf" ||
    ["jpeg", "png", "webp"].includes(format) === false
  ) {
    callback(null, {
      data: cachedEmptyResponses[""],
    });

    return;
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

  // Create an empty response image
  color = new Color(color);
  const array = color.array();
  sharp(Buffer.from(array), {
    raw: {
      width: 1,
      height: 1,
      channels: array.length === 4 && format !== "jpeg" ? 4 : 3,
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

function getRenderedTileHandler(config) {
  return async (req, res, next) => {
    const id = decodeURI(req.params.id);
    const item = config.repo.rendereds[id];

    if (!item) {
      return res.status(404).send("Rendered data is not found");
    }

    const z = Number(req.params.z);
    const x = Number(req.params.x);
    const y = Number(req.params.y);

    if (z > 22 || x >= Math.pow(2, z) || y >= Math.pow(2, z)) {
      return res.status(400).send("Rendered data bound is invalid");
    }

    const tileCenter = mercator.ll(
      [
        ((x + 0.5) / (1 << z)) * (256 << z),
        ((y + 0.5) / (1 << z)) * (256 << z),
      ],
      z
    );
    if (Math.abs(tileCenter[0]) > 180 || Math.abs(tileCenter[1]) > 85.06) {
      return res.status(400).send("Rendered data center is invalid");
    }

    const scale = req.params.scale?.slice(1, -1) || 1;

    if (scale > config.options.maxScaleRender) {
      return res.status(400).send("Rendered data scale is invalid");
    }

    const format = req.params.format;

    if (format === "png" || format === "webp") {
    } else if (format === "jpg" || format === "jpeg") {
      format = "jpeg";
    } else {
      return res.status(400).send("Rendered data format is invalid");
    }

    const tileSize = Number(req.params.tileSize) || 256;

    // For 512px tiles, use the actual maplibre-native zoom. For 256px tiles, use zoom - 1
    const params = {
      zoom: tileSize === 512 ? Math.max(0, z) : Math.max(0, z - 1),
      center: tileCenter,
      width: tileSize,
      height: tileSize,
    };

    // HACK(Part 1) 256px tiles are a zoom level lower than maplibre-native default tiles.
    // This hack allows tile-server to support zoom 0 256px tiles, which would actually be zoom -1 in maplibre-native.
    // Since zoom -1 isn't supported, a double sized zoom 0 tile is requested and resized in Part 2.
    if (z === 0 && tileSize === 256) {
      params.width *= 2;
      params.height *= 2;
    }
    // END HACK(Part 1)

    try {
      const renderer = await item.renderers[scale - 1].acquire();

      renderer.render(params, (error, data) => {
        item.renderers[scale - 1].release(renderer);

        if (error) {
          throw error;
        }

        const image = sharp(data, {
          raw: {
            premultiplied: true,
            width: params.width * scale,
            height: params.height * scale,
            channels: 4,
          },
        });

        // HACK(Part 2) 256px tiles are a zoom level lower than maplibre-native default tiles.
        // This hack allows tile-server to support zoom 0 256px tiles, which would actually be zoom -1 in maplibre-native.
        // Since zoom -1 isn't supported, a double sized zoom 0 tile is requested and resized here.
        if (z === 0 && tileSize === 256) {
          image.resize(tileSize * scale, tileSize * scale);
        }
        // END HACK(Part 2)

        if (format === "png") {
          image.png({
            adaptiveFiltering: false,
          });
        } else if (format === "jpeg") {
          image.jpeg({
            quality: config.options.formatQuality.jpeg,
          });
        } else if (format === "webp") {
          image.webp({
            quality: config.options.formatQuality.webp,
          });
        }

        image.toBuffer((error, buffer, info) => {
          if (error) {
            throw error;
          }

          if (!buffer) {
            return res.status(404).send("Rendered data is not found");
          }

          res.header("Content-Type", `image/${format}`);

          return res.status(200).send(buffer);
        });
      });
    } catch (error) {
      printLog("error", `Failed to get rendered data "${id}": ${error}`);

      return res.status(404).send("Rendered data is not found");
    }
  };
}

function getRenderedHandler(config) {
  return async (req, res, next) => {
    const id = decodeURI(req.params.id);
    const item = config.repo.rendereds[id];

    if (!item) {
      return res.status(404).send("Rendered data is not found");
    }

    const info = {
      ...item.tileJSON,
      tiles: [
        `${getUrl(req)}styles/${id}/${req.params.tileSize || 256}/{z}/{x}/{y}.${item.tileJSON.format}`,
      ],
    };

    res.header("Content-type", "application/json");

    return res.status(200).send(info);
  };
}

function getRenderedsListHandler(config) {
  return async (req, res, next) => {
    const rendereds = Object.keys(config.repo.rendereds);

    const result = rendereds.map((rendered) => {
      const tileJSON = config.repo.rendereds[rendered].tileJSON;

      return {
        id: rendered,
        name: tileJSON.name || "",
        url: [
          `${getUrl(req)}styles/256/${rendered}.json`,
          `${getUrl(req)}styles/512/${rendered}.json`,
        ],
      };
    });

    return res.status(200).send(result);
  };
}

export const serve_rendered = {
  init: (config) => {
    const app = express();

    app.get("/rendereds.json", getRenderedsListHandler(config));
    app.get("/(:tileSize(256|512)/)?:id.json", getRenderedHandler(config));
    app.get(
      `/:id/(:tileSize(256|512)/)?:z(\\d+)/:x(\\d+)/:y(\\d+):scale(@\\d+x)?.:format(pbf|jpg|png|jpeg|webp)`,
      getRenderedTileHandler(config)
    );

    return app;
  },

  add: async (config) => {
    const styles = Object.keys(config.repo.styles);

    await Promise.all(
      styles.map(async (style) => {
        try {
          const styleJSON = JSON.parse(
            fs.readFileSync(
              path.join(config.options.paths.styles, config.styles[style].style)
            )
          );

          const tileJSON = {
            tilejson: "2.2.0",
            name: styleJSON.name || "",
            attribution: "",
            minzoom: 0,
            maxzoom: 22,
            bounds: [-180, -85.0511, 180, 85.0511],
            format: "png",
            type: "baselayer",
          };

          if (styleJSON.center?.length === 2 && styleJSON.zoom) {
            tileJSON.center = styleJSON.center.concat(
              Math.round(styleJSON.zoom)
            );
          }

          fixTileJSONCenter(tileJSON);

          const repoobj = {
            tileJSON,
            sources: {},
            sourceTypes: {},
            renderers: [],
          };

          const queue = [];
          const sources = Object.keys(styleJSON.sources);
          for (const name of sources) {
            const source = styleJSON.sources[name];

            if (
              source.url?.startsWith("pmtiles://") === true ||
              source.url?.startsWith("mbtiles://") === true
            ) {
              const sourceID = source.url.slice(11, -1);
              const sourceType = source.url.slice(0, 7);

              // found pmtiles or mbtiles source, replace with info from local file
              delete source.url;

              if (sourceType === "mbtiles") {
                queue.push(
                  new Promise((resolve, reject) => {
                    const inputFile = path.resolve(
                      config.options.paths.mbtiles,
                      config.data[sourceID].mbtiles
                    );

                    repoobj.sourceTypes[name] = "mbtiles";
                    repoobj.sources[name] = new MBTiles(
                      inputFile + "?mode=ro",
                      (error, mbtiles) => {
                        if (error) {
                          reject(error);
                        }

                        mbtiles.getInfo((error, info) => {
                          if (error) {
                            reject(error);
                          }

                          if (info.proj4) {
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
                            `mbtiles://${name}/{z}/{x}/{y}.${info.format}`,
                          ];

                          if (source.attribution) {
                            tileJSON.attribution = source.attribution;
                          }

                          resolve();
                        });
                      }
                    );
                  })
                );
              } else if (sourceType === "pmtiles") {
                const inputFile = path.join(
                  config.options.paths.pmtiles,
                  config.data[sourceID].pmtiles
                );

                repoobj.sources[name] = openPMtiles(inputFile);
                repoobj.sourceTypes[name] = "pmtiles";

                const metadata = await getPMtilesInfo(repoobj.sources[name]);

                if (metadata.proj4) {
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
                  `pmtiles://${name}/{z}/{x}/{y}.${metadata.format}`,
                ];

                if (source.attribution) {
                  tileJSON.attribution = source.attribution;
                }
              }
            }
          }

          await Promise.all(queue);

          for (let scale = 1; scale <= config.options.maxScaleRender; scale++) {
            repoobj.renderers[scale - 1] = createPool(
              {
                create: async () => {
                  const renderer = new mlgl.Map({
                    mode: "tile",
                    ratio: scale,
                    request: async (req, callback) => {
                      const protocol = req.url.split(":")[0];

                      if (protocol === "sprites") {
                        const filePath = path.join(
                          config.options.paths.sprites,
                          decodeURIComponent(req.url).substring(
                            protocol.length + 3
                          )
                        );

                        try {
                          fs.readFile(filePath, (error, data) => {
                            callback(error, {
                              data: data,
                            });
                          });
                        } catch (error) {
                          callback(error, {
                            data: null,
                          });
                        }
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
                      } else if (
                        protocol === "mbtiles" ||
                        protocol === "pmtiles"
                      ) {
                        const parts = decodeURIComponent(req.url).split("/");
                        const sourceId = parts[2];
                        const source = repoobj.sources[sourceId];
                        const sourceType = repoobj.sourceTypes[sourceId];
                        const sourceInfo = styleJSON.sources[sourceId];
                        const z = Number(parts[3]);
                        const x = Number(parts[4]);
                        const y = Number(parts[5].split(".")[0]);

                        if (sourceType === "mbtiles") {
                          source.getTile(z, x, y, (error, data) => {
                            if (error || !data) {
                              printLog(
                                "warning",
                                `MBTiles source "${sourceId}": ${error}. Serving empty...`
                              );

                              createEmptyResponse(
                                sourceInfo.format,
                                sourceInfo.color,
                                callback
                              );

                              return;
                            }

                            if (sourceInfo.format === "pbf") {
                              try {
                                data = zlib.unzipSync(data);
                              } catch (error) {
                                callback(error, {
                                  data: nul,
                                });
                              }
                            }

                            callback(null, {
                              data: data,
                            });
                          });
                        } else if (sourceType === "pmtiles") {
                          const { data } = await getPMtilesTile(
                            source,
                            z,
                            x,
                            y
                          );

                          if (!data) {
                            printLog(
                              "warning",
                              `PMTiles source "${sourceId}": ${error}. Serving empty...`
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
                          const { data } = await axios.get(
                            decodeURIComponent(req.url),
                            {
                              responseType: "arraybuffer",
                            }
                          );

                          callback(null, {
                            data: data,
                          });
                        } catch (error) {
                          const format = req.originalUrl?.slice(
                            req.originalUrl.lastIndexOf("."),
                            -1
                          );

                          createEmptyResponse(format, "", callback);
                        }
                      }
                    },
                  });

                  renderer.load(styleJSON);

                  return renderer;
                },
                destroy: async (renderer) => {
                  renderer.release();
                },
              },
              {
                min: config.options.minPoolSize,
                max: config.options.maxPoolSize,
              }
            );
          }

          config.repo.rendereds[style] = repoobj;
        } catch (error) {
          printLog(
            "error",
            `Failed to load rendered data "${style}": ${error}. Skipping...`
          );
        }
      })
    );
  },
};
