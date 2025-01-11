"use strict";

import { getRequestHost, calculateMD5, isExistFile } from "./utils.js";
import { checkReadyMiddleware } from "./middleware.js";
import { StatusCodes } from "http-status-codes";
import { printLog } from "./logger.js";
import { config } from "./config.js";
import { seed } from "./seed.js";
import express from "express";
import {
  validateAndGetGeometryTypes,
  downloadGeoJSONFile,
  getGeoJSONFromURL,
  cacheGeoJSONFile,
  getGeoJSON,
} from "./geojson.js";

/**
 * Get geoJSON info handler
 * @returns {(req: any, res: any, next: any) => Promise<any>}
 */
function getGeoJSONInfoHandler() {
  return async (req, res, next) => {
    const id = req.params.id;

    try {
      const item = config.repo.geojsons[id];

      /* Check GeoJSON is used? */
      if (item === undefined) {
        return res.status(StatusCodes.NOT_FOUND).send("GeoJSON does not exist");
      }

      const requestHost = getRequestHost(req);

      const geojsons = {};

      for (const layer in item) {
        geojsons[layer] = {
          url: `${requestHost}/geojsons/${id}/${layer}.geojson`,
          geometryTypes: item[layer].geometryTypes,
        };
      }

      res.header("content-type", "application/json");

      return res.status(StatusCodes.OK).send({
        id: id,
        name: id,
        geojsons: geojsons,
      });
    } catch (error) {
      printLog("error", `Failed to get GeoJSON info "${id}": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

/**
 * Get geoJSON handler
 * @returns {(req: any, res: any, next: any) => Promise<any>}
 */
function getGeoJSONHandler() {
  return async (req, res, next) => {
    const id = req.params.id;

    try {
      const item = config.repo.geojsons[id];

      /* Check GeoJSON is used? */
      if (item === undefined) {
        return res.status(StatusCodes.NOT_FOUND).send("GeoJSON does not exist");
      }

      const geoJSONLayer = item[req.params.layer];

      /* Check GeoJSON layer is used? */
      if (geoJSONLayer === undefined) {
        return res
          .status(StatusCodes.NOT_FOUND)
          .send("GeoJSON layer does not exist");
      }

      let geoJSON;

      /* Get geoJSON and Cache if not exist (if use cache) */
      try {
        geoJSON = await getGeoJSON(geoJSONLayer.path);
      } catch (error) {
        if (
          geoJSONLayer.sourceURL !== undefined &&
          error.message === "GeoJSON does not exist"
        ) {
          printLog(
            "info",
            `Forwarding GeoJSON "${id}" - To "${geoJSONLayer.sourceURL}"...`
          );

          geoJSON = await getGeoJSONFromURL(
            geoJSONLayer.sourceURL,
            60000 // 1 mins
          );

          if (geoJSONLayer.storeCache === true) {
            printLog(
              "info",
              `Caching GeoJSON "${id}" - File "${item.path}"...`
            );

            cacheGeoJSONFile(geoJSONLayer.path, JSON.stringify(geoJSON)).catch(
              (error) =>
                printLog(
                  "error",
                  `Failed to cache GeoJSON "${id}" - File "${geoJSONLayer.path}": ${error}`
                )
            );
          }
        } else {
          throw error;
        }
      }

      res.header("content-type", "application/json");

      return res.status(StatusCodes.OK).send(geoJSON);
    } catch (error) {
      printLog("error", `Failed to get GeoJSON "${id}": ${error}`);

      if (error.message === "GeoJSON does not exist") {
        return res.status(StatusCodes.NO_CONTENT).send(error.message);
      } else {
        return res
          .status(StatusCodes.INTERNAL_SERVER_ERROR)
          .send("Internal server error");
      }
    }
  };
}

/**
 * Get geoJSON MD5 handler
 * @returns {(req: any, res: any, next: any) => Promise<any>}
 */
function getGeoJSONMD5Handler() {
  return async (req, res, next) => {
    const id = req.params.id;

    try {
      const item = config.repo.geojsons[id];

      /* Check GeoJSON is used? */
      if (item === undefined) {
        return res.status(StatusCodes.NOT_FOUND).send("GeoJSON does not exist");
      }

      const geoJSONLayer = item[req.params.layer];

      /* Check GeoJSON layer is used? */
      if (geoJSONLayer === undefined) {
        return res
          .status(StatusCodes.NOT_FOUND)
          .send("GeoJSON layer does not exist");
      }

      /* Get geoJSON MD5 and Add to header */
      const geoJSON = await getGeoJSON(geoJSONLayer.path);

      res.set({
        etag: calculateMD5(Buffer.from(JSON.stringify(geoJSON), "utf8")),
      });

      return res.status(StatusCodes.OK).send();
    } catch (error) {
      printLog("error", `Failed to get md5 GeoJSON "${id}": ${error}`);

      if (error.message === "GeoJSON does not exist") {
        return res.status(StatusCodes.NO_CONTENT).send(error.message);
      } else {
        return res
          .status(StatusCodes.INTERNAL_SERVER_ERROR)
          .send("Internal server error");
      }
    }
  };
}

/**
 * Get GeoJSON list handler
 * @returns {(req: any, res: any, next: any) => Promise<any>}
 */
function getGeoJSONsListHandler() {
  return async (req, res, next) => {
    try {
      const requestHost = getRequestHost(req);

      const result = await Promise.all(
        Object.keys(config.repo.geojsons).map(async (id) => {
          return {
            id: id,
            name: id,
            url: `${requestHost}/geojsons/${id}.json`,
          };
        })
      );

      return res.status(StatusCodes.OK).send(result);
    } catch (error) {
      printLog("error", `Failed to get GeoJSONs": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

export const serve_geojson = {
  init: () => {
    const app = express().disable("x-powered-by");

    /**
     * @swagger
     * tags:
     *   - name: GeoJSON
     *     description: GeoJSON related endpoints
     * /geojsons/geojsons.json:
     *   get:
     *     tags:
     *       - GeoJSON
     *     summary: Get all GeoJSONs
     *     responses:
     *       200:
     *         description: List of all GeoJSONs
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
     *       404:
     *         description: Not found
     *       503:
     *         description: Server is starting up
     *         content:
     *           text/plain:
     *             schema:
     *               type: string
     *               example: Starting...
     *       500:
     *         description: Internal server error
     */
    app.get("/geojsons.json", checkReadyMiddleware(), getGeoJSONsListHandler());

    /**
     * @swagger
     * tags:
     *   - name: GeoJSON
     *     description: GeoJSON related endpoints
     * /geojsons/{id}.json:
     *   get:
     *     tags:
     *       - GeoJSON
     *     summary: Get geoJSON info
     *     parameters:
     *       - in: path
     *         name: id
     *         schema:
     *           type: string
     *           example: id
     *         required: true
     *         description: ID of the GeoJSON
     *     responses:
     *       200:
     *         description: GeoJSON info
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *       404:
     *         description: Not found
     *       503:
     *         description: Server is starting up
     *         content:
     *           text/plain:
     *             schema:
     *               type: string
     *               example: Starting...
     *       500:
     *         description: Internal server error
     */
    app.get("/:id.json", checkReadyMiddleware(), getGeoJSONInfoHandler());

    /**
     * @swagger
     * tags:
     *   - name: GeoJSON
     *     description: GeoJSON related endpoints
     * /geojsons/{id}/{layer}.geojson:
     *   get:
     *     tags:
     *       - GeoJSON
     *     summary: Get geoJSON
     *     parameters:
     *       - in: path
     *         name: id
     *         schema:
     *           type: string
     *           example: id
     *         required: true
     *         description: ID of the GeoJSON
     *       - in: path
     *         name: layer
     *         schema:
     *           type: string
     *           example: layer
     *         required: true
     *         description: Layer of the GeoJSON
     *     responses:
     *       200:
     *         description: GeoJSON
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *       404:
     *         description: Not found
     *       503:
     *         description: Server is starting up
     *         content:
     *           text/plain:
     *             schema:
     *               type: string
     *               example: Starting...
     *       500:
     *         description: Internal server error
     */
    app.get("/:id/:layer.geojson", checkReadyMiddleware(), getGeoJSONHandler());

    /**
     * @swagger
     * tags:
     *   - name: GeoJSON
     *     description: GeoJSON related endpoints
     * /geojsons/{id}/md5/{layer}.geojson:
     *   get:
     *     tags:
     *       - GeoJSON
     *     summary: Get geoJSON MD5
     *     parameters:
     *       - in: path
     *         name: id
     *         schema:
     *           type: string
     *           example: id
     *         required: true
     *         description: ID of the GeoJSON
     *       - in: path
     *         name: layer
     *         schema:
     *           type: string
     *           example: layer
     *         required: true
     *         description: Layer of the GeoJSON
     *     responses:
     *       200:
     *         description: GeoJSON MD5
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *       404:
     *         description: Not found
     *       503:
     *         description: Server is starting up
     *         content:
     *           text/plain:
     *             schema:
     *               type: string
     *               example: Starting...
     *       500:
     *         description: Internal server error
     */
    app.get(
      "/:id/md5/:layer.geojson",
      checkReadyMiddleware(),
      getGeoJSONMD5Handler()
    );

    return app;
  },

  add: async () => {
    await Promise.all(
      Object.keys(config.geojsons).map(async (id) => {
        try {
          const dataInfo = {};

          /* Get GeoJSON infos */
          await Promise.all(
            Object.keys(config.geojsons[id]).map(async (layer) => {
              const item = config.geojsons[id][layer];

              /* Get GeoJSON path */
              const info = {};

              if (
                item.geojson.startsWith("https://") === true ||
                item.geojson.startsWith("http://") === true
              ) {
                info.path = `${process.env.DATA_DIR}/geojsons/${id}/geojson.geojson`;

                /* Download GeoJSON file */
                if ((await isExistFile(info.path)) === false) {
                  printLog(
                    "info",
                    `Downloading GeoJSON file "${info.path}" from "${item.geojson}"...`
                  );

                  await downloadGeoJSONFile(
                    item.geojson,
                    info.path,
                    5,
                    300000 // 5 mins
                  );
                }
              } else {
                if (item.cache !== undefined) {
                  info.path = `${process.env.DATA_DIR}/caches/geojsons/${item.geojson}/${item.geojson}.geojson`;

                  const cacheSource = seed.geojsons[item.geojson];

                  if (cacheSource === undefined) {
                    throw new Error(
                      `Cache GeoJSON "${item.geojson}" is invalid`
                    );
                  }

                  if (item.cache.forward === true) {
                    info.sourceURL = cacheSource.url;
                    info.storeCache = item.cache.store;
                  }
                } else {
                  info.path = `${process.env.DATA_DIR}/geojsons/${item.geojson}`;
                }
              }

              /* Load GeoJSON */
              try {
                /* Open GeoJSON */
                const geoJSON = await getGeoJSON(info.path);

                /* Validate and Get GeoJSON info */
                info.geometryTypes = validateAndGetGeometryTypes(geoJSON);

                dataInfo[layer] = info;
              } catch (error) {
                if (
                  item.cache !== undefined &&
                  error.message === "GeoJSON does not exist"
                ) {
                  dataInfo[layer] = info;
                } else {
                  throw error;
                }
              }
            })
          );

          /* Add to repo */
          config.repo.geojsons[id] = dataInfo;
        } catch (error) {
          printLog(
            "error",
            `Failed to load GeoJSON "${id}": ${error}. Skipping...`
          );
        }
      })
    );
  },
};
