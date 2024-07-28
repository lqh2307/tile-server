"use strict";

import fs from "node:fs";
import path from "node:path";
import Color from "color";
import axios from "axios";
import sharp from "sharp";
import sqlite3 from "sqlite3";
import glyphCompose from "@mapbox/glyph-pbf-composite";
import SphericalMercator from "@mapbox/sphericalmercator";
import tiletype from "@mapbox/tiletype";
import { PMTiles, FetchSource } from "pmtiles";

export const mercator = new SphericalMercator();

const emptyBufferColor = Buffer.from(new Color("rgba(255,255,255,0)").array());
const emptyBuffer = Buffer.alloc(0);

const fallbackFont = "Open Sans Regular";

/**
 * Create an empty tile response
 * @param {string} format tile format
 * @param {Function} callback mlgl callback
 * @returns {void}
 */
export function responseEmptyTile(format, callback) {
  if (["jpeg", "jpg", "png", "webp"].includes(format) === true) {
    // sharp lib not support jpg format
    if (format === "jpg") {
      format = "jpeg";
    }

    sharp(emptyBufferColor, {
      raw: {
        premultiplied: true,
        width: 1,
        height: 1,
        channels: format === "jpeg" ? 3 : 4,
      },
    })
      .toFormat(format)
      .toBuffer()
      .then((data) => {
        callback(null, {
          data: data,
        });
      })
      .catch((error) => {
        callback(error, {
          data: null,
        });
      });
  } else {
    /* pbf and other formats */
    callback(null, {
      data: emptyBuffer,
    });
  }
}

/**
 * Find matching files in directory
 * @param {string} dirPath
 * @param {RegExp} regex
 * @returns {string[]}
 */
export function findFiles(dirPath, regex) {
  const fileNames = fs.readdirSync(dirPath);

  return fileNames.filter((fileName) => {
    const filePath = path.join(dirPath, fileName);

    const stat = fs.statSync(filePath);

    return regex.test(fileName) === true && stat.isFile() === true;
  });
}

/**
 * Get host URL from request
 * @param {Request} req
 * @returns {string}
 */
export function getURL(req) {
  const urlObject = new URL(`${req.protocol}://${req.headers.host}/`);

  // support overriding hostname by sending X-Forwarded-Host http header
  urlObject.hostname = req.hostname;

  // support add url prefix by sending X-Forwarded-Path http header
  const xForwardedPath = req.get("X-Forwarded-Path");
  if (xForwardedPath) {
    urlObject.pathname = path.posix.join(xForwardedPath, urlObject.pathname);
  }

  return urlObject.toString();
}

/**
 *
 * @param {string} fontPath
 * @param {string} ids
 * @param {string} range
 * @returns {Promise<any>}
 * @returns
 */
export async function getFontsPBF(fontPath, ids, range) {
  const values = await Promise.all(
    ids.split(",").map(async (id) => {
      try {
        const filePath = path.join(fontPath, id, `${range}.pbf`);

        return fs.readFileSync(filePath);
      } catch (_) {
        printLog(
          "warning",
          `Failed to get font "${id}": Font is not found. Using fallback font "${fallbackFont}"...`
        );

        const filePath = path.resolve(
          "public",
          "resources",
          "template",
          "fonts",
          fallbackFont,
          `${range}.pbf`
        );

        return fs.readFileSync(filePath);
      }
    })
  );

  return glyphCompose.combine(values);
}

/**
 * Print log to console
 * @param {"debug"|"info"|"warning"|"error"} level
 * @param {string} msg
 * @returns {void}
 */
export function printLog(level, msg) {
  const dateTime = new Date().toISOString();

  if (level === "debug") {
    console.debug(`${dateTime} [DEBUG] ${msg}`);
  } else if (level === "warning") {
    console.warn(`${dateTime} [WARNING] ${msg}`);
  } else if (level === "error") {
    console.error(`${dateTime} [ERROR] ${msg}`);
  } else {
    console.info(`${dateTime} [INFO] ${msg}`);
  }
}

/**
 * Validate font
 * @param {string} pbfDirPath
 * @returns {Promise<void>}
 */
export async function validateFont(pbfDirPath) {
  const pbfFileNames = findFiles(pbfDirPath, /^\d{1,5}-\d{1,5}\.pbf$/);

  if (pbfFileNames.length !== 256) {
    throw new Error(`Pbf file count is not equal 256`);
  }
}

/**
 * Validate metadata info
 * @param {object} info
 * @returns {Promise<void>}
 */
