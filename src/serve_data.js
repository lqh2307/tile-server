"use strict";

import { StatusCodes } from "http-status-codes";
import path from "node:path";
import express from "express";
import {
  validateDataInfo,
  getPMTilesInfos,
  getMBTilesInfos,
  getRequestHost,
  getPMTilesTile,
  getMBTilesTile,
  downloadFile,
  openMBTiles,
  openPMTiles,
  gzipAsync,
  printLog,
} from "./utils.js";

function getDataTileHandler(config) {
  return async (req, res, next) => {
    const id = decodeURI(req.params.id);
    const item = config.repo.datas[id];

    /* Check data is exist? */
    if (item === undefined) {
      return res.status(StatusCodes.NOT_FOUND).send("Data is not found");
    }

    /* Check data tile format */
    if (req.params.format !== item.tileJSON.format) {
      return res
        .status(StatusCodes.BAD_REQUEST)
        .send("Data tile format is invalid");
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

      return res.status(StatusCodes.OK).send(dataTile.data);
    } catch (error) {
      printLog(
        "error",
        `Failed to get data "${id}" - Tile ${z}/${x}/${y}: ${error}`
      );

      if (error.message === "Tile does not exist") {
        return res.status(StatusCodes.NOT_FOUND).send(error.message);
      }

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

function getDataHandler(config) {
  return async (req, res, next) => {
    const id = decodeURI(req.params.id);
    const item = config.repo.datas[id];

    if (item === undefined) {
      return res.status(StatusCodes.NOT_FOUND).send("Data is not found");
    }

    let dataInfo;

    try {
      if (item.sourceType === "mbtiles") {
        dataInfo = await getMBTilesInfos(
          item.source,
          req.query.json === "true" ? true : false
        );
      } else {
        dataInfo = await getMBTilesInfos(
          item.source,
          req.query.json === "true" ? true : false
        );
      }

      dataInfo.tiles = [
        `${getRequestHost(req)}data/${id}/{z}/{x}/{y}.${item.tileJSON.format}`,
      ];

      res.header("Content-Type", "application/json");

      return res.status(StatusCodes.OK).send(dataInfo);
    } catch (error) {
      printLog("error", `Failed to get data "${id}": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

function getDatasListHandler(config) {
  return async (req, res, next) => {
    try {
      const datas = config.repo.datas;

      const result = Object.keys(datas).map((id) => {
        return {
          id: id,
          name: datas[id].tileJSON.name,
          url: `${getRequestHost(req)}data/${id}.json`,
        };
      });

      return res.status(StatusCodes.OK).send(result);
    } catch (error) {
      printLog("error", `Failed to get datas": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

export const serve_data = {
  init: (config) => {
    const app = express();

    /**
     * @swagger
     * tags:
     *   - name: Data
     *     description: Data related endpoints
     * /data/datas.json:
     *   get:
     *     tags:
     *       - Data
     *     summary: Get all datas
     *     responses:
     *       200:
     *         description: List of all datas
     *         content:
     *           application/json:
     *             schema:
     *               type: array
     *               items:
     *                 type: object
     *                 properties:
     *                   id:
     *                     type: string
     *                   name:
     *                     type: string
     *                   url:
     *                     type: string
     */
    app.get("/datas.json", getDatasListHandler(config));

    /**
     * @swagger
     * tags:
     *   - name: Data
     *     description: Data related endpoints
     * /data/{id}.json:
     *   get:
     *     tags:
     *       - Data
     *     summary: Get data by ID
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *         description: Data ID
     *       - in: query
     *         name: json
     *         schema:
     *           type: string
     *           enum: [true, false]
     *         description: Include vector_layers and tilestats fields in response
     *     responses:
     *       200:
     *         description: Data information
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     */
    app.get("/:id.json", getDataHandler(config));

    /**
     * @swagger
     * tags:
     *   - name: Data
     *     description: Data related endpoints
     * /data/{id}/{z}/{x}/{y}.{format}:
     *   get:
     *     tags:
     *       - Data
     *     summary: Get data tile
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *         description: Data ID
     *       - in: path
     *         name: z
     *         required: true
     *         schema:
     *           type: integer
     *           example: 0
     *         description: Zoom level
     *       - in: path
     *         name: x
     *         required: true
     *         schema:
     *           type: integer
     *           example: 0
     *         description: Tile X coordinate
     *       - in: path
     *         name: y
     *         required: true
     *         schema:
     *           type: integer
     *           example: 0
     *         description: Tile Y coordinate
     *       - in: path
     *         name: format
     *         required: true
     *         schema:
     *           type: string
     *           enum: [jpeg, jpg, pbf, png, webp, gif]
     *         description: Tile format
     *     responses:
     *       200:
     *         description: Data tile
     *         content:
     *           application/octet-stream:
     *             schema:
     *               type: string
     *               format: binary
     */
    app.get(
      `/:id/:z(\\d+)/:x(\\d+)/:y(\\d+).:format(jpeg|jpg|pbf|png|webp|gif)`,
      getDataTileHandler(config)
    );

    return app;
  },

  add: async (config) => {
    await Promise.all(
      Object.keys(config.data).map(async (id) => {
        try {
          const item = config.data[id];
          const dataInfo = {};

          let filePath;

          if (item.mbtiles) {
            if (
              item.mbtiles.startsWith("https://") === true ||
              item.mbtiles.startsWith("http://") === true
            ) {
              filePath = path.join(
                config.options.paths.mbtiles,
                id,
                `${id}.mbtiles`
              );

              await downloadFile(item.mbtiles, filePath);

              item.mbtiles = path.join(id, `${id}.mbtiles`);
            } else {
              filePath = path.join(config.options.paths.mbtiles, item.mbtiles);
            }

            dataInfo.sourceType = "mbtiles";
            dataInfo.source = await openMBTiles(filePath);
            dataInfo.tileJSON = await getMBTilesInfos(dataInfo.source);
          } else if (item.pmtiles) {
            if (
              item.pmtiles.startsWith("https://") === true ||
              item.pmtiles.startsWith("http://") === true
            ) {
              filePath = item.pmtiles;
            } else {
              filePath = path.join(config.options.paths.pmtiles, item.pmtiles);
            }

            dataInfo.sourceType = "pmtiles";
            dataInfo.source = await openPMTiles(filePath);
            dataInfo.tileJSON = await getPMTilesInfos(dataInfo.source);
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
