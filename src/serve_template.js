"use strict";

import { compileTemplate, getRequestHost, mercator } from "./utils.js";
import { StatusCodes } from "http-status-codes";
import express from "express";
import path from "node:path";

function checkHealth(config) {
  return (req, res, next) => {
    if (config.startupComplete === false) {
      return res.status(StatusCodes.SERVICE_UNAVAILABLE).send("Starting...");
    }

    next();
  };
}

function serveFrontPageHandler(config) {
  return async (req, res, next) => {
    const styles = {};
    const datas = {};

    await Promise.all([
      ...Object.keys(config.repo.rendereds).map(async (id) => {
        const style = config.repo.rendereds[id];
        const { name, center } = style.tileJSON;

        let thumbnail = "/images/placeholder.png";
        if (config.options.serveRendered === true) {
          const centerPx = mercator.px([center[0], center[1]], center[2]);
          const z = center[2];
          const x = Math.floor(centerPx[0] / 256);
          const y = Math.floor(centerPx[1] / 256);

          thumbnail = `${getRequestHost(req)}styles/${id}/256/${z}/${x}/${y}.png`;
        }

        let xyzLink;
        if (config.options.serveRendered === true) {
          xyzLink = `${getRequestHost(req)}styles/${id}/256/{z}/{x}/{y}.png`;
        }

        styles[id] = {
          name: name,
          xyz_link: xyzLink,
          viewer_hash: `#${center[2]}/${center[1]}/${center[0]}`,
          thumbnail: thumbnail,
          serve_wmts:
            config.options.serveRendered === true &&
            config.options.serveWMTS === true,
          serve_rendered: config.options.serveRendered === true,
        };
      }),
      ...Object.keys(config.repo.datas).map(async (id) => {
        const data = config.repo.datas[id];
        const { name, center, format } = data.tileJSON;

        let thumbnail = "/images/placeholder.png";
        if (format !== "pbf") {
          const centerPx = mercator.px([center[0], center[1]], center[2]);
          const z = center[2];
          const x = Math.floor(centerPx[0] / 256);
          const y = Math.floor(centerPx[1] / 256);

          thumbnail = `${getRequestHost(req)}data/${id}/${z}/${x}/${y}.${format}`;
        }

        datas[id] = {
          name: name,
          xyz_link: `${getRequestHost(req)}data/${id}/{z}/{x}/{y}.${format}`,
          viewer_hash: `#${center[2]}/${center[1]}/${center[0]}`,
          thumbnail: thumbnail,
          source_type: data.sourceType,
          is_vector: format === "pbf",
        };
      }),
    ]);

    const serveData = {
      styles: styles,
      data: datas,
      style_count: Object.keys(styles).length,
      data_count: Object.keys(datas).length,
    };

    try {
      const compiled = await compileTemplate("index", serveData);

      return res.status(StatusCodes.OK).send(compiled);
    } catch (error) {
      printLog("error", `Failed to serve front page": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

function serveStyleHandler(config) {
  return async (req, res, next) => {
    const id = decodeURI(req.params.id);
    const item = config.repo.rendereds[id];

    if (item === undefined) {
      return res.status(StatusCodes.NOT_FOUND).send("Style is not found");
    }

    const serveData = {
      id: id,
      name: item.tileJSON.name,
    };

    try {
      const compiled = await compileTemplate("viewer", serveData);

      return res.status(StatusCodes.OK).send(compiled);
    } catch (error) {
      printLog("error", `Failed to serve style "${id}": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

function serveDataHandler(config) {
  return async (req, res, next) => {
    const id = decodeURI(req.params.id);
    const item = config.repo.datas[id];

    if (item === undefined) {
      return res.status(StatusCodes.NOT_FOUND).send("Data is not found");
    }

    const serveData = {
      id: id,
      name: item.tileJSON.name,
      is_vector: item.tileJSON.format === "pbf",
    };

    try {
      const compiled = await compileTemplate("data", serveData);

      return res.status(StatusCodes.OK).send(compiled);
    } catch (error) {
      printLog("error", `Failed to serve data "${id}": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

function serveWMTSHandler(config) {
  return async (req, res, next) => {
    const id = decodeURI(req.params.id);
    const item = config.repo.rendereds[id];

    if (item === undefined) {
      return res.status(StatusCodes.NOT_FOUND).send("WMTS is not found");
    }

    const serveData = {
      id: id,
      name: item.tileJSON.name,
      base_url: getRequestHost(req),
    };

    try {
      const compiled = await compileTemplate("wmts", serveData);

      res.header("Content-Type", "text/xml");

      return res.status(StatusCodes.OK).send(compiled);
    } catch (error) {
      printLog("error", `Failed to serve WMTS "${id}": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

export const serve_template = {
  init: (config) => {
    const app = express().use(
      "/",
      express.static(path.resolve("public", "resources"))
    );

    if (
      config.options.serveRendered === true &&
      config.options.serveWMTS === true
    ) {
      /**
       * @swagger
       * tags:
       *   - name: WMTS
       *     description: WMTS related endpoints
       * /styles/{id}/wmts.xml:
       *   get:
       *     tags:
       *       - WMTS
       *     summary: Get WMTS XML for style
       *     parameters:
       *       - in: path
       *         name: id
       *         schema:
       *           type: string
       *         required: true
       *         description: ID of the style
       *     responses:
       *       200:
       *         description: WMTS XML for the style
       *         content:
       *           text/xml:
       *             schema:
       *               type: string
       *       404:
       *         description: Style not found
       *       500:
       *         description: Internal server error
       */
      app.get("/styles/:id/wmts.xml", serveWMTSHandler(config));
    }

    if (config.options.frontPage === true) {
      /**
       * @swagger
       * tags:
       *   - name: Template
       *     description: Template related endpoints
       * /styles/{id}/:
       *   get:
       *     tags:
       *       - Template
       *     summary: Serve style page
       *     parameters:
       *       - in: path
       *         name: id
       *         schema:
       *           type: string
       *         required: true
       *         description: ID of the style
       *     responses:
       *       200:
       *         description: Style page
       *         content:
       *           text/html:
       *             schema:
       *               type: string
       *       404:
       *         description: Style not found
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
      app.get("/styles/:id/$", checkHealth(config), serveStyleHandler(config));

      /* Serve data */
      /**
       * @swagger
       * tags:
       *   - name: Template
       *     description: Template related endpoints
       * /data/{id}/:
       *   get:
       *     tags:
       *       - Template
       *     summary: Serve data page
       *     parameters:
       *       - in: path
       *         name: id
       *         schema:
       *           type: string
       *         required: true
       *         description: ID of the data
       *     responses:
       *       200:
       *         description: Data page
       *         content:
       *           text/html:
       *             schema:
       *               type: string
       *       404:
       *         description: Data not found
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
      app.use("/data/:id/$", checkHealth(config), serveDataHandler(config));

      /* Serve front page */
      /**
       * @swagger
       * tags:
       *   - name: Template
       *     description: Template related endpoints
       * /:
       *   get:
       *     tags:
       *       - Template
       *     summary: Serve front page
       *     responses:
       *       200:
       *         description: Front page
       *         content:
       *           text/html:
       *             schema:
       *               type: string
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
      app.get("/$", checkHealth(config), serveFrontPageHandler(config));
    }

    return app;
  },
};
