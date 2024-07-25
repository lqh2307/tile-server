"use strict";

import fs from "node:fs";
import path from "node:path";
import express from "express";
import handlebars from "handlebars";
import { getURL, mercator } from "./utils.js";

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
        const { name, center } = style.tileJSON;

        let viewerHash = "";
        let thumbnail = "/images/placeholder.png";
        if (center !== undefined) {
          viewerHash = `#${center[2]}/${center[1]}/${center[0]}`;

          const centerPx = mercator.px([center[0], center[1]], center[2]);
          const x = Math.floor(centerPx[0] / 256);
          const y = Math.floor(centerPx[1] / 256);

          if (config.options.serveRendered === true) {
            thumbnail = `${getURL(req)}styles/${id}/256/${
              center[2]
            }/${x}/${y}.png`;
          }
        }

        let xyzLink = "";
        if (config.options.serveRendered === true) {
          xyzLink = `${getURL(req)}styles/${id}/256/{z}/{x}/{y}.png`;
        }

        styles[id] = {
          name: name || "Unknown",
          xyz_link: xyzLink,
          viewer_hash: viewerHash,
          thumbnail: thumbnail,
          serve_wmts:
            config.options.serveRendered === true &&
            config.options.serveWMTS === true,
          serve_rendered: config.options.serveRendered === true,
        };
      }),
      ...Object.keys(config.repo.datas).map(async (id) => {
        const data = config.repo.datas[id];
        const { name, center, format, filesize } = data.tileJSON;

        let viewerHash = "";
        let thumbnail = "/images/placeholder.png";
        if (center !== undefined) {
          viewerHash = `#${center[2]}/${center[1]}/${center[0]}`;

          if (format !== "pbf") {
            const centerPx = mercator.px([center[0], center[1]], center[2]);
            const x = Math.floor(centerPx[0] / 256);
            const y = Math.floor(centerPx[1] / 256);

            thumbnail = `${getURL(req)}data/${id}/${
              center[2]
            }/${x}/${y}.${format}`;
          }
        }

        let formattedFilesize = "";
        if (filesize !== undefined) {
          let suffix = "KB";
          let size = filesize / 1024;

          if (size > 1024) {
            suffix = "MB";
            size /= 1024;
          }

          if (size > 1024) {
            suffix = "GB";
            size /= 1024;
          }

          formattedFilesize = `${size.toFixed(2)} ${suffix}`;
        }

        datas[id] = {
          name: name,
          xyz_link: `${getURL(req)}data/${id}/{z}/{x}/{y}.${format}`,
          viewer_hash: viewerHash,
          thumbnail: thumbnail,
          source_type: data.sourceType,
          is_vector: format === "pbf",
          formatted_filesize: formattedFilesize,
        };
      }),
    ]);

    const serveData = {
      styles: styles,
      data: datas,
      style_count: Object.keys(styles).length,
      data_count: Object.keys(datas).length,
    };

    const filePath = path.resolve("public", "templates", "index.tmpl");

    const compiled = handlebars.compile(fs.readFileSync(filePath).toString())(
      serveData
    );

    return res.status(200).send(compiled);
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

    const filePath = path.resolve("public", "templates", "viewer.tmpl");

    const compiled = handlebars.compile(fs.readFileSync(filePath).toString())(
      serveData
    );

    return res.status(200).send(compiled);
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

    const filePath = path.resolve("public", "templates", "data.tmpl");

    const compiled = handlebars.compile(fs.readFileSync(filePath).toString())(
      serveData
    );

    return res.status(200).send(compiled);
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
      base_url: getURL(req),
    };

    const filePath = path.resolve("public", "templates", "wmts.tmpl");

    const compiled = handlebars.compile(fs.readFileSync(filePath).toString())(
      serveData
    );

    res.header("Content-Type", "text/xml");

    return res.status(200).send(compiled);
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
