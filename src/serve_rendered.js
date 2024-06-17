"use strict";

import "canvas";
import "@maplibre/maplibre-gl-native";
import advancedPool from "advanced-pool";
import fs from "node:fs";
import path from "node:path";
import url from "url";
import util from "util";
import zlib from "zlib";
import sharp from "sharp";
import Color from "color";
import express from "express";
import sanitize from "sanitize-filename";
import SphericalMercator from "@mapbox/sphericalmercator";
import mlgl from "@maplibre/maplibre-gl-native";
import MBTiles from "@mapbox/mbtiles";
import polyline from "@mapbox/polyline";
import proj4 from "proj4";
import axios from "axios";
import {
  getFontsPbf,
  getTileUrls,
  fixTileJSONCenter,
  printLog,
  getUrl,
  getScale,
} from "./utils.js";
import {
  openPMtiles,
  getPMtilesInfo,
  getPMtilesTile,
} from "./pmtiles_adapter.js";
import { renderOverlay, renderWatermark, renderAttribution } from "./render.js";

const FLOAT_PATTERN = "[+-]?(?:\\d+|\\d+.?\\d+)";
const PATH_PATTERN =
  /^((fill|stroke|width)\:[^\|]+\|)*(enc:.+|-?\d+(\.\d*)?,-?\d+(\.\d*)?(\|-?\d+(\.\d*)?,-?\d+(\.\d*)?)+)/;
const FORMAT_PATTERN = "(pbf|jpg|png|jpeg|webp|geojson)";

/**
 * Lookup of sharp output formats by file extension.
 */
const extensionToFormat = {
  ".jpg": "jpeg",
  ".jpeg": "jpeg",
  ".png": "png",
  ".webp": "webp",
  ".pbf": "pbf",
  ".geojson": "geojson",
};

const mercator = new SphericalMercator();

mlgl.on("message", (error) => {
  if (error.severity === "ERROR") {
    printLog("error", `mlgl: ${JSON.stringify(error)}`);
  } else if (error.severity === "WARNING") {
    printLog("warning", `mlgl: ${JSON.stringify(error)}`);
  }
});

/**
 * Cache of response data by sharp output format and color. Entry for empty
 * string is for unknown or unsupported formats.
 */
const cachedEmptyResponses = {
  "": Buffer.alloc(0),
};

/**
 * Create an appropriate mlgl response for http errors.
 * @param {string} format The format (a sharp format or 'pbf').
 * @param {string} color The background color (or empty string for transparent).
 * @param {Function} callback The mlgl callback.
 */
function createEmptyResponse(format, color, callback) {
  if (!format || format === "pbf") {
    callback(null, {
      data: cachedEmptyResponses[""],
    });

    return;
  }

  if (format === "jpg") {
    format = "jpeg";
  }

  if (!color) {
    color = "rgba(255,255,255,0)";
  }

  const cacheKey = `${format},${color}`;
  const data = cachedEmptyResponses[cacheKey];
  if (data) {
    callback(null, {
      data: data,
    });

    return;
  }

  // create an "empty" response image
  color = new Color(color);
  const array = color.array();
  const channels = array.length === 4 && format !== "jpeg" ? 4 : 3;
  sharp(Buffer.from(array), {
    raw: {
      width: 1,
      height: 1,
      channels,
    },
  })
    .toFormat(format)
    .toBuffer((error, buffer) => {
      if (!error) {
        cachedEmptyResponses[cacheKey] = buffer;
      }

      callback(null, {
        data: buffer,
      });
    });
}

/**
 * Parses coordinate pair provided to pair of floats and ensures the resulting
 * pair is a longitude/latitude combination depending on lnglat query parameter.
 * @param {List} coordinatePair Coordinate pair.
 * @param coordinates
 * @param {object} query Request query parameters.
 */
const parseCoordinatePair = (coordinates, query) => {
  const firstCoordinate = parseFloat(coordinates[0]);
  const secondCoordinate = parseFloat(coordinates[1]);

  // Ensure provided coordinates could be parsed and abort if not
  if (isNaN(firstCoordinate) || isNaN(secondCoordinate)) {
    return null;
  }

  // Check if coordinates have been provided as lat/lng pair instead of the
  // ususal lng/lat pair and ensure resulting pair is lng/lat
  if (query.latlng === "1" || query.latlng === "true") {
    return [secondCoordinate, firstCoordinate];
  }

  return [firstCoordinate, secondCoordinate];
};

