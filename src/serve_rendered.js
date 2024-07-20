"use strict";

import fs from "node:fs";
import path from "node:path";
import zlib from "zlib";
import mlgl from "@maplibre/maplibre-gl-native";
import axios from "axios";
import sharp from "sharp";
import express from "express";
import { createPool } from "generic-pool";
import {
  responseEmptyTile,
  getPMTilesTile,
  getMBTilesTile,
  getFontsPBF,
  fixTileJSON,
  printLog,
  getURL,
} from "./utils.js";

mlgl.on("message", (error) => {
  if (error.severity === "ERROR") {
    printLog("error", `mlgl: ${JSON.stringify(error)}`);
  } else if (error.severity === "WARNING") {
    printLog("warning", `mlgl: ${JSON.stringify(error)}`);
  }
});

function getRenderedTileHandler(config) {
  return async (req, res, next) => {
    const id = decodeURI(req.params.id);
    const item = config.repo.rendereds[id];
    let format = req.params.format;

    /* Check rendered data tile format */
    if (["jpeg", "jpg", "png", "webp", "avif"].includes(format) === true) {
      // sharp lib not support jpg format
      if (format === "jpg") {
        format = "jpeg";
      }
    } else {
      return res.status(400).send("Rendered data tile format is invalid");
    }

    /* Check rendered data is exist? */
    if (!item) {
      return res.status(404).send("Rendered data is not found");
    }

    /* Check rendered data tile bounds */
    z = Number(req.params.z);
    x = Number(req.params.x);
    y = Number(req.params.y);

    /* Check rendered data tile scale */
    const scale = Number(req.params.scale?.slice(1, -1)) || 1;

    if (scale > config.options.maxScaleRender) {
      return res.status(400).send("Rendered data tile scale is invalid");
    }

    const tileSize = Number(req.params.tileSize) || 256;

    // For 512px tiles, use the actual maplibre-native zoom. For 256px tiles, use zoom - 1
    const params = {
      zoom: tileSize === 512 ? z : Math.max(0, z - 1),
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
          printLog(
            "error",
            `Failed to get rendered data "${id}" - Tile ${z}/${x}/${y}: ${error}`
          );

          return res.status(404).send("Rendered data tile is not found");
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
            lossless: true,
          });
        } else if (format === "avif") {
          image.avif({
            quality: config.options.formatQuality.avif,
            lossless: true,
          });
        }

        image.toBuffer((error, buffer) => {
          if (error) {
            printLog(
              "error",
              `Failed to get rendered data "${id}" - Tile ${z}/${x}/${y}: ${error}`
            );

            return res.status(404).send("Rendered data tile is not found");
          }

          res.header("Content-Type", `image/${format}`);

          return res.status(200).send(buffer);
        });
      });
    } catch (error) {
      printLog(
        "error",
        `Failed to get rendered data "${id}" - Tile ${z}/${x}/${y}: ${error}`
      );

      return res.status(404).send("Rendered data tile is not found");
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
        `${getURL(req)}styles/${id}/${req.params.tileSize || 256}/{z}/{x}/{y}.${
          item.tileJSON.format
        }`,
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
          `${getURL(req)}styles/256/${rendered}.json`,
          `${getURL(req)}styles/512/${rendered}.json`,
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

        /* Clone style JSON */
        const styleJSON = {
          ...item.styleJSON,
          sources: {},
        };

        /* Fix source urls & Add attribution */
        await Promise.all(
          // Fix source urls
          Object.keys(item.styleJSON.sources).map(async (name) => {
            const oldSource = item.styleJSON.sources[name];

            styleJSON.sources[name] = {
              ...oldSource,
            };

            if (oldSource.url !== undefined) {
              if (
                oldSource.url.startsWith("pmtiles://") === true ||
                oldSource.url.startsWith("mbtiles://") === true
              ) {
                const sourceID = oldSource.url.slice(10);
                const sourceData = config.repo.datas[sourceID];
                const tile = `${sourceData.sourceType}://${sourceID}/{z}/{x}/{y}.${sourceData.tileJSON.format}`;

                if (styleJSON.sources[name].tiles != undefined) {
                  styleJSON.sources[name].tiles.push(tile);
                } else {
                  styleJSON.sources[name] = {
                    ...sourceData.tileJSON,
                    type: oldSource.type,
                    tiles: [tile],
                  };
                }

                delete styleJSON.sources[name].url;
              }
            } else if (oldSource.urls !== undefined) {
              oldSource.urls.forEach((sourceURL) => {
                if (
                  sourceURL.startsWith("pmtiles://") === true ||
                  sourceURL.startsWith("mbtiles://") === true
                ) {
                  const sourceID = sourceURL.slice(10);
                  const sourceData = config.repo.datas[sourceID];
                  const tile = `${sourceData.sourceType}://${sourceID}/{z}/{x}/{y}.${sourceData.tileJSON.format}`;

                  if (styleJSON.sources[name].tiles != undefined) {
                    styleJSON.sources[name].tiles.push(tile);
                  } else {
                    styleJSON.sources[name] = {
                      ...sourceData.tileJSON,
                      type: oldSource.type,
                      tiles: [tile],
                    };
                  }
                }
              });

              delete styleJSON.sources[name].urls;
            }

            // Add atribution
            if (
              oldSource.attribution &&
              rendered.tileJSON.attribution.includes(oldSource.attribution) ===
                false
            ) {
              if (rendered.tileJSON.attribution !== "") {
                rendered.tileJSON.attribution += " | ";
              }

              rendered.tileJSON.attribution += oldSource.attribution;
            }
          })
        );

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
                        const url = decodeURIComponent(req.url);
                        const parts = url.split("/");
                        const protocol = parts[0];

                        if (protocol === "sprites:") {
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
                        } else if (protocol === "fonts:") {
                          const fonts = parts[2];
                          const range = parts[3].split(".")[0];

                          try {
                            const data = await getFontsPBF(
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
                          protocol === "mbtiles:" ||
                          protocol === "pmtiles:"
                        ) {
                          const sourceID = parts[2];
                          const z = Number(parts[3]);
                          const x = Number(parts[4]);
                          const y = Number(parts[5].split(".")[0]);
                          const sourceData = config.repo.datas[sourceID];

                          try {
                            let dataTile;

                            /* Get rendered data tile */
                            if (sourceData.sourceType === "mbtiles") {
                              dataTile = await getMBTilesTile(
                                sourceData.source,
                                z,
                                x,
                                y
                              );
                            } else {
                              dataTile = await getPMTilesTile(
                                sourceData.source,
                                z,
                                x,
                                y
                              );
                            }

                            /* Check rendered data tile is exist? */
                            if (!dataTile?.data) {
                              throw Error("Tile does not exist");
                            }

                            /* Unzip pbf rendered data tile format */
                            if (
                              sourceData.tileJSON.format === "pbf" &&
                              dataTile.data[0] === 0x1f &&
                              dataTile.data[1] === 0x8b
                            ) {
                              dataTile.data = zlib.unzipSync(dataTile.data);
                            }

                            callback(null, {
                              data: dataTile.data,
                            });
                          } catch (error) {
                            printLog(
                              "warning",
                              `Failed to get data "${sourceID}" - Tile ${z}/${x}/${y}: ${error}. Serving empty tile...`
                            );

                            responseEmptyTile(
                              sourceData.tileJSON.format,
                              callback
                            );
                          }
                        } else if (
                          protocol === "http:" ||
                          protocol === "https:"
                        ) {
                          try {
                            const { data } = await axios.get(url, {
                              responseType: "arraybuffer",
                            });

                            callback(null, {
                              data: data,
                            });
                          } catch (error) {
                            printLog("warning", error);

                            responseEmptyTile(
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