export async function validateDataInfo(info) {
  /* Validate name */
  if (info.name === undefined) {
    throw new Error(`Data name info is invalid`);
  }

  /* Validate type */
  if (info.type !== undefined) {
    if (["baselayer", "overlay"].includes(info.type) === false) {
      throw new Error(`Data type info is invalid`);
    }
  }

  /* Validate format */
  if (["jpeg", "jpg", "pbf", "png", "webp"].includes(info.format) === false) {
    throw new Error(`Data format info is invalid`);
  }

  /* Validate vector_layers */
  if (info.format === "pbf" && info.vector_layers === undefined) {
    throw new Error(`Data vector_layers info is invalid`);
  }

  /* Validate minzoom */
  if (info.minzoom !== undefined) {
    if (info.minzoom < 0 || info.maxzoom > 22) {
      throw new Error(`Data minzoom info is invalid`);
    }
  }

  /* Validate maxzoom */
  if (info.maxzoom !== undefined) {
    if (info.maxzoom < 0 || info.maxzoom > 22) {
      throw new Error(`Data maxzoom info is invalid`);
    }
  }

  /* Validate minzoom & maxzoom */
  if (info.minzoom !== undefined && info.maxzoom !== undefined) {
    if (info.minzoom > info.maxzoom) {
      throw new Error(`Data zoom info is invalid`);
    }
  }

  /* Validate bounds */
  if (info.bounds !== undefined) {
    if (
      info.bounds.length !== 4 ||
      Math.abs(info.bounds[0]) > 180 ||
      Math.abs(info.bounds[2]) > 180 ||
      Math.abs(info.bounds[1]) > 90 ||
      Math.abs(info.bounds[3]) > 90
    ) {
      throw new Error(`Data bounds info is invalid`);
    }
  }

  /* Validate center */
  if (info.center !== undefined) {
    if (
      info.center.length !== 3 ||
      Math.abs(info.center[0]) > 180 ||
      Math.abs(info.center[1]) > 90 ||
      info.center[2] < 0 ||
      info.center[2] > 22
    ) {
      throw new Error(`Data center info is invalid`);
    }
  }
}

/**
 * Validate sprite
 * @param {string} spriteDirPath
 * @returns {Promise<void>}
 */
export async function validateSprite(spriteDirPath) {
  const jsonSpriteFileNames = findFiles(
    spriteDirPath,
    /^sprite(@\d+x)?\.json$/
  );

  if (jsonSpriteFileNames.length === 0) {
    throw new Error(`Not found json sprite file`);
  }

  await Promise.all(
    jsonSpriteFileNames.map(async (jsonSpriteFileName) => {
      /* Validate JSON sprite */
      const jsonFilePath = path.join(spriteDirPath, jsonSpriteFileName);

      const jsonData = JSON.parse(fs.readFileSync(jsonFilePath, "utf8"));

      Object.values(jsonData).forEach((value) => {
        if (
          typeof value !== "object" ||
          "height" in value === false ||
          "pixelRatio" in value === false ||
          "width" in value === false ||
          "x" in value === false ||
          "y" in value === false
        ) {
          throw new Error(
            `One of properties ("height", "pixelRatio", "width", "x", "y") is empty`
          );
        }
      });

      /* Validate PNG sprite */
      const pngFilePath = path.join(
        spriteDirPath,
        `${path.basename(jsonSpriteFileName, ".json")}.png`
      );

      const pngMetadata = await sharp(pngFilePath).metadata();

      if (pngMetadata.format !== "png") {
        throw new Error("Invalid png sprite file");
      }
    })
  );
}

/**
 *
 * @param {object} repo
 * @param {string} repoFilePath
 */
export function createRepoFile(repo, repoFilePath) {
  function getCircularReplacer() {
    const seen = new WeakMap();
    const paths = new Map();

    return (key, value) => {
      if (typeof value === "object" && value !== null) {
        if (seen.has(value)) {
          return;
        }

        seen.set(value, true);
        paths.set(value, key);
      }

      return value;
    };
  }

  const jsonData = JSON.stringify(repo, getCircularReplacer(), 2);

  fs.writeFileSync(repoFilePath, jsonData, "utf8");
}

/**
 * Download file
 * @param {string} url
 * @param {string} outputPath
 * @param {boolean} overwrite
 * @returns {Promise<string>}
 * @returns
 */
export async function downloadFile(url, outputPath, overwrite = false) {
  try {
    const stat = fs.statSync(outputPath);

    if (stat.isFile() === true && stat.size > 0 && overwrite === false) {
      return outputPath;
    }
  } catch (_) {}

  const dirPath = path.dirname(outputPath);

  fs.mkdirSync(dirPath, {
    recursive: true,
  });

  const response = await axios({
    url,
    method: "GET",
    responseType: "stream",
  });

  return new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(outputPath);

    response.data.pipe(writer);

    writer.on("error", (error) => {
      writer.close(() => reject(error));
    });

    writer.on("finish", () => {
      writer.close(() => resolve(outputPath));
    });
  });
}

/**
 * Private class for PMTiles
 */
class PMTilesFileSource {
  constructor(fd) {
    this.fd = fd;
  }

  getKey() {
    return this.fd;
  }

  async getBytes(offset, length) {
    const buffer = Buffer.alloc(length);

    fs.readSync(this.fd, buffer, 0, buffer.length, offset);

    return {
      data: buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
      ),
    };
  }
}

/**
 * Open PMTiles
 * @param {string} filePath
 * @returns {Promise<object>}
 */
