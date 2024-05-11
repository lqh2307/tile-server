"use strict";

import fs from "node:fs";
import path from "node:path";
import zlib from "zlib";
import express from "express";
import MBTiles from "@mapbox/mbtiles";
import Pbf from "pbf";
import clone from "clone";
import { VectorTile } from "@mapbox/vector-tile";
import { getTileUrls, isValidHttpUrl, fixTileJSONCenter } from "./utils.js";
import {
  openPMtiles,
  getPMtilesInfo,
  getPMtilesTile,
} from "./pmtiles_adapter.js";

export const serve_data = {
  init: async (config, repo) => {
    const app = express().disable("x-powered-by");
    const lastModified = new Date().toUTCString();

    app.get(
      "/:id/:z(\\d+)/:x(\\d+)/:y(\\d+).:format([\\w.]+)",
      async (req, res, next) => {
        const id = decodeURI(req.params.id);
        let { z = 0, x = 0, y = 0, format = "" } = req.params;
        const item = repo.data[id];

        if (!item) {
          res.header("Content-Type", "text/plain");

          return res.status(404).send("Data is not found");
        }

        if (format === config.options.pbfAlias) {
          format = "pbf";
        }

        const tileJSONFormat = item.tileJSON.format;
        if (
          format !== tileJSONFormat &&
          !(format === "geojson" && tileJSONFormat === "pbf")
        ) {
          res.header("Content-Type", "text/plain");

          return res.status(400).send("Invalid data format");
        }

        if (
          z < item.tileJSON.minzoom ||
          0 ||
          x < 0 ||
          y < 0 ||
          z > item.tileJSON.maxzoom ||
          x >= Math.pow(2, z) ||
          y >= Math.pow(2, z)
        ) {
          res.header("Content-Type", "text/plain");

          return res.status(400).send("Out of bounds");
        }

        if (item.sourceType === "pmtiles") {
          let tileinfo = await getPMtilesTile(item.source, z, x, y);
          if (tileinfo === undefined || tileinfo.data === undefined) {
            res.header("Content-Type", "text/plain");

            return res.status(404).send("Data is not found");
          } else {
            let { data, headers } = tileinfo.data;

            if (format === "pbf") {
              headers["Content-Type"] = "application/x-protobuf";
            } else if (format === "geojson") {
              headers["Content-Type"] = "application/json";
              const tile = new VectorTile(new Pbf(data));
              const geojson = {
                type: "FeatureCollection",
                features: [],
              };

              for (const layerName in tile.layers) {
                const layer = tile.layers[layerName];
                for (let i = 0; i < layer.length; i++) {
                  const feature = layer.feature(i);
                  const featureGeoJSON = feature.toGeoJSON(x, y, z);
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
          item.source.getTile(z, x, y, (err, data, headers) => {
            let isGzipped;
            if (err) {
              if (/does not exist/.test(err.message)) {
                return res.status(204).send();
              } else {
                res.header("Content-Type", "text/plain");

                return res.status(500).send(err.message);
              }
            } else {
              if (data === null) {
                res.header("Content-Type", "text/plain");

                return res.status(404).send("Data is not found");
              } else {
                if (tileJSONFormat === "pbf") {
                  isGzipped =
                    data.slice(0, 2).indexOf(Buffer.from([0x1f, 0x8b])) === 0;
                }
                if (format === "pbf") {
                  headers["Content-Type"] = "application/x-protobuf";
                } else if (format === "geojson") {
                  headers["Content-Type"] = "application/json";

                  if (isGzipped) {
                    data = zlib.unzipSync(data);
                    isGzipped = false;
                  }

                  const tile = new VectorTile(new Pbf(data));
                  const geojson = {
                    type: "FeatureCollection",
                    features: [],
                  };
                  for (const layerName in tile.layers) {
                    const layer = tile.layers[layerName];
                    for (let i = 0; i < layer.length; i++) {
                      const feature = layer.feature(i);
                      const featureGeoJSON = feature.toGeoJSON(x, y, z);
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
      }
    );

    app.get("/:id.json", async (req, res, next) => {
      const id = decodeURI(req.params.id);
      const item = repo.data[id];

      if (!item) {
        res.header("Content-Type", "text/plain");

        return res.status(404).send("Data is not found");
      }

      const info = clone(item.tileJSON || {});

      info.tiles = getTileUrls(
        req,
        info.tiles,
        `data/${req.params.id}`,
        undefined,
        info.format,
        {
          pbf: config.options.pbfAlias,
        }
      );

      res.header("Content-type", "application/json");
      res.header("Last-Modified", lastModified);

      return res.status(200).send(info);
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
      datas.map(async (id) => {
        try {
          const item = config.data[id];

          if (!item.mbtiles && !item.pmtiles) {
            throw Error(
              `"pmtiles" or "mbtiles" property for data "${id}" is empty`
            );
          } else if (item.mbtiles && item.pmtiles) {
            throw Error(
              `"mbtiles" and "pmtiles" properties cannot be used together for data "${id}"`
            );
          } else if (item.mbtiles) {
            let inputDataFile = "";

            if (isValidHttpUrl(item.mbtiles)) {
              throw Error(`MBTiles data "${id}" is invalid`);
            } else {
              inputDataFile = path.join(mbtilesPath, item.mbtiles);

              const fileStats = fs.statSync(inputDataFile);
              if (!fileStats.isFile() || fileStats.size === 0) {
                throw Error(`MBTiles data "${id}" is invalid`);
              }
            }

            const source = new MBTiles(
              inputDataFile + "?mode=ro",
              (err, mbtiles) => {
                if (err) {
                  throw err;
                }

                mbtiles.getInfo((err, info) => {
                  if (err) {
                    throw err;
                  }

                  const tileJSON = {
                    tiles: config.options.domains,
                    name: id,
                    tilejson: "2.0.0",
                  };

                  Object.assign(tileJSON, info);

                  fixTileJSONCenter(tileJSON);

                  repo.data[id] = {
                    tileJSON,
                    source,
                    sourceType: "mbtiles",
                  };
                });
              }
            );
          } else if (item.pmtiles) {
            let inputDataFile = "";

            if (isValidHttpUrl(item.pmtiles)) {
              inputDataFile = item.pmtiles;
            } else {
              inputDataFile = path.join(pmtilesPath, item.pmtiles);

              const fileStats = fs.statSync(inputDataFile);
              if (!fileStats.isFile() || fileStats.size === 0) {
                throw Error(`PMTiles data "${id}" is invalid`);
              }
            }

            const source = openPMtiles(inputDataFile);

            const info = await getPMtilesInfo(source);

            const tileJSON = {
              tiles: config.options.domains,
              name: id,
              tilejson: "2.0.0",
            };

            Object.assign(tileJSON, info);

            fixTileJSONCenter(tileJSON);

            repo.data[id] = {
              tileJSON,
              source,
              sourceType: "pmtiles",
            };
          }
        } catch (error) {
          throw error;
        }
      })
    );

    return true;
  },
};
