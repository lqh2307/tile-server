"use strict";

import fs from "node:fs/promises";
import axios from "axios";
import sharp from "sharp";
import path from "node:path";
import express from "express";
import mlgl from "@maplibre/maplibre-gl-native";
import { createPool } from "generic-pool";
import {
  responseEmptyTile,
  getPMTilesTile,
  getMBTilesTile,
  getFontsPBF,
  unzipAsync,
  printLog,
  mercator,
  getURL,
} from "./utils.js";

function getRenderedTileHandler(config) {
  return async (req, res, next) => {
    const id = decodeURI(req.params.id);
    const item = config.repo.rendereds[id];

    /* Check rendered is exist? */
    if (item === undefined) {
      return res.status(404).send("Rendered is not found");
    }

    /* Check rendered tile scale */
    const scale = Number(req.params.scale?.slice(1, -1)) || 1;

    if (scale > config.options.maxScaleRender) {
      return res.status(400).send("Rendered tile scale is invalid");
    }

    const z = Number(req.params.z);
    const x = Number(req.params.x);
    const y = Number(req.params.y);
    const tileSize = Number(req.params.tileSize) || 256;
    const tileCenter = mercator.ll(
      [
        ((x + 0.5) / (1 << z)) * (256 << z),
        ((y + 0.5) / (1 << z)) * (256 << z),
      ],
      z
    );

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
            `Failed to get rendered "${id}" - Tile ${z}/${x}/${y}: ${error}`
          );

          return res.status(404).send("Rendered tile is not found");
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

        image
          .png()
          .toBuffer()
          .then((data) => {
            res.header("Content-Type", `image/png`);

            return res.status(200).send(data);
          })
          .catch((error) => {
            printLog(
              "error",
              `Failed to get rendered "${id}" - Tile ${z}/${x}/${y}: ${error}`
            );

            return res.status(404).send("Rendered tile is not found");
          });
      });
    } catch (error) {
      printLog(
        "error",
        `Failed to get rendered "${id}" - Tile ${z}/${x}/${y}: ${error}`
      );

      return res.status(404).send("Rendered tile is not found");
    }
  };
}

function getRenderedHandler(config) {
  return async (req, res, next) => {
    const id = decodeURI(req.params.id);
    const item = config.repo.rendereds[id];

    if (item === undefined) {
      return res.status(404).send("Rendered is not found");
    }

    const info = {
      ...item.tileJSON,
      tiles: [
        `${getURL(req)}styles/${id}/${
          req.params.tileSize || 256
        }/{z}/{x}/{y}.png`,
      ],
    };

    res.header("Content-Type", "application/json");

    return res.status(200).send(info);
  };
}

function getRenderedsListHandler(config) {
  return async (req, res, next) => {
    const rendereds = config.repo.rendereds;

    const result = Object.keys(rendereds).map((id) => {
      return {
        id: id,
        name: rendereds[id].tileJSON.name,
        url: [
          `${getURL(req)}styles/256/${id}.json`,
          `${getURL(req)}styles/512/${id}.json`,
        ],
      };
    });

    return res.status(200).send(result);
  };
}