/**
 * Parses a coordinate pair from query arguments and optionally transforms it.
 * @param {List} coordinatePair Coordinate pair.
 * @param {object} query Request query parameters.
 * @param {Function} transformer Optional transform function.
 */
const parseCoordinates = (coordinatePair, query, transformer) => {
  const parsedCoordinates = parseCoordinatePair(coordinatePair, query);

  // Transform coordinates
  if (transformer) {
    return transformer(parsedCoordinates);
  }

  return parsedCoordinates;
};

/**
 * Parses paths provided via query into a list of path objects.
 * @param {object} query Request query parameters.
 * @param {Function} transformer Optional transform function.
 */
const extractPathsFromQuery = (query, transformer) => {
  // Initiate paths array
  const paths = [];
  // Return an empty list if no paths have been provided
  if ("path" in query && !query.path) {
    return paths;
  }

  // Parse paths provided via path query argument
  if ("path" in query) {
    const providedPaths = Array.isArray(query.path) ? query.path : [query.path];
    // Iterate through paths, parse and validate them
    for (const providedPath of providedPaths) {
      // Logic for pushing coords to path when path includes google polyline
      if (providedPath.includes("enc:") && PATH_PATTERN.test(providedPath)) {
        // +4 because 'enc:' is 4 characters, everything after 'enc:' is considered to be part of the polyline
        const encIndex = providedPath.indexOf("enc:") + 4;
        const coords = polyline
          .decode(providedPath.substring(encIndex))
          .map(([lat, lng]) => [lng, lat]);
        paths.push(coords);
      } else {
        // Iterate through paths, parse and validate them
        const currentPath = [];

        // Extract coordinate-list from path
        const pathParts = (providedPath || "").split("|");

        // Iterate through coordinate-list, parse the coordinates and validate them
        for (const pair of pathParts) {
          // Extract coordinates from coordinate pair
          const pairParts = pair.split(",");
          // Ensure we have two coordinates
          if (pairParts.length === 2) {
            const pair = parseCoordinates(pairParts, query, transformer);

            // Ensure coordinates could be parsed and skip them if not
            if (pair === null) {
              continue;
            }

            // Add the coordinate-pair to the current path if they are valid
            currentPath.push(pair);
          }
        }
        // Extend list of paths with current path if it contains coordinates
        if (currentPath.length) {
          paths.push(currentPath);
        }
      }
    }
  }

  return paths;
};

/**
 * Parses marker options provided via query and sets corresponding attributes
 * on marker object.
 * Options adhere to the following format
 * [optionName]:[optionValue]
 * @param {List[String]} optionsList List of option strings.
 * @param {object} marker Marker object to configure.
 */
const parseMarkerOptions = (optionsList, marker) => {
  for (const options of optionsList) {
    const optionParts = options.split(":");
    // Ensure we got an option name and value
    if (optionParts.length < 2) {
      continue;
    }

    switch (optionParts[0]) {
      // Scale factor to up- or downscale icon
      case "scale":
        // Scale factors must not be negative
        marker.scale = Math.abs(parseFloat(optionParts[1]));

        break;

      // Icon offset as positive or negative pixel value in the following
      // format [offsetX],[offsetY] where [offsetY] is optional
      case "offset":
        const providedOffset = optionParts[1].split(",");
        // Set X-axis offset
        marker.offsetX = parseFloat(providedOffset[0]);
        // Check if an offset has been provided for Y-axis
        if (providedOffset.length > 1) {
          marker.offsetY = parseFloat(providedOffset[1]);
        }

        break;
    }
  }
};

/**
 * Parses markers provided via query into a list of marker objects.
 * @param {object} query Request query parameters.
 * @param {object} options Configuration options.
 * @param {Function} transformer Optional transform function.
 */
