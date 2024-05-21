"use strict";

import fs from "node:fs";
import path from "node:path";
import zlib from "zlib";
import express from "express";
import MBTiles from "@mapbox/mbtiles";
import Pbf from "pbf";
import clone from "clone";
import { VectorTile } from "@mapbox/vector-tile";
import {
  getTileUrls,
  isValidHttpUrl,
  fixTileJSONCenter,
  printLog,
  getUrl,
} from "./utils.js";
import {
  openPMtiles,
  getPMtilesInfo,
  getPMtilesTile,
} from "./pmtiles_adapter.js";

const FORMAT_PATTERN = "(pbf|jpg|png|jpeg|webp|geojson)";

export const serve_data = {
  init: async (config, repo) => {
    const app = express();
    const lastModified = new Date().toUTCString();

    app.get(
      `/:id/:z(\\d+)/:x(\\d+)/:y(\\d+).:format(${FORMAT_PATTERN}{1})`,
      async (req, res, next) => {
        const id = decodeURI(req.params.id);
        const { format } = req.params;
        const z = Number(req.params.z);
        const x = Number(req.params.x);
        const y = Number(req.params.y);
        const item = repo.data[id];

        try {
          if (!item) {
            throw Error("Data is not found");
          }

          if (
            !(format === "geojson" && item.tileJSON.format === "pbf") &&
            format !== item.tileJSON.format
          ) {
            throw Error("Data is invalid format");
          }

          if (
            !(
              0 <= z &&
              item.tileJSON.minzoom <= z &&
              z <= item.tileJSON.maxzoom
            ) ||
            !(0 <= x && x < Math.pow(2, z)) ||
            !(0 <= y && y < Math.pow(2, z))
          ) {
            throw Error("Data is out of bounds");
          }

          if (item.sourceType === "pmtiles") {
            let { data, headers } = await getPMtilesTile(item.source, z, x, y);

            if (!data) {
              throw Error("Data is not found");
            } else {
              if (format === "pbf") {
                headers["Content-Type"] = "application/x-protobuf";
              } else if (format === "geojson") {
                headers["Content-Type"] = "application/json";

                const geojson = {
                  type: "FeatureCollection",
                  features: [],
                };

                const tile = new VectorTile(new Pbf(data));

                for (const layerName in tile.layers) {
                  const layer = tile.layers[layerName];

                  for (let i = 0; i < layer.length; i++) {
                    const featureGeoJSON = layer.feature(i).toGeoJSON(x, y, z);
                    featureGeoJSON.properties.layer = layerName;

                    geojson.features.push(featureGeoJSON);
                  }
                }

                data = JSON.stringify(geojson);
              }

              delete headers["ETag"]; // do not trust the tile ETag -- regenerate

              headers["Content-Encoding"] = "gzip";

              res.set(headers);

              data = zlib.gzipSync(data);

              return res.status(200).send(data);
            }
          } else if (item.sourceType === "mbtiles") {
            item.source.getTile(z, x, y, (error, data, headers) => {
              if (error) {
                if (/does not exist/.test(error.message)) {
                  return res.status(204).send();
                } else {
                  throw error;
                }
              } else {
                if (!data) {
                  throw Error("Data is not found");
                } else {
                  let isGzipped = false;

                  if (
                    item.tileJSON.format === "pbf" &&
                    data.slice(0, 2).indexOf(Buffer.from([0x1f, 0x8b])) === 0
                  ) {
                    isGzipped = true;
                  }

                  if (format === "pbf") {
                    headers["Content-Type"] = "application/x-protobuf";
                  } else if (format === "geojson") {
                    headers["Content-Type"] = "application/json";

                    const geojson = {
                      type: "FeatureCollection",
                      features: [],
                    };

                    if (isGzipped) {
                      data = zlib.unzipSync(data);

                      isGzipped = false;
                    }

                    const tile = new VectorTile(new Pbf(data));

                    for (const layerName in tile.layers) {
                      const layer = tile.layers[layerName];

                      for (let i = 0; i < layer.length; i++) {
                        const featureGeoJSON = layer
                          .feature(i)
                          .toGeoJSON(x, y, z);
                        featureGeoJSON.properties.layer = layerName;

                        geojson.features.push(featureGeoJSON);
                      }
                    }

                    data = JSON.stringify(geojson);
                  }

                  delete headers["ETag"]; // do not trust the tile ETag -- regenerate

                  headers["Content-Encoding"] = "gzip";

                  res.set(headers);

                  if (!isGzipped) {
                    data = zlib.gzipSync(data);
                  }

                  return res.status(200).send(data);
                }
              }
            });
          }
        } catch (error) {
          printLog("error", `Failed to get data "${id}": ${error}`);

          res.header("Content-Type", "text/plain");

          return res.status(404).send("Data is not found");
        }
      }
    );

    app.get("/datas.json", async (req, res, next) => {
      const datas = Object.keys(repo.data);

      const result = datas.map((data) => {
        const item = repo.data[data];

        return {
          id: data,
          name: item.tileJSON.name,
          url: `${getUrl(req)}data/${data}/data.json`,
        };
      });

      res.header("Content-Type", "text/plain");
      res.header("Last-Modified", lastModified);

      return res.status(200).send(result);
    });

    app.get("/:id.json", async (req, res, next) => {
      const id = decodeURI(req.params.id);
      const item = repo.data[id];

      try {
        if (!item) {
          throw Error("Data is not found");
        }

        const info = clone(item.tileJSON);

        info.tiles = getTileUrls(
          req,
          info.tiles,
          `data/${id}`,
          undefined,
          info.format
        );

        res.header("Content-type", "application/json");
        res.header("Last-Modified", lastModified);

        return res.status(200).send(info);
      } catch (error) {
        printLog("error", `Failed to get data "${id}": ${error}`);

        res.header("Content-Type", "text/plain");

        return res.status(404).send("Data is not found");
      }
    });

    return app;
  },

  remove: (repo, id) => {
    delete repo.data[id];
  },

  add: async (config, repo) => {
    const mbtilesPath = config.options.paths.mbtiles;
    const pmtilesPath = config.options.paths.pmtiles;
    const datas = Object.keys(config.data);

    await Promise.all(
      datas.map(async (data) => {
        try {
          const item = config.data[data];
          const dataInfo = {
            tileJSON: {
              tiles: config.options.domains,
              tilejson: "2.0.0",
            },
          };

          if (!item.mbtiles && !item.pmtiles) {
            throw Error(
              `"pmtiles" or "mbtiles" property for data "${data}" is empty`
            );
          } else if (item.mbtiles && item.pmtiles) {
            throw Error(
              `"mbtiles" and "pmtiles" properties cannot be used together for data "${data}"`
            );
          } else if (item.mbtiles) {
            if (isValidHttpUrl(item.mbtiles)) {
              throw Error(`MBTiles data "${data}" is invalid`);
            } else {
              const inputDataFile = path.join(mbtilesPath, item.mbtiles);

              const stat = fs.statSync(inputDataFile);
              if (stat.isFile() === false || stat.size === 0) {
                throw Error(`MBTiles data "${data}" is invalid`);
              }

              dataInfo.sourceType = "mbtiles";
              dataInfo.source = new MBTiles(
                inputDataFile + "?mode=ro",
                (err, mbtiles) => {
                  if (err) {
                    throw err;
                  }

                  mbtiles.getInfo((err, info) => {
                    if (err) {
                      throw err;
                    }

                    Object.assign(dataInfo.tileJSON, info);
                  });
                }
              );
            }
          } else if (item.pmtiles) {
            let inputDataFile = "";

            if (isValidHttpUrl(item.pmtiles)) {
              inputDataFile = item.pmtiles;
            } else {
              inputDataFile = path.join(pmtilesPath, item.pmtiles);

              const stat = fs.statSync(inputDataFile);
              if (stat.isFile() === false || stat.size === 0) {
                throw Error(`PMTiles data "${data}" is invalid`);
              }
            }

            dataInfo.sourceType = "pmtiles";
            dataInfo.source = openPMtiles(inputDataFile);

            const info = await getPMtilesInfo(source);

            Object.assign(dataInfo.tileJSON, info);
          }

          fixTileJSONCenter(dataInfo.tileJSON);

          repo.data[data] = dataInfo;
        } catch (error) {
          printLog(
            "error",
            `Failed to load data "${data}": ${error}. Skipping...`
          );
        }
      })
    );
  },
};
