"use strict";

import { getRequestHost, calculateMD5, isExistFile } from "./utils.js";
import { checkReadyMiddleware } from "./middleware.js";
import { StatusCodes } from "http-status-codes";
import { printLog } from "./logger.js";
import { config } from "./config.js";
import { seed } from "./seed.js";
import express from "express";
import {
  downloadGeoJSONFile,
  getGeoJSONFromURL,
  cacheGeoJSONFile,
  validateGeoJSON,
  getGeoJSON,
} from "./geojson.js";

/**
 * Get geoJSON handler
 * @returns {(req: any, res: any, next: any) => Promise<any>}
 */
function getGeoJSONHandler() {
  return async (req, res, next) => {
    const id = req.params.id;
    const item = config.repo.geojsons[id];

    /* Check GeoJSON is used? */
    if (item === undefined) {
      return res.status(StatusCodes.NOT_FOUND).send("GeoJSON does not exist");
    }

    /* Get geoJSON */
    let geoJSON;

    try {
      try {
        geoJSON = await getGeoJSON(item.path);
      } catch (error) {
        if (
          item.sourceURL !== undefined &&
          error.message === "GeoJSON does not exist"
        ) {
          printLog(
            "info",
            `Forwarding GeoJSON "${id}" - To "${item.sourceURL}"...`
          );

          /* Get GeoJSON */
          geoJSON = await getGeoJSONFromURL(
            item.sourceURL,
            60000 // 1 mins
          );

          /* Cache */
          if (item.storeCache === true) {
            printLog("info", `Caching GeoJSON "${id}" - File "${filePath}"...`);

            cacheGeoJSONFile(item.path, JSON.stringify(geoJSON, null, 2)).catch(
              (error) =>
                printLog(
                  "error",
                  `Failed to cache GeoJSON "${id}" - File "${filePath}": ${error}`
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
    const item = config.repo.geojsons[id];

    /* Check GeoJSON is used? */
    if (item === undefined) {
      return res.status(StatusCodes.NOT_FOUND).send("GeoJSON does not exist");
    }

    /* Get geoJSON MD5 */
    try {
      const geoJSON = await getGeoJSON(item.path);

      /* Add MD5 to header */
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
            name: config.repo.geojsons[id].name,
            url: `${requestHost}/geojsons/${id}/geojson.geojson`,
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
     * /geojsons/{id}/geojson.geojson:
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
    app.get(
      "/:id/geojson.geojson",
      checkReadyMiddleware(),
      getGeoJSONHandler()
    );

    /**
     * @swagger
     * tags:
     *   - name: GeoJSON
     *     description: GeoJSON related endpoints
     * /geojsons/{id}/md5/geojson.geojson:
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
     *       - in: query
     *         name: raw
     *         schema:
     *           type: boolean
     *         required: false
     *         description: Use raw
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
      "/:id/md5/geojson.geojson",
      checkReadyMiddleware(),
      getGeoJSONMD5Handler()
    );

    return app;
  },

  add: async () => {
    await Promise.all(
      Object.keys(config.geojsons).map(async (id) => {
        const item = config.geojsons[id];

        const geoJSONInfo = {};

        let geoJSON;

        /* Serve GeoJSON */
        try {
          if (
            item.geojson.startsWith("https://") === true ||
            item.geojson.startsWith("http://") === true
          ) {
            geoJSONInfo.path = `${process.env.DATA_DIR}/geojsons/${id}/geojson.geojson`;

            /* Download GeoJSON.json file */
            if ((await isExistFile(geoJSONInfo.path)) === false) {
              printLog(
                "info",
                `Downloading GeoJSON file "${geoJSONInfo.path}" from "${item.geojson}"...`
              );

              await downloadGeoJSONFile(
                item.geojson,
                geoJSONInfo.path,
                5,
                300000 // 5 mins
              );
            }
          } else {
            if (item.cache !== undefined) {
              geoJSONInfo.path = `${process.env.DATA_DIR}/caches/geojsons/${item.geojson}/geojson.geojson`;

              const cacheSource = seed.geojsons[item.geojson];

              if (cacheSource === undefined) {
                throw new Error(`Cache GeoJSON "${item.geojson}" is invalid`);
              }

              if (item.cache.forward === true) {
                geoJSONInfo.sourceURL = cacheSource.url;
                geoJSONInfo.storeCache = item.cache.store;
              }
            } else {
              geoJSONInfo.path = `${process.env.DATA_DIR}/geojsons/${item.geojson}`;
            }
          }

          try {
            /* Read geojson.geojson file */
            geoJSON = await getGeoJSON(geoJSONInfo.path);

            /* Validate GeoJSON */
            await validateGeoJSON(geoJSON);

            /* Store GeoJSON info */
            geoJSONInfo.name = geoJSON.name || "Unknown";
          } catch (error) {
            if (
              item.cache !== undefined &&
              error.message === "GeoJSON does not exist"
            ) {
              geoJSONInfo.name =
                seed.geojsons[item.geojson].metadata.name || "Unknown";
            } else {
              throw error;
            }
          }

          /* Add to repo */
          config.repo.geojsons[id] = geoJSONInfo;
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