const extractMarkersFromQuery = (query, options, transformer) => {
  // Return an empty list if no markers have been provided
  if (!query.marker) {
    return [];
  }

  const markers = [];

  // Check if multiple markers have been provided and mimic a list if it's a
  // single maker.
  const providedMarkers = Array.isArray(query.marker)
    ? query.marker
    : [query.marker];

  // Iterate through provided markers which can have one of the following
  // formats
  // [location]|[pathToFileTelativeToConfiguredIconPath]
  // [location]|[pathToFile...]|[option]|[option]|...
  for (const providedMarker of providedMarkers) {
    const markerParts = providedMarker.split("|");
    // Ensure we got at least a location and an icon uri
    if (markerParts.length < 2) {
      continue;
    }

    const locationParts = markerParts[0].split(",");
    // Ensure the locationParts contains two items
    if (locationParts.length !== 2) {
      continue;
    }

    let iconURI = markerParts[1];
    // Check if icon is served via http otherwise marker icons are expected to
    // be provided as filepaths relative to configured icon path
    const isRemoteURL =
      iconURI.startsWith("http://") || iconURI.startsWith("https://");
    const isDataURL = iconURI.startsWith("data:");

    if (!(isRemoteURL || isDataURL)) {
      // Sanitize URI with sanitize-filename
      // https://www.npmjs.com/package/sanitize-filename#details
      iconURI = sanitize(iconURI);

      // If the selected icon is not part of available icons skip it
      if (!options.icons.includes(iconURI)) {
        continue;
      }

      iconURI = path.resolve(options.paths.icons, iconURI);
    }

    // Ensure marker location could be parsed
    const location = parseCoordinates(locationParts, query, transformer);
    if (location === null) {
      continue;
    }

    const marker = {};

    marker.location = location;
    marker.icon = iconURI;

    // Check if options have been provided
    if (markerParts.length > 2) {
      parseMarkerOptions(markerParts.slice(2), marker);
    }

    // Add marker to list
    markers.push(marker);
  }

  return markers;
};

const calcZForBBox = (bbox, w, h, query) => {
  let z = 25;
  const padding = query.padding !== undefined ? parseFloat(query.padding) : 0.1;
  const minCorner = mercator.px([bbox[0], bbox[3]], z);
  const maxCorner = mercator.px([bbox[2], bbox[1]], z);
  const w_ = w / (1 + 2 * padding);
  const h_ = h / (1 + 2 * padding);

  z -=
    Math.max(
      Math.log((maxCorner[0] - minCorner[0]) / w_),
      Math.log((maxCorner[1] - minCorner[1]) / h_)
    ) / Math.LN2;

  z = Math.max(Math.log(Math.max(w, h) / 256) / Math.LN2, Math.min(25, z));

  return z;
};

const respondImage = (
  config,
  item,
  z,
  lon,
  lat,
  bearing,
  pitch,
  width,
  height,
  scale,
  format,
  res,
  overlay = null,
  mode = "tile"
) => {
  if (Math.abs(lon) > 180 || Math.abs(lat) > 85.06) {
    res.header("Content-Type", "text/plain");

    return res.status(400).send("Invalid center");
  }

  if (
    Math.min(width, height) <= 0 ||
    Math.max(width, height) * scale > (config.options.maxSize || 2048)
  ) {
    res.header("Content-Type", "text/plain");

    return res.status(400).send("Invalid size");
  }

  if (format === "png" || format === "webp") {
  } else if (format === "jpg" || format === "jpeg") {
    format = "jpeg";
  } else {
    res.header("Content-Type", "text/plain");

    return res.status(400).send("Invalid format");
  }

  const tileMargin = Math.max(config.options.tileMargin || 0, 0);
  let pool;

  if (mode === "tile" && tileMargin === 0) {
    pool = item.map.renderers[scale];
  } else {
    pool = item.map.renderersStatic[scale];
  }

  pool.acquire((error, renderer) => {
    if (error) {
      printLog("Render error:", error);

      res.header("Content-Type", "text/plain");

      return res.status(500).send(error);
    }

    // For 512px tiles, use the actual maplibre-native zoom. For 256px tiles, use zoom - 1
    let mlglZ;
    if (width === 512) {
      mlglZ = Math.max(0, z);
    } else {
      mlglZ = Math.max(0, z - 1);
    }

    const params = {
      zoom: mlglZ,
      center: [lon, lat],
      bearing,
      pitch,
      width,
      height,
    };

    // HACK(Part 1) 256px tiles are a zoom level lower than maplibre-native default tiles. this hack allows tile-server to support zoom 0 256px tiles, which would actually be zoom -1 in maplibre-native. Since zoom -1 isn't supported, a double sized zoom 0 tile is requested and resized in Part 2.
    if (z === 0 && width === 256) {
      params.width *= 2;
      params.height *= 2;
    }
    // END HACK(Part 1)

    if (z > 0 && tileMargin > 0) {
      params.width += tileMargin * 2;
      params.height += tileMargin * 2;
    }

    renderer.render(params, (error, data) => {
      pool.release(renderer);
      if (error) {
        printLog("Render error:", error);

        res.header("Content-Type", "text/plain");

        return res.status(500).send(error);
      }

      const image = sharp(data, {
        raw: {
          premultiplied: true,
          width: params.width * scale,
          height: params.height * scale,
          channels: 4,
        },
      });

      if (z > 0 && tileMargin > 0) {
        const y = mercator.px(params.center, z)[1];
        const yoffset = Math.max(
          Math.min(0, y - 128 - tileMargin),
          y + 128 + tileMargin - Math.pow(2, z + 8)
        );
        image.extract({
          left: tileMargin * scale,
          top: (tileMargin + yoffset) * scale,
          width: width * scale,
          height: height * scale,
        });
      }

      // HACK(Part 2) 256px tiles are a zoom level lower than maplibre-native default tiles. this hack allows tile-server to support zoom 0 256px tiles, which would actually be zoom -1 in maplibre-native. Since zoom -1 isn't supported, a double sized zoom 0 tile is requested and resized here.
      if (z === 0 && width === 256) {
        image.resize(width * scale, height * scale);
      }
      // END HACK(Part 2)

      const composites = [];
      if (overlay) {
        composites.push({ input: overlay });
      }
      if (item.watermark) {
        const canvas = renderWatermark(width, height, scale, item.watermark);

        composites.push({ input: canvas.toBuffer() });
      }

      if (mode === "static" && item.staticAttributionText) {
        const canvas = renderAttribution(
          width,
          height,
          scale,
          item.staticAttributionText
        );

        composites.push({ input: canvas.toBuffer() });
      }

      if (composites.length > 0) {
        image.composite(composites);
      }

      const formatQuality = config.options.formatQuality?.[format];

      if (format === "png") {
        image.png({ adaptiveFiltering: false });
      } else if (format === "jpeg") {
        image.jpeg({ quality: formatQuality || 80 });
      } else if (format === "webp") {
        image.webp({ quality: formatQuality || 90 });
      }

      image.toBuffer((error, buffer, info) => {
        if (!buffer) {
          res.header("Content-Type", "text/plain");

          return res.status(404).send("Not found");
        }

        res.header("Content-Type", `image/${format}`);

        return res.status(200).send(buffer);
      });
    });
  });
};

