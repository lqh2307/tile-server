"use strict";

import { createPool } from "generic-pool";
import fs from "node:fs";
import path from "node:path";
import zlib from "zlib";
import sharp from "sharp";
import express from "express";
import SphericalMercator from "@mapbox/sphericalmercator";
import mlgl from "@maplibre/maplibre-gl-native";
import axios from "axios";
import {
  createEmptyResponse,
  getPMTilesTile,
  getMBTilesTile,
  getFontsPbf,
  fixTileJSON,
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

function getRenderedTileHandler(config) {
  return async (req, res, next) => {
    const id = decodeURI(req.params.id);
    const item = config.repo.rendereds[id];
    const format = req.params.format;

    if (["jpeg", "jpg", "png", "webp", "avif"].includes(format) === true) {
      // sharp lib not support jpg format
      if (format === "jpg") {
        format = "jpeg";
      }
    } else {
      return res.status(400).send("Rendered data format is invalid");
    }

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
          image.png({});
        } else if (format === "jpeg") {
          image.jpeg({
            quality: config.options.formatQuality.jpeg,
          });
        } else if (format === "webp") {
          image.webp({
            quality: config.options.formatQuality.webp,
          });
        } else if (format === "avif") {
          image.avif({
            quality: config.options.formatQuality.avif,
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
      `/:id/(:tileSize(256|512)/)?:z(\\d+)/:x(\\d+)/:y(\\d+):scale(@\\d+x)?.:format([\\w]+)`,
      getRenderedTileHandler(config)
    );

    return app;
  },

  add: async (config) => {
    await Promise.all(
      Object.keys(config.repo.styles).map(async (style) => {
        const item = config.repo.styles[style];
        const rendered = {
          tileJSON: {
            name: item.styleJSON.name || "",
            attribution: "",
            format: "png",
          },
        };

        /* Clone style JSON & Fix sources */
        const sources = {};
        await Promise.all(
          Object.keys(item.styleJSON.sources).map(async (source) => {
            const oldSource = item.styleJSON.sources[source];
            const sourceUrl = oldSource.url;

            if (
              sourceUrl?.startsWith("pmtiles://") === true ||
              sourceUrl?.startsWith("mbtiles://") === true
            ) {
              const sourceID = sourceUrl.slice(11, -1);
              const sourceData = config.repo.datas[sourceID];

              // Fix source
              sources[source] = {
                ...oldSource,
                ...sourceData.tileJSON,
                type: oldSource.type,
                tiles: [
                  `${sourceData.sourceType}://${sourceID}/{z}/{x}/{y}.${sourceData.tileJSON.format}`,
                ],
              };

              // Replace with local tiles
              delete sources[source].url;
            } else {
              sources[source] = oldSource;
            }

            // Add atribution
            if (
              sources[source].attribution &&
              rendered.tileJSON.attribution.includes(
                sources[source].attribution
              ) === false
            ) {
              if (rendered.tileJSON.attribution !== "") {
                rendered.tileJSON.attribution += " | ";
              }

              rendered.tileJSON.attribution += sources[source].attribution;
            }
          })
        );

        const styleJSON = {
          ...item.styleJSON,
          sources: sources,
        };

        /* Add missing infos */
        if (styleJSON.center?.length === 2 && styleJSON.zoom) {
          rendered.tileJSON.center = [
            styleJSON.center[0],
            styleJSON.center[1],
            Math.round(styleJSON.zoom),
          ];
        }

        fixTileJSON(rendered.tileJSON);

        /* Create pools */
        rendered.renderers = await Promise.all(
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
                          const parts = decodeURIComponent(req.url).split("/");
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
                          const parts = decodeURIComponent(req.url).split("/");
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
                          const parts = decodeURIComponent(req.url).split("/");
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

                              if (!data) {
                                createEmptyResponse(
                                  sourceData.tileJSON.format,
                                  callback
                                );
                              } else {
                                if (
                                  sourceData.tileJSON.format === "pbf" &&
                                  data[0] === 0x1f &&
                                  data[1] === 0x8b
                                ) {
                                  try {
                                    data = zlib.unzipSync(data);
                                  } catch (error) {
                                    throw error;
                                  }
                                }

                                callback(null, {
                                  data: data,
                                });
                              }
                            } catch (error) {
                              printLog(
                                "warning",
                                `Failed to get MBTiles source "${sourceID}" - Tile ${z}/${x}/${y}.${sourceData.tileJSON.format}: ${error}. Serving empty...`
                              );

                              createEmptyResponse(
                                sourceData.tileJSON.format,
                                callback
                              );
                            }
                          } else {
                            try {
                              const { data } = await getPMTilesTile(
                                sourceData.source,
                                z,
                                x,
                                y
                              );

                              if (!data) {
                                createEmptyResponse(
                                  sourceData.tileJSON.format,
                                  callback
                                );
                              } else {
                                if (
                                  sourceData.tileJSON.format === "pbf" &&
                                  data[0] === 0x1f &&
                                  data[1] === 0x8b
                                ) {
                                  try {
                                    data = zlib.unzipSync(data);
                                  } catch (error) {
                                    throw error;
                                  }
                                }

                                callback(null, {
                                  data: data,
                                });
                              }
                            } catch (error) {
                              printLog(
                                "warning",
                                `Failed to get PMTiles source "${sourceID}" - Tile ${z}/${x}/${y}.${sourceData.tileJSON.format}: ${error}. Serving empty...`
                              );

                              createEmptyResponse(
                                sourceData.tileJSON.format,
                                callback
                              );
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

        /* Add to repo */
        config.repo.rendereds[style] = rendered;
      })
    );
  },
};
