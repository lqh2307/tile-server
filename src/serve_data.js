"use strict";

import path from "node:path";
import express from "express";
import {
  validateDataInfo,
  getPMTilesInfo,
  getPMTilesTile,
  getMBTilesTile,
  getMBTilesInfo,
  downloadFile,
  openMBTiles,
  openPMTiles,
  gzipAsync,
  printLog,
  getURL,
} from "./utils.js";

function getDataTileHandler(config) {
  return async (req, res, next) => {
    const id = decodeURI(req.params.id);
    const item = config.repo.datas[id];

    /* Check data is exist? */
    if (item === undefined) {
      return res.status(404).send("Data is not found");
    }

    /* Check data tile format */
    if (req.params.format !== item.tileJSON.format) {
      return res.status(400).send("Data tile format is invalid");
    }

    const z = Number(req.params.z);
    const x = Number(req.params.x);
    const y = Number(req.params.y);

    let dataTile;

    try {
      /* Get data tile */
      if (item.sourceType === "mbtiles") {
        dataTile = await getMBTilesTile(item.source, z, x, y);
      } else {
        dataTile = await getPMTilesTile(item.source, z, x, y);
      }

      /* Gzip pbf data tile */
      if (
        dataTile.headers["Content-Type"] === "application/x-protobuf" &&
        dataTile.headers["Content-Encoding"] === undefined
      ) {
        dataTile.data = await gzipAsync(dataTile.data);

        dataTile.headers["Content-Encoding"] = "gzip";
      }

      res.set(dataTile.headers);

      return res.status(200).send(dataTile.data);
    } catch (error) {
      printLog(
        "error",
        `Failed to get data "${id}" - Tile ${z}/${x}/${y}: ${error}`
      );

      if (error.message === "Tile does not exist") {
        return res.status(204).send("Data tile is empty");
      }

      return res.status(404).send("Data tile is not found");
    }
  };
}

function getDataHandler(config) {
  return async (req, res, next) => {
    const id = decodeURI(req.params.id);
    const item = config.repo.datas[id];

    if (item === undefined) {
      return res.status(404).send("Data is not found");
    }

    const info = {
      ...item.tileJSON,
      tiles: [`${getURL(req)}data/${id}/{z}/{x}/{y}.${item.tileJSON.format}`],
    };

    res.header("Content-Type", "application/json");

    return res.status(200).send(info);
  };
}

function getDatasListHandler(config) {
  return async (req, res, next) => {
    const datas = config.repo.datas;

    const result = Object.keys(datas).map((id) => {
      return {
        id: id,
        name: datas[id].tileJSON.name,
        url: `${getURL(req)}data/${id}.json`,
      };
    });

    return res.status(200).send(result);
  };
}

export const serve_data = {
  init: (config) => {
    const app = express();

    /* Get all datas */
    app.get("/datas.json", getDatasListHandler(config));

    /* Get data */
    app.get("/:id.json", getDataHandler(config));

    /* Serve data xyz */
    app.get(
      `/:id/:z(\\d+)/:x(\\d+)/:y(\\d+).:format(jpeg|jpg|pbf|png|webp)`,
      getDataTileHandler(config)
    );

    return app;
  },

  add: async (config) => {
    await Promise.all(
      Object.keys(config.data).map(async (id) => {
        try {
          const item = config.data[id];
          const dataInfo = {
            tileJSON: {
              tilejson: "2.2.0",
            },
          };

          let inputDataFile;

          if (item.mbtiles) {
            if (
              item.mbtiles.startsWith("https://") === true ||
              item.mbtiles.startsWith("http://") === true
            ) {
              inputDataFile = path.join(
                config.options.paths.mbtiles,
                id,
                `${id}.mbtiles`
              );

              await downloadFile(item.mbtiles, inputDataFile);

              item.mbtiles = path.join(id, `${id}.mbtiles`);
            } else {
              inputDataFile = path.join(
                config.options.paths.mbtiles,
                item.mbtiles
              );
            }

            dataInfo.sourceType = "mbtiles";
            dataInfo.source = await openMBTiles(inputDataFile);
            Object.assign(
              dataInfo.tileJSON,
              await getMBTilesInfo(dataInfo.source)
            );
          } else if (item.pmtiles) {
            if (
              item.pmtiles.startsWith("https://") === true ||
              item.pmtiles.startsWith("http://") === true
            ) {
              inputDataFile = item.pmtiles;
            } else {
              inputDataFile = path.join(
                config.options.paths.pmtiles,
                item.pmtiles
              );
            }

            dataInfo.sourceType = "pmtiles";
            dataInfo.source = await openPMTiles(inputDataFile);
            Object.assign(
              dataInfo.tileJSON,
              await getPMTilesInfo(dataInfo.source)
            );
          } else {
            throw new Error(`"pmtiles" or "mbtiles" property is empty`);
          }

          /* Validate info */
          await validateDataInfo(dataInfo.tileJSON);

          /* Add to repo */
          config.repo.datas[id] = dataInfo;
        } catch (error) {
          printLog(
            "error",
            `Failed to load data "${id}": ${error}. Skipping...`
          );
        }
      })
    );
  },
};