export const serve_rendered = {
  init: async (config) => {
    const serveStaticMaps = config.options.serveStaticMaps === true;
    const app = express();

    app.get(
      `/:id/(:tileSize(256|512)/)?:z(\\d+)/:x(\\d+)/:y(\\d+):scale(@\\d+x)?.:format(${FORMAT_PATTERN}{1})`,
      async (req, res, next) => {
        const id = decodeURI(req.params.id);
        const item = config.repo.rendered[id];

        try {
          if (!item) {
            throw Error("Rendered data is not found");
          }

          const z = Number(req.params.z);
          const x = Number(req.params.x);
          const y = Number(req.params.y);
          const maxXY = Math.pow(2, z);

          if (
            !(0 <= z && z <= 22) ||
            !(0 <= x && x < maxXY) ||
            !(0 <= y && y < maxXY)
          ) {
            throw Error("Rendered data is out of bounds");
          }

          const tileCenter = mercator.ll(
            [
              ((x + 0.5) / (1 << z)) * (256 << z),
              ((y + 0.5) / (1 << z)) * (256 << z),
            ],
            z
          );

          const tileSize = Number(req.params.tileSize) || 256;

          return respondImage(
            config,
            item,
            z,
            tileCenter[0],
            tileCenter[1],
            0,
            0,
            tileSize,
            tileSize,
            getScale(req.params.scale),
            req.params.format,
            res
          );
        } catch (error) {
          printLog("error", `Failed to get rendered data "${id}": ${error}`);

          res.header("Content-Type", "text/plain");

          return res.status(404).send("Rendered data is not found");
        }
      }
    );

    if (serveStaticMaps) {
      const staticPattern = `/:id/static/:raw(raw)?/%s/:width(\\d+)x:height(\\d+):scale(@\\d+x)?.:format(${FORMAT_PATTERN}{1})`;
      const centerPattern = util.format(
        ":x(%s),:y(%s),:z(%s)(@:bearing(%s)(,:pitch(%s))?)?",
        FLOAT_PATTERN,
        FLOAT_PATTERN,
        FLOAT_PATTERN,
        FLOAT_PATTERN,
        FLOAT_PATTERN
      );
      const boundsPattern = util.format(
        ":minx(%s),:miny(%s),:maxx(%s),:maxy(%s)",
        FLOAT_PATTERN,
        FLOAT_PATTERN,
        FLOAT_PATTERN,
        FLOAT_PATTERN
      );

      const serveBounds = async (req, res, next) => {
        try {
          const id = decodeURI(req.params.id);
          const item = config.repo.rendered[id];

          if (!item) {
            return res.sendStatus(404);
          }

          const { raw, format } = req.params;
          const minx = Number(req.params.minx) || 0;
          const miny = Number(req.params.miny) || 0;
          const maxx = Number(req.params.maxx) || 0;
          const maxy = Number(req.params.maxy) || 0;
          const width = Number(req.params.width);
          const height = Number(req.params.height);
          const bbox = [minx, miny, maxx, maxy];
          let center = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];

          const transformer = raw
            ? mercator.inverse.bind(mercator)
            : item.dataProjWGStoInternalWGS;

          if (transformer) {
            const minCorner = transformer(bbox.slice(0, 2));
            const maxCorner = transformer(bbox.slice(2));
            bbox[0] = minCorner[0];
            bbox[1] = minCorner[1];
            bbox[2] = maxCorner[0];
            bbox[3] = maxCorner[1];
            center = transformer(center);
          }

          const scale = getScale(req.params.scale);
          const z = calcZForBBox(bbox, width, height, req.query);
          const x = center[0];
          const y = center[1];
          const bearing = 0;
          const pitch = 0;
          const paths = extractPathsFromQuery(req.query, transformer);
          const markers = extractMarkersFromQuery(
            req.query,
            config.options,
            transformer
          );

          const overlay = await renderOverlay(
            z,
            x,
            y,
            bearing,
            pitch,
            width,
            height,
            scale,
            paths,
            markers,
            req.query
          );

          return respondImage(
            config,
            item,
            z,
            x,
            y,
            bearing,
            pitch,
            width,
            height,
            scale,
            format,
            res,
            overlay,
            "static"
          );
        } catch (e) {
          next(e);
        }
      };

      app.get(
        util.format(staticPattern, centerPattern),
        async (req, res, next) => {
          try {
            const id = decodeURI(req.params.id);
            const item = config.repo.rendered[id];

            if (!item) {
              return res.sendStatus(404);
            }

            const { raw, format } = req.params;
            const z = Number(req.params.z) || 0;
            let x = Number(req.params.x) || 0;
            let y = Number(req.params.y) || 0;
            const bearing = Number(req.params.bearing) || 0;
            const pitch = Number(req.params.pitch) || 0;
            const width = Number(req.params.width);
            const height = Number(req.params.height);
            const scale = getScale(req.params.scale);

            if (z < 0) {
              res.header("Content-Type", "text/plain");

              return res.status(400).send("Invalid zoom");
            }

            const transformer = raw
              ? mercator.inverse.bind(mercator)
              : item.dataProjWGStoInternalWGS;

            if (transformer) {
              const ll = transformer([x, y]);
              x = ll[0];
              y = ll[1];
            }

            const paths = extractPathsFromQuery(req.query, transformer);
            const markers = extractMarkersFromQuery(
              req.query,
              config.options,
              transformer
            );

            const overlay = await renderOverlay(
              z,
              x,
              y,
              bearing,
              pitch,
              width,
              height,
              scale,
              paths,
              markers,
              req.query
            );

            return respondImage(
              config,
              item,
              z,
              x,
              y,
              bearing,
              pitch,
              width,
              height,
              scale,
              format,
              res,
              overlay,
              "static"
            );
          } catch (e) {
            next(e);
          }
        }
      );

      app.get(util.format(staticPattern, boundsPattern), serveBounds);

      app.get(
        "/(:tileSize(256|512)/)?rendered.json",
        async (req, res, next) => {
          const { tileSize = "" } = req.params;
          const rendereds = Object.keys(config.repo.rendered);

          const result = rendereds.map((rendered) => {
            const tileJSON = config.repo.rendered[rendered].tileJSON;

            return {
              id: rendered,
              name: tileJSON.name,
              url: `${getUrl(req)}styles/${rendered}/${tileSize}{z}/{x}/{y}.${tileJSON.format}`,
            };
          });

          res.header("Content-Type", "text/plain");

          return res.status(200).send(result);
        }
      );

      app.get("/:id/static/", (req, res, next) => {
        for (const key in req.query) {
          req.query[key.toLowerCase()] = req.query[key];
        }

        req.params.raw = true;
        req.params.format = (req.query.format || "image/png").split("/").pop();
        const bbox = (req.query.bbox || "").split(",");
        req.params.minx = bbox[0];
        req.params.miny = bbox[1];
        req.params.maxx = bbox[2];
        req.params.maxy = bbox[3];
        req.params.width = req.query.width || "256";
        req.params.height = req.query.height || "256";

        if (req.query.scale) {
          req.params.width /= req.query.scale;
          req.params.height /= req.query.scale;
          req.params.scale = `@${req.query.scale}`;
        }

        return serveBounds(req, res, next);
      });

      app.get(util.format(staticPattern, "auto"), async (req, res, next) => {
        try {
          const id = decodeURI(req.params.id);
          const item = config.repo.rendered[id];

          if (!item) {
            return res.sendStatus(404);
          }

          const { raw, format } = req.params;
          const width = Number(req.params.width);
          const height = Number(req.params.height);
          const scale = getScale(req.params.scale);

          const transformer = raw
            ? mercator.inverse.bind(mercator)
            : item.dataProjWGStoInternalWGS;

          const paths = extractPathsFromQuery(req.query, transformer);
          const markers = extractMarkersFromQuery(
            req.query,
            config.options,
            transformer
          );

          // Extract coordinates from markers
          const markerCoordinates = [];
          for (const marker of markers) {
            markerCoordinates.push(marker.location);
          }

          // Create array with coordinates from markers and path
          const coords = [].concat(paths.flat()).concat(markerCoordinates);

          // Check if we have at least one coordinate to calculate a bounding box
          if (coords.length < 1) {
            res.header("Content-Type", "text/plain");

            return res.status(400).send("No coordinates provided");
          }

          const bbox = [Infinity, Infinity, -Infinity, -Infinity];
          for (const pair of coords) {
            bbox[0] = Math.min(bbox[0], pair[0]);
            bbox[1] = Math.min(bbox[1], pair[1]);
            bbox[2] = Math.max(bbox[2], pair[0]);
            bbox[3] = Math.max(bbox[3], pair[1]);
          }

          const bbox_ = mercator.convert(bbox, "900913");
          const center = mercator.inverse([
            (bbox_[0] + bbox_[2]) / 2,
            (bbox_[1] + bbox_[3]) / 2,
          ]);

          // Calculate zoom level
          const maxZoom = parseFloat(req.query.maxzoom);
          let z = calcZForBBox(bbox, width, height, req.query);
          if (maxZoom > 0) {
            z = Math.min(z, maxZoom);
          }

          const overlay = await renderOverlay(
            z,
            center[0],
            center[1],
            0,
            0,
            width,
            height,
            scale,
            paths,
            markers,
            req.query
          );

          return respondImage(
            config,
            item,
            z,
            center[0],
            center[1],
            0,
            0,
            width,
            height,
            scale,
            format,
            res,
            overlay,
            "static"
          );
        } catch (e) {
          next(e);
        }
      });
    }

    app.get("/(:tileSize(256|512)/)?:id.json", async (req, res, next) => {
      const id = decodeURI(req.params.id);
      const item = config.repo.rendered[id];

      try {
        if (!item) {
          throw Error("Rendered data is not found");
        }

        const info = {
          ...item.tileJSON,
          tiles: getTileUrls(
            req,
            item.tileJSON.tiles,
            `styles/${id}`,
            Number(req.params.tileSize),
            item.tileJSON.format
          ),
        };

        res.header("Content-type", "application/json");

        return res.status(200).send(info);
      } catch (error) {
        printLog("error", `Failed to get rendered data "${id}": ${error}`);

        res.header("Content-Type", "text/plain");

        return res.status(404).send("Rendered data is not found");
      }
    });

    return app;
  },

  add: async (config) => {
    const createPool = (map, style, styleJSON, ratio, mode, min, max) => {
      const createRenderer = (ratio, createCallback) => {
        const renderer = new mlgl.Map({
          mode,
          ratio,
          request: async (req, callback) => {
            const protocol = req.url.split(":")[0];

            if (protocol === "sprites") {
              const filePath = path.join(
                config.options.paths.sprites,
                decodeURIComponent(req.url).substring(protocol.length + 3)
              );

              fs.readFile(filePath, (error, data) => {
                callback(error, {
                  data: data,
                });
              });
            } else if (protocol === "fonts") {
              const parts = decodeURIComponent(req.url).split("/");
              const fonts = parts[2];
              const range = parts[3].split(".")[0];

              try {
                callback(null, {
                  data: await getFontsPbf(
                    config.options.paths.fonts,
                    fonts,
                    range
                  ),
                });
              } catch (error) {
                callback(error, {
                  data: null,
                });
              }
            } else if (protocol === "mbtiles" || protocol === "pmtiles") {
              const parts = decodeURIComponent(req.url).split("/");
              const sourceId = parts[2];
              const source = map.sources[sourceId];
              const sourceType = map.sourceTypes[sourceId];
              const sourceInfo = styleJSON.sources[sourceId];
              const z = Number(parts[3]) || 0;
              const x = Number(parts[4]) || 0;
              const y = Number(parts[5]?.split(".")[0]) || 0;
              const format = parts[5]?.split(".")[1] || "";

              if (sourceType === "mbtiles") {
                source.getTile(z, x, y, (error, data) => {
                  if (error) {
                    printLog(
                      "warning",
                      `MBTiles source "${sourceId}" error: ${error}. Serving empty`
                    );

                    createEmptyResponse(
                      sourceInfo.format,
                      sourceInfo.color,
                      callback
                    );

                    return;
                  }

                  const response = {};

                  if (format === "pbf") {
                    try {
                      response.data = zlib.unzipSync(data);
                    } catch (error) {
                      printLog(
                        "error",
                        `Skipping incorrect header for tile mbtiles://${style}/${z}/${x}/${y}.pbf`
                      );
                    }
                  } else {
                    response.data = data;
                  }

                  callback(null, response);
                });
              } else if (sourceType === "pmtiles") {
                const { data } = await getPMtilesTile(source, z, x, y);

                if (!data) {
                  printLog(
                    "warning",
                    `PMTiles source "${sourceId}" error: ${error}. Serving empty`
                  );

                  createEmptyResponse(
                    sourceInfo.format,
                    sourceInfo.color,
                    callback
                  );

                  return;
                }

                callback(null, {
                  data: data,
                });
              }
            } else if (protocol === "http" || protocol === "https") {
              try {
                const { data } = await axios.get(req.url, {
                  responseType: "arraybuffer",
                });

                callback(null, {
                  data: data,
                });
              } catch (error) {
                const ext = path
                  .extname(url.parse(req.url).pathname)
                  .toLowerCase();

                createEmptyResponse(extensionToFormat[ext], "", callback);
              }
            }
          },
        });

        renderer.load(styleJSON);

        createCallback(null, renderer);
      };

      return new advancedPool.Pool({
        min,
        max,
        create: createRenderer.bind(null, ratio),
        destroy: (renderer) => {
          renderer.release();
        },
      });
    };

    const styles = Object.keys(config.repo.styles);

    await Promise.all(
      styles.map(async (style) => {
        const item = config.styles[style];
        const map = {
          renderers: [],
          renderersStatic: [],
          sources: {},
          sourceTypes: {},
        };

        try {
          const file = fs.readFileSync(
            path.join(config.options.paths.styles, item.style)
          );

          const styleJSON = JSON.parse(file);

          const tileJSON = {
            tilejson: "2.2.0",
            name: styleJSON.name,
            attribution: "",
            minzoom: 0,
            maxzoom: 24,
            bounds: [-180, -85.0511, 180, 85.0511],
            format: "png",
            type: "baselayer",
            tiles: config.options.domains,
          };

          const attributionOverride = !!item.tilejson?.attribution;

          if (styleJSON.center?.length === 2 && styleJSON.zoom) {
            tileJSON.center = styleJSON.center.concat(
              Math.round(styleJSON.zoom)
            );
          }

          Object.assign(tileJSON, item.tilejson);

          fixTileJSONCenter(tileJSON);

          const repoobj = {
            tileJSON,
            map,
            dataProjWGStoInternalWGS: null,
            watermark: item.watermark || config.options.watermark,
            staticAttributionText:
              item.staticAttributionText ||
              config.options.staticAttributionText,
          };

          config.repo.rendered[style] = repoobj;

          const queue = [];
          const sources = Object.keys(styleJSON.sources);
          for (const name of sources) {
            const source = styleJSON.sources[name];

            if (
              source.url?.startsWith("pmtiles://") ||
              source.url?.startsWith("mbtiles://")
            ) {
              const sourceURL = source.url.slice(10);

              // found pmtiles or mbtiles source, replace with info from local file
              delete source.url;

              if (!sourceURL.startsWith("{") || !sourceURL.endsWith("}")) {
                throw Error(`Source data "${name}" is invalid`);
              }

              const sourceID = sourceURL.slice(1, -1);

              if (config.repo.data[sourceID]?.sourceType === "mbtiles") {
                queue.push(
                  new Promise((resolve, reject) => {
                    const inputFile = path.resolve(
                      config.options.paths.mbtiles,
                      config.data[sourceID].mbtiles
                    );

                    const stat = fs.statSync(inputFile);
                    if (stat.isFile() === false || stat.size === 0) {
                      throw Error(`MBTiles source data "${name}" is invalid`);
                    }

                    map.sourceTypes[name] = "mbtiles";
                    map.sources[name] = new MBTiles(
                      inputFile + "?mode=ro",
                      (error, mbtiles) => {
                        if (error) {
                          reject(error);
                        }

                        mbtiles.getInfo((error, info) => {
                          if (error) {
                            reject(error);
                          }

                          if (!repoobj.dataProjWGStoInternalWGS && info.proj4) {
                            // how to do this for multiple sources with different proj4 defs?
                            const to3857 = proj4("EPSG:3857");
                            const toDataProj = proj4(info.proj4);
                            repoobj.dataProjWGStoInternalWGS = (xy) =>
                              to3857.inverse(toDataProj.forward(xy));
                          }

                          const type = source.type;

                          Object.assign(source, info);

                          source.type = type;
                          source.tiles = [
                            // meta url which will be detected when requested
                            `mbtiles://${name}/{z}/{x}/{y}.${info.format || "pbf"}`,
                          ];

                          if (
                            !attributionOverride &&
                            source.attribution?.length > 0
                          ) {
                            if (
                              !tileJSON.attribution.includes(source.attribution)
                            ) {
                              if (tileJSON.attribution.length > 0) {
                                tileJSON.attribution += " | ";
                              }

                              tileJSON.attribution += source.attribution;
                            }
                          }

                          resolve();
                        });
                      }
                    );
                  })
                );
              } else if (config.repo.data[sourceID]?.sourceType === "pmtiles") {
                const inputFile = path.join(
                  config.options.paths.pmtiles,
                  config.data[sourceID].pmtiles
                );

                const stat = fs.statSync(inputFile);
                if (stat.isFile() === false || stat.size === 0) {
                  throw Error(`PMTiles source data "${name}" is invalid`);
                }

                map.sources[name] = openPMtiles(inputFile);
                map.sourceTypes[name] = "pmtiles";

                const metadata = await getPMtilesInfo(map.sources[name]);

                if (!repoobj.dataProjWGStoInternalWGS && metadata.proj4) {
                  // how to do this for multiple sources with different proj4 defs?
                  const to3857 = proj4("EPSG:3857");
                  const toDataProj = proj4(metadata.proj4);
                  repoobj.dataProjWGStoInternalWGS = (xy) =>
                    to3857.inverse(toDataProj.forward(xy));
                }

                const type = source.type;

                Object.assign(source, metadata);

                source.type = type;
                source.tiles = [
                  // meta url which will be detected when requested
                  `pmtiles://${name}/{z}/{x}/{y}.${metadata.format || "pbf"}`,
                ];

                if (!attributionOverride && source.attribution?.length > 0) {
                  if (!tileJSON.attribution.includes(source.attribution)) {
                    if (tileJSON.attribution.length > 0) {
                      tileJSON.attribution += " | ";
                    }

                    tileJSON.attribution += source.attribution;
                  }
                }
              }
            }
          }

          await Promise.all(queue);

          // standard and @2x tiles are much more usual -> default to larger pools
          const minPoolSizes = config.options.minRendererPoolSizes || [8, 4, 2];
          const maxPoolSizes = config.options.maxRendererPoolSizes || [
            16, 8, 4,
          ];

          for (let s = 1; s <= (config.options.maxScaleFactor || 1); s++) {
            const i = Math.min(minPoolSizes.length - 1, s - 1);
            const j = Math.min(maxPoolSizes.length - 1, s - 1);
            const minPoolSize = minPoolSizes[i];
            const maxPoolSize = Math.max(minPoolSize, maxPoolSizes[j]);

            map.renderers[s] = createPool(
              map,
              style,
              styleJSON,
              s,
              "tile",
              minPoolSize,
              maxPoolSize
            );

            map.renderersStatic[s] = createPool(
              map,
              style,
              styleJSON,
              s,
              "static",
              minPoolSize,
              maxPoolSize
            );
          }
        } catch (error) {
          printLog(
            "error",
            `Failed to load rendered data "${style}": ${error}. Skipping...`
          );
        }
      })
    );
  },

  remove: async (config) => {
    const rendereds = Object.keys(config.repo.rendered);

    await Promise.all(
      rendereds.map(async (rendered) => {
        config.repo.rendered[rendered].map.renderers.forEach((pool) => {
          pool.close();
        });

        config.repo.rendered[rendered].map.renderersStatic.forEach((pool) => {
          pool.close();
        });
      })
    );

    config.repo.rendered = {};
  },
};
