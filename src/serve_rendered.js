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
import axios from "axios";
import {
  fixTileJSONCenter,
  getPMTilesTile,
  getMBTilesTile,
  getFontsPbf,
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
 * Create an appropriate mlgl response for http errors
 * @param {string} format tile format
 * @param {Function} callback mlgl callback
 */
function createEmptyResponse(format, callback) {
  if (["jpeg", "jpg", "png", "webp"].includes(format) === true) {
    // sharp lib not support jpg format
    if (format === "jpg") {
      format = "jpeg";
    }

    const color = new Color("rgba(255,255,255,0)");
    sharp(Buffer.from(color.array()), {
      raw: {
        width: 1,
        height: 1,
        channels: format === "jpeg" ? 3 : 4,
      },
    })
      .toFormat(format)
      .toBuffer((_, buffer) => {
        callback(null, {
          data: buffer,
        });
      });
  } else {
    /* pbf and other formats */
    callback(null, {
      data: Buffer.alloc(0),
    });
  }
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

    if (["jpeg", "jpg", "png", "webp"].includes(format) === true) {
      // sharp lib not support jpg format
      if (format === "jpg") {
        format = "jpeg";
      }
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
          printLog("error", `Failed to get data "${id}": ${error}`);

          return res.status(404).send("Data is not found");
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

        image.toBuffer((error, buffer) => {
          if (error) {
            printLog("error", `Failed to get rendered data "${id}": ${error}`);

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
    const rendereds = config.repo.rendereds;

    const result = Object.keys(rendereds).map((rendered) => {
      const tileJSON = rendereds[rendered].tileJSON;

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
    /* Loop over styles */
    const styles = config.repo.styles;

    await Promise.all(
      Object.keys(styles).map(async (style) => {
        try {
          /* Clone style JSON */
          const styleJSON = JSON.parse(JSON.stringify(styles[style].styleJSON));

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

          /* Fix source */
          await Promise.all(
            Object.values(styleJSON.sources).map(async (source) => {
              if (
                source.url?.startsWith("pmtiles://") === true ||
                source.url?.startsWith("mbtiles://") === true
              ) {
                const sourceID = source.url.slice(11, -1);
                const sourceData = config.repo.datas[sourceID];

                Object.assign(source, {
                  ...sourceData.tileJSON,
                  type: source.type,
                  tiles: [
                    `${sourceData.sourceType}://${sourceID}/{z}/{x}/{y}.${sourceData.tileJSON.format}`,
                  ],
                });

                if (
                  source.attribution &&
                  tileJSON.attribution.includes(source.attribution) === false
                ) {
                  if (tileJSON.attribution !== "") {
                    tileJSON.attribution += " | ";
                  }

                  tileJSON.attribution += source.attribution;
                }

                // Replace with info from local file
                delete source.url;
              }
            })
          );

          /* Create pools */
          const renderers = await Promise.all(
            Array.from(
              {
                length: config.options.maxScaleRender,
              },
              (_, scale) =>
                createPool(
                  {
                    create: async () => {
                      const renderer = new mlgl.Map({
                        mode: "tile",
                        ratio: scale + 1,
                        request: async (req, callback) => {
                          const protocol = req.url.split(":")[0];

                          if (protocol === "sprites") {
                            const parts = decodeURIComponent(req.url).split(
                              "/"
                            );
                            const spriteDir = parts[2];
                            const spriteFile = parts[3];

                            try {
                              const data = fs.readFileSync(
                                path.join(
                                  config.options.paths.sprites,
                                  spriteDir,
                                  spriteFile
                                )
                              );

                              callback(null, {
                                data: data,
                              });
                            } catch (error) {
                              callback(error, {
                                data: null,
                              });
                            }
                          } else if (protocol === "fonts") {
                            const parts = decodeURIComponent(req.url).split(
                              "/"
                            );
                            const fonts = parts[2];
                            const range = parts[3].split(".")[0];

                            try {
                              const data = await getFontsPbf(
                                config.options.paths.fonts,
                                fonts,
                                range
                              );

                              callback(null, {
                                data: data,
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
                            const parts = decodeURIComponent(req.url).split(
                              "/"
                            );
                            const sourceID = parts[2];
                            const z = Number(parts[3]);
                            const x = Number(parts[4]);
                            const y = Number(parts[5].split(".")[0]);
                            const sourceData = config.repo.datas[sourceID];

                            if (sourceData.sourceType === "mbtiles") {
                              try {
                                let { data } = await getMBTilesTile(
                                  sourceData.source,
                                  z,
                                  x,
                                  y
                                );

                                if (sourceData.tileJSON.format === "pbf") {
                                  try {
                                    data = zlib.unzipSync(data);
                                  } catch (error) {
                                    printLog(
                                      "error",
                                      `MBTiles source "${sourceID}": Failed to unzip tile ${z}/${x}/${y}.pbf`
                                    );

                                    throw error;
                                  }
                                }

                                callback(null, {
                                  data: data,
                                });
                              } catch (error) {
                                if (
                                  /does not exist/.test(error.message) === false
                                ) {
                                  printLog(
                                    "error",
                                    `MBTiles source "${sourceID}": ${error}`
                                  );
                                }

                                createEmptyResponse(
                                  sourceData.tileJSON.format,
                                  callback
                                );
                              }
                            } else {
                              const { data } = await getPMTilesTile(
                                sourceData.source,
                                z,
                                x,
                                y
                              );

                              if (data === undefined) {
                                createEmptyResponse(
                                  sourceData.tileJSON.format,
                                  callback
                                );
                              } else {
                                callback(null, {
                                  data: data,
                                });
                              }
                            }
                          } else if (
                            protocol === "http" ||
                            protocol === "https"
                          ) {
                            try {
                              const url = decodeURIComponent(req.url);

                              const { data } = await axios.get(url, {
                                responseType: "arraybuffer",
                              });

                              callback(null, {
                                data: data,
                              });
                            } catch (error) {
                              printLog("warning", error);

                              createEmptyResponse(
                                url.slice(url.lastIndexOf(".") + 1),
                                callback
                              );
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
                )
            )
          );

          config.repo.rendereds[style] = {
            tileJSON: tileJSON,
            renderers: renderers,
          };
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