export async function openPMTiles(filePath) {
  let source;

  if (
    filePath.startsWith("https://") === true ||
    filePath.startsWith("http://") === true
  ) {
    source = new FetchSource(filePath);
  } else {
    source = new PMTilesFileSource(fs.openSync(filePath, "r"));
  }

  return new PMTiles(source);
}

/**
 * Get PMTiles metadata
 * @param {object} pmtilesSource
 * @returns {Promise<object>}
 */
export async function getPMTilesInfo(pmtilesSource) {
  const [header, metadata] = await Promise.all([
    pmtilesSource.getHeader(),
    pmtilesSource.getMetadata(),
  ]);

  if (header.tileType === 1) {
    metadata.format = "pbf";
  } else if (header.tileType === 2) {
    metadata.format = "png";
  } else if (header.tileType === 3) {
    metadata.format = "jpeg";
  } else if (header.tileType === 4) {
    metadata.format = "webp";
  }

  if (header.minZoom !== undefined) {
    metadata.minzoom = Number(header.minZoom);
  }

  if (header.maxZoom !== undefined) {
    metadata.maxzoom = Number(header.maxZoom);
  }

  if (
    header.minLon !== undefined &&
    header.minLat !== undefined &&
    header.maxLon !== undefined &&
    header.maxLat !== undefined
  ) {
    metadata.bounds = [
      Number(header.minLon),
      Number(header.minLat),
      Number(header.maxLon),
      Number(header.maxLat),
    ];
  }

  if (
    header.centerLon !== undefined &&
    header.centerLat !== undefined &&
    header.centerZoom !== undefined
  ) {
    metadata.center = [
      Number(header.centerLon),
      Number(header.centerLat),
      Number(header.centerZoom),
    ];
  }

  return metadata;
}

/**
 * Get PMTiles tile
 * @param {object} pmtilesSource
 * @param {number} z
 * @param {number} x
 * @param {number} y
 * @returns {Promise<object>}
 */
export async function getPMTilesTile(pmtilesSource, z, x, y) {
  const zxyTile = await pmtilesSource.getZxy(z, x, y);

  if (!zxyTile?.data) {
    throw new Error("Tile does not exist");
  }

  const header = await pmtilesSource.getHeader();
  const headers = tiletype.headers(zxyTile.data);

  if (header.tileType === 1) {
    headers["Content-Type"] = "application/x-protobuf";
  } else if (header.tileType === 2) {
    headers["Content-Type"] = "image/png";
  } else if (header.tileType === 3) {
    headers["Content-Type"] = "image/jpeg";
  } else if (header.tileType === 4) {
    headers["Content-Type"] = "image/webp";
  }

  return {
    data: zxyTile.data,
    headers: headers,
  };
}

/**
 * Open MBTiles
 * @param {string} filePath
 * @returns {Promise<object>}
 */
export async function openMBTiles(filePath) {
  return new Promise((resolve, reject) => {
    const mbtilesSource = new sqlite3.Database(
      filePath,
      sqlite3.OPEN_READONLY,
      (error) => {
        if (error) {
          reject(error);
        } else {
          resolve(mbtilesSource);
        }
      }
    );
  });
}

/**
 * Get MBTiles tile
 * @param {object} mbtilesSource
 * @param {number} z
 * @param {number} x
 * @param {number} y
 * @returns {Promise<object>}
 */
export async function getMBTilesTile(mbtilesSource, z, x, y) {
  return new Promise((resolve, reject) => {
    y = (1 << z) - 1 - y; // Flip Y to convert TMS scheme => XYZ scheme

    mbtilesSource.get(
      "SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?",
      z,
      x,
      y,
      (err, row) => {
        if (err) {
          reject(err);
        } else if (!row?.tile_data) {
          reject(new Error("Tile does not exist"));
        } else {
          resolve({
            data: row.tile_data,
            headers: tiletype.headers(row.tile_data),
          });
        }
      }
    );
  });
}

/**
 * Get MBTiles info
 * @param {object} mbtilesSource
 * @returns {Promise<object>}
 */
export async function getMBTilesInfo(mbtilesSource) {
  return new Promise((resolve, reject) => {
    mbtilesSource.all("SELECT name, value FROM metadata", (err, rows) => {
      if (err) {
        reject(err);
      }

      const info = {};

      if (rows) {
        rows.forEach((row) => {
          switch (row.name) {
            case "json":
              try {
                Object.assign(info, JSON.parse(row.value));
              } catch (err) {
                reject(err);
              }

              break;
            case "minzoom":
            case "maxzoom":
              info[row.name] = Number(row.value);

              break;
            case "center":
            case "bounds":
              info[row.name] = row.value.split(",").map((elm) => Number(elm));

              break;
            default:
              info[row.name] = row.value;

              break;
          }
        });
      }

      info.scheme = "xyz"; // Guarantee scheme always is XYZ

      resolve(info);
    });
  });
}

/**
 * Close MBTiles
 * @param {object} mbtilesSource
 * @returns {Promise<void>}
 */
export async function closeMBTiles(mbtilesSource) {
  return new Promise((resolve, reject) => {
    mbtilesSource.close((err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}
