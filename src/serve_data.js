"use strict";

import path from "node:path";
import zlib from "zlib";
import express from "express";
import {
  fixTileJSONCenter,
  isValidHttpUrl,
  getPMtilesInfo,
  getPMtilesTile,
  getMBTilesTile,
  getMBTilesInfo,
  downloadFile,
  openMBTiles,
  openPMtiles,
  printLog,
  getUrl,
} from "./utils.js";

function getDataTileHandler(config) {
  return async (req, res, next) => {
    const id = decodeURI(req.params.id);
    const item = config.repo.datas[id];

    if (!item) {
      return res.status(404).send("Data is not found");
    }

    const z = Number(req.params.z);
    const x = Number(req.params.x);
    const y = Number(req.params.y);

    if (
      z < item.tileJSON.minzoom ||
      z > item.tileJSON.maxzoom ||
      x >= Math.pow(2, z) ||
      y >= Math.pow(2, z)
    ) {
      return res.status(400).send("Data bound is invalid");
    }

    try {
      if (item.sourceType === "mbtiles") {
        try {
          let { data, headers = {} } = await getMBTilesTile(
            item.source,
            z,
            x,
            y
          );

          let isGzipped = false;

          if (req.params.format === "pbf") {
            if (data.slice(0, 2).indexOf(Buffer.from([0x1f, 0x8b])) === 0) {
              isGzipped = true;
            }

            headers["Content-Type"] = "application/x-protobuf";
          }

          if (isGzipped === false) {
            data = zlib.gzipSync(data);
          }

          headers["Content-Encoding"] = "gzip";

          res.set(headers);

          return res.status(200).send(data);
        } catch (error) {
          if (/does not exist/.test(error.message)) {
            return res.status(204).send("Data is empty");
          } else {
            throw error;
          }
        }
      } else {
        let { data, headers = {} } = await getPMtilesTile(item.source, z, x, y);

        if (data === undefined) {
          return res.status(204).send("Data is empty");
        }

        if (req.params.format === "pbf") {
          headers["Content-Type"] = "application/x-protobuf";
        }

        data = zlib.gzipSync(data);

        headers["Content-Encoding"] = "gzip";

        res.set(headers);

        return res.status(200).send(data);
      }
    } catch (error) {
      printLog("error", `Failed to get data "${id}": ${error}`);

      return res.status(404).send("Data is not found");
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

    try {
      const info = {
        ...item.tileJSON,
        tiles: [`${getUrl(req)}data/${id}/{z}/{x}/{y}.${item.tileJSON.format}`],
      };

      res.header("Content-type", "application/json");

      return res.status(200).send(info);
    } catch (error) {
      printLog("error", `Failed to get data "${id}": ${error}`);

      return res.status(404).send("Data is not found");
    }
  };
}

function getDatasListHandler(config) {
  return async (req, res, next) => {
    const datas = Object.keys(config.repo.datas);

    const result = datas.map((data) => {
      const item = config.repo.datas[data];

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
      `/:id/:z(\\d+)/:x(\\d+)/:y(\\d+).:format(pbf|jpg|png|jpeg|webp)`,
      getDataTileHandler(config)
    );

    return app;
  },

  add: async (config) => {
    const datas = Object.keys(config.data);

    await Promise.all(
      datas.map(async (data) => {
        const item = config.data[data];
        const dataInfo = {
          tileJSON: {
            tilejson: "2.2.0",
          },
        };

        try {
          if (item.mbtiles) {
            let inputDataFile = "";

            if (isValidHttpUrl(item.mbtiles) === true) {
              inputDataFile = path.join(
                config.options.paths.mbtiles,
                data,
                `${data}.mbtiles`
              );

              await downloadFile(item.mbtiles, inputDataFile);

              item.mbtiles = path.join(data, `${data}.mbtiles`);
            }

            inputDataFile = path.join(
              config.options.paths.mbtiles,
              item.mbtiles
            );

            dataInfo.sourceType = "mbtiles";
            dataInfo.source = await openMBTiles(inputDataFile);

            const info = await getMBTilesInfo(dataInfo.source);

            Object.assign(dataInfo.tileJSON, info);
          } else if (item.pmtiles) {
            let inputDataFile = "";

            if (isValidHttpUrl(item.pmtiles) === true) {
              inputDataFile = item.pmtiles;
            } else {
              inputDataFile = path.join(
                config.options.paths.pmtiles,
                item.pmtiles
              );
            }

            dataInfo.sourceType = "pmtiles";
            dataInfo.source = openPMtiles(inputDataFile);

            const info = await getPMtilesInfo(dataInfo.source);

            Object.assign(dataInfo.tileJSON, info);
          } else {
            throw Error(`"pmtiles" or "mbtiles" property is empty`);
          }

          if (
            ["jpeg", "jpg", "pbf", "png", "webp"].includes(
              dataInfo.tileJSON.format
            ) === false
          ) {
            throw Error(`Data format is invalid`);
          }

          fixTileJSONCenter(dataInfo.tileJSON);

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