export const serve_rendered = {
  init: (config) => {
    const app = express();

    if (config.options.serveRendered === true) {
      /* Get all style rendereds */
      app.get("/rendereds.json", getRenderedsListHandler(config));

      /* Get style rendered */
      app.get("/(:tileSize(256|512)/)?:id.json", getRenderedHandler(config));

      /* Serve style xyz */
      app.get(
        `/:id/(:tileSize(256|512)/)?:z(\\d+)/:x(\\d+)/:y(\\d+):scale(@\\d+x)?.png`,
        getRenderedTileHandler(config)
      );
    }

    return app;
  },

  add: async (config) => {
    if (config.options.serveRendered === true) {
      mlgl.on("message", (error) => {
        if (error.severity === "ERROR") {
          printLog("error", `mlgl: ${JSON.stringify(error)}`);
        } else if (error.severity === "WARNING") {
          printLog("warning", `mlgl: ${JSON.stringify(error)}`);
        }
      });
    }

    await Promise.all(
      Object.keys(config.repo.styles).map(async (id) => {
        try {
          const item = config.repo.styles[id];
          const rendered = {
            tileJSON: {
              tilejson: "2.2.0",
              name: item.styleJSON.name || "Unknown",
              format: "png",
              bounds: [-180, -85.051128779807, 180, 85.051128779807],
              attribution: "<b>Viettel HighTech</b>",
              type: "overlay",
              minzoom: 0,
              maxzoom: 22,
            },
          };

          /* Fix center */
          if (item.styleJSON.center?.length >= 2 && item.styleJSON.zoom) {
            rendered.tileJSON.center = [
              item.styleJSON.center[0],
              item.styleJSON.center[1],
              Math.floor(item.styleJSON.zoom),
            ];
          }

          /* Fix source urls & Add attribution & Create pools */
          if (config.options.serveRendered === true) {
            /* Clone style JSON */
            const styleJSON = {
              ...item.styleJSON,
              sources: {},
            };

            await Promise.all(
              // Fix source urls
              Object.keys(item.styleJSON.sources).map(async (id) => {
                const oldSource = item.styleJSON.sources[id];
                const sourceURL = oldSource.url;
                const sourceURLs = oldSource.urls;
                const sourceTiles = oldSource.tiles;

                styleJSON.sources[id] = {
                  ...oldSource,
                };

                if (sourceTiles !== undefined) {
                  const tiles = sourceTiles.map((tile) => {
                    if (
                      tile.startsWith("pmtiles://") === true ||
                      tile.startsWith("mbtiles://") === true
                    ) {
                      const sourceID = tile.slice(10);
                      const sourceData = config.repo.datas[sourceID];

                      tile = `${sourceData.sourceType}://${sourceID}/{z}/{x}/{y}.${sourceData.tileJSON.format}`;
                    }

                    return tile;
                  });

                  styleJSON.sources[id].tiles = [...new Set(tiles)];
                }

                if (sourceURLs !== undefined) {
                  const otherUrls = [];

                  sourceURLs.forEach((url) => {
                    if (
                      url.startsWith("pmtiles://") === true ||
                      url.startsWith("mbtiles://") === true
                    ) {
                      const sourceID = url.slice(10);
                      const sourceData = config.repo.datas[sourceID];
                      const tile = `${sourceData.sourceType}://${sourceID}/{z}/{x}/{y}.${sourceData.tileJSON.format}`;

                      if (styleJSON.sources[id].tiles !== undefined) {
                        if (
                          styleJSON.sources[id].tiles.includes(tile) === false
                        ) {
                          styleJSON.sources[id].tiles.push(tile);
                        }
                      } else {
                        styleJSON.sources[id].tiles = [tile];
                      }
                    } else {
                      if (otherUrls.includes(url) === false) {
                        otherUrls.push(url);
                      }
                    }
                  });

                  if (otherUrls.length === 0) {
                    delete styleJSON.sources[id].urls;
                  } else {
                    styleJSON.sources[id].urls = otherUrls;
                  }
                }

                if (sourceURL !== undefined) {
                  if (
                    sourceURL.startsWith("pmtiles://") === true ||
                    sourceURL.startsWith("mbtiles://") === true
                  ) {
                    const sourceID = sourceURL.slice(10);
                    const sourceData = config.repo.datas[sourceID];
                    const tile = `${sourceData.sourceType}://${sourceID}/{z}/{x}/{y}.${sourceData.tileJSON.format}`;

                    if (styleJSON.sources[id].tiles !== undefined) {
                      if (
                        styleJSON.sources[id].tiles.includes(tile) === false
                      ) {
                        styleJSON.sources[id].tiles.push(tile);
                      }
                    } else {
                      styleJSON.sources[id].tiles = [tile];
                    }

                    delete styleJSON.sources[id].url;
                  }
                }

                if (
                  styleJSON.sources[id].url === undefined &&
                  styleJSON.sources[id].urls === undefined &&
                  styleJSON.sources[id].tiles !== undefined
                ) {
                  if (styleJSON.sources[id].tiles.length === 1) {
                    const tileURL = styleJSON.sources[id].tiles[0];
                    if (
                      tileURL.startsWith("pmtiles://") === true ||
                      tileURL.startsWith("mbtiles://") === true
                    ) {
                      const sourceID = tileURL.split("/")[2];
                      const sourceData = config.repo.datas[sourceID];

                      styleJSON.sources[id] = {
                        ...sourceData.tileJSON,
                        ...styleJSON.sources[id],
                        tiles: [tileURL],
                      };
                    }
                  }
                }

                // Add atribution
                if (
                  oldSource.attribution &&
                  rendered.tileJSON.attribution.includes(
                    oldSource.attribution
                  ) === false
                ) {
                  rendered.tileJSON.attribution += ` | ${oldSource.attribution}`;
                }
              })
            );

            // Create pools
            rendered.renderers = Array.from(
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
                              const data = await fs.readFile(
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
                              let data = await getFontsPBF(
                                config,
                                fonts,
                                range
                              );

                              /* Unzip pbf font */
                              if (data[0] === 0x1f && data[1] === 0x8b) {
                                data = await unzipAsync(data);
                              }

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

                            let dataTile;

                            try {
                              /* Get rendered tile */
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

                              /* Unzip pbf rendered tile */
                              if (
                                dataTile.headers["Content-Type"] ===
                                  "application/x-protobuf" &&
                                dataTile.headers["Content-Encoding"] === "gzip"
                              ) {
                                dataTile.data = await unzipAsync(dataTile.data);
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
            );
          }

          /* Add to repo */
          config.repo.rendereds[id] = rendered;
        } catch (error) {
          printLog(
            "error",
            `Failed to load rendered "${id}": ${error}. Skipping...`
          );
        }
      })
    );
  },
};
