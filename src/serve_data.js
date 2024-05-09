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

    app.get(
      "/:id/:z(\\d+)/:x(\\d+)/:y(\\d+).:format([\\w.]+)",
      async (req, res, next) => {
        const id = decodeURI(req.params.id);
        const { z = 0, x = 0, y = 0 } = req.params;
        const item = repo[id];

        if (!item) {
          return res.status(404).send("Not found");
        }

        let format = req.params.format;
        if (format === config.options.pbfAlias) {
          format = "pbf";
        }

        const tileJSONFormat = item.tileJSON.format;
        if (
          format !== tileJSONFormat &&
          !(format === "geojson" && tileJSONFormat === "pbf")
        ) {
          return res.status(400).send("Invalid format");
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
          return res.status(400).send("Out of bounds");
        }

        if (item.sourceType === "pmtiles") {
          let tileinfo = await getPMtilesTile(item.source, z, x, y);
          if (tileinfo == undefined || tileinfo.data == undefined) {
            return res.status(404).send("Not found");
          } else {
            let data = tileinfo.data;
            let headers = tileinfo.header;

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
              if (data == null) {
                return res.status(404).send("Not found");
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
      const item = repo[id];

      if (!item) {
        return res.status(404).send("Not found");
      }

      const tileSize = undefined;
      const info = clone(item.tileJSON || {});
      info.tiles = getTileUrls(
        req,
        info.tiles,
        `data/${req.params.id}`,
        tileSize,
        info.format,
        {
          pbf: config.options.pbfAlias,
        }
      );

      return res.status(200).send(info);
    });

    return app;
  },

  add: async (config, repo, params, id) => {
    let inputFile = "";
    let inputType = "";

    if (params.pmtiles) {
      inputType = "pmtiles";
      if (isValidHttpUrl(params.pmtiles)) {
        inputFile = params.pmtiles;
      } else {
        const pmtilePath = config.options.paths.pmtiles;

        inputFile = path.join(pmtilePath, params.pmtiles);
      }
    } else if (params.mbtiles) {
      inputType = "mbtiles";
      if (isValidHttpUrl(params.mbtiles)) {
        printLog("error", `${params.mbtiles} is invalid data file`);

        process.exit(1);
      } else {
        const mbtilesPath = config.options.paths.mbtiles;

        inputFile = path.join(mbtilesPath, params.mbtiles);
      }
    }

    let tileJSON = {
      tiles: params.domains || config.options.domains,
    };

    if (!isValidHttpUrl(inputFile)) {
      const inputFileStats = fs.statSync(inputFile);
      if (!inputFileStats.isFile() || inputFileStats.size === 0) {
        throw Error(`Invalid input file: "${inputFile}"`);
      }
    }

    let source;
    let sourceType;
    if (inputType === "pmtiles") {
      source = openPMtiles(inputFile);
      sourceType = "pmtiles";

      tileJSON["name"] = id;
      tileJSON["format"] = "pbf";

      Object.assign(tileJSON, await getPMtilesInfo(source));

      tileJSON["tilejson"] = "2.0.0";

      delete tileJSON["filesize"];
      delete tileJSON["mtime"];
      delete tileJSON["scheme"];

      Object.assign(tileJSON, params.tilejson);

      fixTileJSONCenter(tileJSON);
    } else if (inputType === "mbtiles") {
      sourceType = "mbtiles";
      const sourceInfoPromise = new Promise((resolve, reject) => {
        source = new MBTiles(inputFile + "?mode=ro", (err) => {
          if (err) {
            reject(err);

            return;
          }

          source.getInfo((err, info) => {
            if (err) {
              reject(err);

              return;
            }

            tileJSON["name"] = id;
            tileJSON["format"] = "pbf";

            Object.assign(tileJSON, info);

            tileJSON["tilejson"] = "2.0.0";
            delete tileJSON["filesize"];
            delete tileJSON["mtime"];
            delete tileJSON["scheme"];

            Object.assign(tileJSON, params.tilejson);

            fixTileJSONCenter(tileJSON);

            resolve();
          });
        });
      });

      await sourceInfoPromise;
    }

    repo[id] = {
      tileJSON,
      source,
      sourceType,
    };
  },
};
