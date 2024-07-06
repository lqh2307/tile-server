"use strict";

import path from "node:path";
import express from "express";
import {
  getPMTilesInfo,
  getPMTilesTile,
  getMBTilesTile,
  getMBTilesInfo,
  downloadFile,
  openMBTiles,
  openPMTiles,
  fixTileJSON,
  printLog,
  getUrl,
} from "./utils.js";

function getDataTileHandler(config) {
  return async (req, res, next) => {
    const id = decodeURI(req.params.id);
    const item = config.repo.datas[id];
    let { format, z, x, y } = req.params;

    if (
      ["jpeg", "jpg", "pbf", "png", "webp", "avif"].includes(format) === false
    ) {
      return res.status(400).send("Data tile format is invalid");
    }

    if (!item) {
      return res.status(404).send("Data is not found");
    }

    z = Number(z);
    x = Number(x);
    y = Number(y);

    if (
      z < item.tileJSON.minzoom ||
      z > item.tileJSON.maxzoom ||
      x >= Math.pow(2, z) ||
      y >= Math.pow(2, z)
    ) {
      return res.status(400).send("Data bound is invalid");
    }

    try {
      let dataTile;

      if (item.sourceType === "mbtiles") {
        dataTile = await getMBTilesTile(item.source, z, x, y);
      } else {
        dataTile = await getPMTilesTile(item.source, z, x, y);
      }

      if (!dataTile?.data) {
        throw Error("Tile does not exist");
      }

      res.set(dataTile.headers);

      return res.status(200).send(dataTile.data);
    } catch (error) {
      printLog(
        "error",
        `Failed to get data "${id}" - Tile ${z}/${x}/${y}: ${error}`
      );

      if (/does not exist/.test(error.message) === true) {
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

    if (!item) {
      return res.status(404).send("Data is not found");
    }

    const info = {
      ...item.tileJSON,
      tiles: [`${getUrl(req)}data/${id}/{z}/{x}/{y}.${item.tileJSON.format}`],
    };

    res.header("Content-type", "application/json");

    return res.status(200).send(info);
  };
}

function getDatasListHandler(config) {
  return async (req, res, next) => {
    const datas = config.repo.datas;

    const result = Object.keys(datas).map((data) => {
      const item = datas[data];

      return {
        id: data,
        name: item.tileJSON.name || "",
        url: `${getUrl(req)}data/${data}.json`,
      };
    });

    return res.status(200).send(result);
  };
}

export const serve_data = {
  init: (config) => {
    const app = express();

    app.get("/datas.json", getDatasListHandler(config));
    app.get("/:id.json", getDataHandler(config));
    app.get(
      `/:id/:z(\\d+)/:x(\\d+)/:y(\\d+).:format([\\w]+)`,
      getDataTileHandler(config)
    );

    return app;
  },

  add: async (config) => {
    await Promise.all(
      Object.keys(config.data).map(async (data) => {
        const item = config.data[data];
        const dataInfo = {};

        try {
          let inputDataFile;

          if (item.mbtiles) {
            if (
              item.mbtiles.startsWith("https://") === true ||
              item.mbtiles.startsWith("http://") === true
            ) {
              inputDataFile = path.join(
                config.options.paths.mbtiles,
                data,
                `${data}.mbtiles`
              );

              await downloadFile(item.mbtiles, inputDataFile);

              item.mbtiles = path.join(data, `${data}.mbtiles`);
            } else {
              inputDataFile = path.join(
                config.options.paths.mbtiles,
                item.mbtiles
              );
            }

            dataInfo.sourceType = "mbtiles";
            dataInfo.source = await openMBTiles(inputDataFile);
            dataInfo.tileJSON = await getMBTilesInfo(dataInfo.source);
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
            dataInfo.tileJSON = await getPMTilesInfo(dataInfo.source);
          } else {
            throw Error(`"pmtiles" or "mbtiles" property is empty`);
          }

          /* Validate tileJSON */
          if (!dataInfo.tileJSON.name) {
            throw Error(`Data name is invalid`);
          }

          if (
            ["jpeg", "jpg", "pbf", "png", "webp", "avif"].includes(
              dataInfo.tileJSON.format
            ) === false
          ) {
            throw Error(`Data format is invalid`);
          }

          /* Add missing infos */
          fixTileJSON(dataInfo.tileJSON);

          /* Add to repo */
          config.repo.datas[data] = dataInfo;
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
