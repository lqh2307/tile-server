"use strict";

import fs from "node:fs";
import path from "node:path";
import express from "express";
import handlebars from "handlebars";
import SphericalMercator from "@mapbox/sphericalmercator";
import { getTileUrls } from "./utils.js";

function serveFrontPageHandler(getConfig) {
  return async (req, res, next) => {
    const config = getConfig();

    if (config.options.frontPage === false) {
      res.header("Content-Type", "text/plain");

      return res.status(404).send("Front page is not support");
    }

    const mercator = new SphericalMercator();

    const styles = {};
    const renderedPromises = Object.keys(config.repo.rendered).map(
      async (id) => {
        const style = config.repo.rendered[id];
        const { center, tiles, format, name = "" } = style.tileJSON;
        const tileSize = 256;
        const xyzLink = getTileUrls(
          req,
          tiles,
          `styles/${id}`,
          tileSize,
          format
        )[0];

        let viewerHash = "";
        let thumbnail = "";
        if (center) {
          viewerHash = `#${center[2]}/${center[1].toFixed(5)}/${center[0].toFixed(5)}`;

          const centerPx = mercator.px([center[0], center[1]], center[2]);

          thumbnail = `${center[2]}/${Math.floor(centerPx[0] / tileSize)}/${Math.floor(centerPx[1] / tileSize)}.png`;
        }

        styles[id] = {
          xyz_link: xyzLink,
          viewer_hash: viewerHash,
          thumbnail: thumbnail,
          name: name,
          serve_wmts: config.options.serveWMTS === true,
        };
      }
    );

    const datas = {};
    const dataPromises = Object.keys(config.repo.data).map(async (id) => {
      const data = config.repo.data[id];
      const { center, filesize, format, tiles, name = "" } = data.tileJSON;
      const tileSize = 256;
      const xyzLink = getTileUrls(
        req,
        tiles,
        `data/${id}`,
        undefined,
        format
      )[0];

      let viewerHash = "";
      let thumbnail = "";
      if (center) {
        viewerHash = `#${center[2]}/${center[1].toFixed(5)}/${center[0].toFixed(5)}`;

        if (format !== "pbf") {
          const centerPx = mercator.px([center[0], center[1]], center[2]);

          thumbnail = `${center[2]}/${Math.floor(centerPx[0] / tileSize)}/${Math.floor(centerPx[1] / tileSize)}.${format}`;
        }
      }

      let formattedFilesize = "unknown";
      if (filesize) {
        let suffix = "kB";
        let size = parseInt(filesize, 10) / 1024;

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
        xyz_link: xyzLink,
        viewer_hash: viewerHash,
        thumbnail: thumbnail,
        source_type: data.sourceType,
        is_vector: format === "pbf",
        formatted_filesize: formattedFilesize,
        name: name,
      };
    });

    await Promise.all([...renderedPromises, ...dataPromises]);

    const styleCount = Object.keys(styles).length;
    const dataCount = Object.keys(datas).length;

    const serveData = {
      styles: styleCount ? styles : null,
      data: dataCount ? datas : null,
      style_count: styleCount,
      data_count: dataCount,
      key_query_part: req.query.key
        ? `key=${encodeURIComponent(req.query.key)}&amp;`
        : "",
      key_query: req.query.key
        ? `?key=${encodeURIComponent(req.query.key)}`
        : "",
    };

    const file = fs
      .readFileSync(path.resolve("public", "templates", "index.tmpl"))
      .toString();

    const compiled = handlebars.compile(file)(serveData);

    return res.status(200).send(compiled);
  };
}

function serveStyleHandler(getConfig) {
  return async (req, res, next) => {
    const config = getConfig();
    const id = decodeURI(req.params.id);
    const style = config.repo.rendered[id];

    if (!style) {
      res.header("Content-Type", "text/plain");

      return res.status(404).send("Style is not found");
    }

    const serveData = {
      id: id,
      name: style.tileJSON.name || "",
      key_query_part: req.query.key
        ? `key=${encodeURIComponent(req.query.key)}&amp;`
        : "",
      key_query: req.query.key
        ? `?key=${encodeURIComponent(req.query.key)}`
        : "",
    };

    const file = fs
      .readFileSync(path.resolve("public", "templates", "viewer.tmpl"))
      .toString();

    const compiled = handlebars.compile(file)(serveData);

    return res.status(200).send(compiled);
  };
}

function serveDataHandler(getConfig) {
  return async (req, res, next) => {
    const config = getConfig();
    const id = decodeURI(req.params.id);
    const data = config.repo.data[id];

    if (!data) {
      res.header("Content-Type", "text/plain");

      return res.status(404).send("Data is not found");
    }

    const serveData = {
      id: id,
      name: data.tileJSON.name || "",
      is_vector: data.tileJSON.format === "pbf",
      key_query_part: req.query.key
        ? `key=${encodeURIComponent(req.query.key)}&amp;`
        : "",
      key_query: req.query.key
        ? `?key=${encodeURIComponent(req.query.key)}`
        : "",
    };

    const file = fs
      .readFileSync(path.resolve("public", "templates", "data.tmpl"))
      .toString();

    const compiled = handlebars.compile(file)(serveData);

    return res.status(200).send(compiled);
  };
}

function serveWMTSHandler(getConfig) {
  return async (req, res, next) => {
    const config = getConfig();

    if (config.options.frontPage === false) {
      res.header("Content-Type", "text/plain");

      return res.status(404).send("WMTS is not support");
    }

    const id = decodeURI(req.params.id);
    const wmts = config.repo.rendered[id];

    if (!wmts) {
      res.header("Content-Type", "text/plain");

      return res.status(404).send("WMTS is not found");
    }

    const serveData = {
      id: id,
      name: wmts.tileJSON.name || "",
      base_url: `${req.get("X-Forwarded-Protocol") ? req.get("X-Forwarded-Protocol") : req.protocol}://${req.get("host")}/`,
      key_query_part: req.query.key
        ? `key=${encodeURIComponent(req.query.key)}&amp;`
        : "",
      key_query: req.query.key
        ? `?key=${encodeURIComponent(req.query.key)}`
        : "",
    };

    const file = fs
      .readFileSync(path.resolve("public", "templates", "wmts.tmpl"))
      .toString();

    const compiled = handlebars.compile(file)(serveData);

    res.header("Content-Type", "text/xml");

    return res.status(200).send(compiled);
  };
}

export const serve_template = {
  init: (getConfig) => {
    const app = express().use(
      "/",
      express.static(path.resolve("public", "resources"))
    );

    app.get("/styles/:id/wmts.xml", serveWMTSHandler(getConfig));

    app.get("/styles/:id/$", serveStyleHandler(getConfig));

    app.use("/data/:id/$", serveDataHandler(getConfig));

    app.get("/$", serveFrontPageHandler(getConfig));

    return app;
  },
};
