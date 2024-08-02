"use strict";

import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import handlebars from "handlebars";
import { getRequestHost, mercator } from "./utils.js";

function serveFrontPageHandler(config) {
  return async (req, res, next) => {
    if (config.startupComplete === false) {
      return res.status(503).send("Starting...");
    }

    const styles = {};
    const datas = {};

    await Promise.all([
      ...Object.keys(config.repo.rendereds).map(async (id) => {
        const style = config.repo.rendereds[id];
        let { name, center } = style.tileJSON;

        if (center === undefined) {
          center = [0, 0, 0];
        }

        let thumbnail = "/images/placeholder.png";
        if (config.options.serveRendered === true) {
          const centerPx = mercator.px([center[0], center[1]], center[2]);

          thumbnail = `${getRequestHost(req)}styles/${id}/256/${
            center[2]
          }/${Math.floor(centerPx[0] / 256)}/${Math.floor(centerPx[1] / 256)}.png`;
        }

        let xyzLink;
        if (config.options.serveRendered === true) {
          xyzLink = `${getRequestHost(req)}styles/${id}/256/{z}/{x}/{y}.png`;
        }

        styles[id] = {
          name: name || "Unknown",
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
        let { name, center, format, bounds, minzoom, maxzoom } = data.tileJSON;

        if (center === undefined) {
          if (
            bounds !== undefined &&
            minzoom !== undefined &&
            maxzoom !== undefined
          ) {
            center = [
              (bounds[0] + bounds[2]) / 2,
              (bounds[1] + bounds[3]) / 2,
              Math.floor((minzoom + maxzoom) / 2),
            ];
          } else {
            center = [0, 0, 0];
          }
        }

        let thumbnail = "/images/placeholder.png";
        if (format !== "pbf") {
          const centerPx = mercator.px([center[0], center[1]], center[2]);
          const x = Math.floor(centerPx[0] / 256);
          const y = Math.floor(centerPx[1] / 256);

          thumbnail = `${getRequestHost(req)}data/${id}/${
            center[2]
          }/${x}/${y}.${format}`;
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
      const fileData = await fs.readFile(
        path.resolve("public", "templates", "index.tmpl")
      );
      const compiled = handlebars.compile(fileData.toString())(serveData);

      return res.status(200).send(compiled);
    } catch (error) {
      printLog("error", `Failed to serve front page": ${error}`);

      return res.status(500).send("Internal server error");
    }
  };
}

function serveStyleHandler(config) {
  return async (req, res, next) => {
    if (config.startupComplete === false) {
      return res.status(503).send("Starting...");
    }

    const id = decodeURI(req.params.id);
    const item = config.repo.rendereds[id];

    if (item === undefined) {
      return res.status(404).send("Style is not found");
    }

    const serveData = {
      id: id,
      name: item.tileJSON.name,
    };

    try {
      const fileData = await fs.readFile(
        path.resolve("public", "templates", "viewer.tmpl")
      );
      const compiled = handlebars.compile(fileData.toString())(serveData);

      return res.status(200).send(compiled);
    } catch (error) {
      printLog("error", `Failed to serve style "${id}": ${error}`);

      return res.status(500).send("Internal server error");
    }
  };
}

function serveDataHandler(config) {
  return async (req, res, next) => {
    if (config.startupComplete === false) {
      return res.status(503).send("Starting...");
    }

    const id = decodeURI(req.params.id);
    const item = config.repo.datas[id];

    if (item === undefined) {
      return res.status(404).send("Data is not found");
    }

    const serveData = {
      id: id,
      name: item.tileJSON.name,
      is_vector: item.tileJSON.format === "pbf",
    };

    try {
      const fileData = await fs.readFile(
        path.resolve("public", "templates", "data.tmpl")
      );
      const compiled = handlebars.compile(fileData.toString())(serveData);

      return res.status(200).send(compiled);
    } catch (error) {
      printLog("error", `Failed to serve data "${id}": ${error}`);

      return res.status(500).send("Internal server error");
    }
  };
}

function serveWMTSHandler(config) {
  return async (req, res, next) => {
    const id = decodeURI(req.params.id);
    const item = config.repo.rendereds[id];

    if (item === undefined) {
      return res.status(404).send("WMTS is not found");
    }

    const serveData = {
      id: id,
      name: item.tileJSON.name,
      base_url: getRequestHost(req),
    };

    try {
      const fileData = await fs.readFile(
        path.resolve("public", "templates", "wmts.tmpl")
      );
      const compiled = handlebars.compile(fileData.toString())(serveData);

      res.header("Content-Type", "text/xml");

      return res.status(200).send(compiled);
    } catch (error) {
      printLog("error", `Failed to serve WMTS "${id}": ${error}`);

      return res.status(500).send("Internal server error");
    }
  };
}

export const serve_template = {
  init: (config) => {
    const app = express().use(
      "/",
      express.static(path.resolve("public", "resources"))
    );

    /* Get WMTS */
    if (
      config.options.serveRendered === true &&
      config.options.serveWMTS === true
    ) {
      app.get("/styles/:id/wmts.xml", serveWMTSHandler(config));
    }

    /* Serve style */
    app.get("/styles/:id/$", serveStyleHandler(config));

    /* Serve data */
    app.use("/data/:id/$", serveDataHandler(config));

    /* Serve front page */
    if (config.options.frontPage === true) {
      app.get("/$", serveFrontPageHandler(config));
    }

    return app;
  },
};
