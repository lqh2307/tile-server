"use strict";

import fs from "node:fs";
import path from "node:path";
import Color from "color";
import axios from "axios";
import sharp from "sharp";
import MBTiles from "@mapbox/mbtiles";
import glyphCompose from "@mapbox/glyph-pbf-composite";
import { PMTiles, FetchSource } from "pmtiles";

/**
 * Create an appropriate mlgl response for http errors
 * @param {string} format tile format
 * @param {Function} callback mlgl callback
 */
export function responseEmptyTile(format, callback) {
  if (["jpeg", "jpg", "png", "webp", "avif"].includes(format) === true) {
    // sharp lib not support jpg format
    if (format === "jpg") {
      format = "jpeg";
    }

    const color = new Color("rgba(255,255,255,0)");
    sharp(Buffer.from(color.array()), {
      raw: {
        width: 1,
        height: 1,
        channels: format === "jpeg" ? 3 : 4,
      },
    })
      .toFormat(format)
      .toBuffer((_, buffer) => {
        callback(null, {
          data: buffer,
        });
      });
  } else {
    /* pbf and other formats */
    callback(null, {
      data: Buffer.alloc(0),
    });
  }
}

/**
 * Find files in directory
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
 * Replace local url by http(s) url
 * @param {Request} req
 * @param {string} url
 * @Returns {string}
 */
export function fixURL(req, url) {
  if (url !== undefined) {
    if (
      url.startsWith("mbtiles://") === true ||
      url.startsWith("pmtiles://") === true
    ) {
      return `${getURL(req)}data/${url.slice(11, -1)}.json`;
    } else if (url.startsWith("sprites://") === true) {
      return url.replace("sprites://", `${getURL(req)}sprites/`);
    } else if (url.startsWith("fonts://") === true) {
      return url.replace("fonts://", `${getURL(req)}fonts/`);
    }
  }

  return url;
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
 * Add missing infos
 * @param {object} tileJSON
 */
export function fixTileJSON(tileJSON) {
  if (tileJSON.tilejson === undefined) {
    tileJSON.tilejson = "2.2.0";
  }

  if (tileJSON.type === undefined) {
    tileJSON.type = "baselayer";
  }

  if (tileJSON.bounds === undefined) {
    tileJSON.bounds = [-180, -85.051128779807, 180, 85.051128779807];
  }

  if (tileJSON.center === undefined) {
    // 360 / tiles = 360 / 4 = 90
    tileJSON.center = [
      (tileJSON.bounds[0] + tileJSON.bounds[2]) / 2,
      (tileJSON.bounds[1] + tileJSON.bounds[3]) / 2,
      Math.round(
        -Math.log((tileJSON.bounds[2] - tileJSON.bounds[0]) / 90) / Math.LN2
      ),
    ];
  }

  if (tileJSON.minzoom === undefined) {
    tileJSON.minzoom = 0;
  }

  if (tileJSON.maxzoom === undefined) {
    tileJSON.maxzoom = 22;
  }
}

export async function getFontsPBF(fontPath, names, range) {
  const fonts = names.split(",");

  const values = await Promise.all(
    fonts.map(async (font) => {
      try {
        const filePath = path.join(fontPath, font, `${range}.pbf`);

        return fs.readFileSync(filePath);
      } catch (error) {
        const fallbackFont = "Open Sans Regular";

        printLog(
          "warning",
          `Failed to get font "${font}": ${error}. Using fallback font "${fallbackFont}"...`
        );

        const filePath = path.resolve(
          "public",
          "resources",
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

export async function validateFont(pbfDirPath) {
  try {
    const pbfFileNames = findFiles(pbfDirPath, /^\d{1,5}-\d{1,5}\.pbf$/);

    if (pbfFileNames.length !== 256) {
      throw Error(`Pbf file count is not equal 256`);
    }
  } catch (error) {
    throw error;
  }
}

export async function validateSprite(spriteDirPath) {
  try {
    const jsonSpriteFileNames = findFiles(
      spriteDirPath,
      /^sprite(@\d+x)?\.json$/
    );

    if (jsonSpriteFileNames.length === 0) {
      throw Error(`Not found json sprite file`);
    }

    await Promise.all(
      jsonSpriteFileNames.map(async (jsonSpriteFileName) => {
        /* Validate JSON sprite */
        const jsonFilePath = path.join(spriteDirPath, jsonSpriteFileName);

        const jsonFile = fs.readFileSync(jsonFilePath, "utf8");

        const jsonData = JSON.parse(jsonFile);

        Object.values(jsonData).forEach((value) => {
          if (
            typeof value !== "object" ||
            "height" in value === false ||
            "pixelRatio" in value === false ||
            "width" in value === false ||
            "x" in value === false ||
            "y" in value === false
          ) {
            throw Error(
              `One of properties ("height", "pixelRatio", "width", "x", "y") is empty`
            );
          }
        });

        /* Validate PNG sprite */
        const pngFilePath = path.join(
          spriteDirPath,
          `${jsonSpriteFileName.slice(0, jsonSpriteFileName.lastIndexOf(".json"))}.png`
        );

        const pngMetadata = await sharp(pngFilePath).metadata();

        if (pngMetadata.format !== "png") {
          throw Error("Invalid png sprite file");
        }
      })
    );
  } catch (error) {
    throw error;
  }
}

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

export function printUsedMemory(interval) {
  setInterval(() => {
    const memoryUsage = process.memoryUsage();

    console.log(`===============================`);

    console.log({
      rss: memoryUsage.rss,
      heapTotal: memoryUsage.heapTotal,
      heapUsed: memoryUsage.heapUsed,
      external: memoryUsage.external,
    });
  }, interval);
}

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

    writer.on("error", (err) => {
      writer.close(() => reject(err));
    });

    writer.on("finish", () => {
      writer.close(() => resolve(outputPath));
    });
  });
}

export async function openPMTiles(filePath) {
  let source;

  if (
    filePath.startsWith("https://") === true ||
    filePath.startsWith("http://") === true
  ) {
    source = new FetchSource(filePath);
  } else {
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

        const data = buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength
        );

        return {
          data: data,
        };
      }
    }

    source = new PMTilesFileSource(fs.openSync(filePath, "r"));
  }

  return new PMTiles(source);
}

export async function getPMTilesInfo(pmtilesSource) {
  const header = await pmtilesSource.getHeader();
  const metadata = await pmtilesSource.getMetadata();

  // Add missing metadata from header
  if (header.tileType === 1) {
    metadata.format = "pbf";
  } else if (header.tileType === 2) {
    metadata.format = "png";
  } else if (header.tileType === 3) {
    metadata.format = "jpeg";
  } else if (header.tileType === 4) {
    metadata.format = "webp";
  } else if (header.tileType === 5) {
    metadata.format = "avif";
  }

  if (header.minZoom) {
    metadata.minzoom = header.minZoom;
  } else {
    metadata.minzoom = 0;
  }

  if (header.maxZoom) {
    metadata.maxzoom = header.maxZoom;
  } else {
    metadata.maxzoom = 22;
  }

  if (header.minLon && header.minLat && header.maxLon && header.maxLat) {
    metadata.bounds = [
      header.minLon,
      header.minLat,
      header.maxLon,
      header.maxLat,
    ];
  } else {
    metadata.bounds = [-180, -85.051128779807, 180, 85.051128779807];
  }

  if (header.centerZoom) {
    metadata.center = [header.centerLon, header.centerLat, header.centerZoom];
  } else {
    metadata.center = [
      header.centerLon,
      header.centerLat,
      parseInt(metadata.maxzoom) / 2,
    ];
  }

  return metadata;
}

export async function getPMTilesTile(pmtilesSource, z, x, y) {
  const header = await pmtilesSource.getHeader();

  const headers = {};

  if (header.tileType === 1) {
    headers["Content-Type"] = "application/x-protobuf";
  } else if (header.tileType === 2) {
    headers["Content-Type"] = "image/png";
  } else if (header.tileType === 3) {
    headers["Content-Type"] = "image/jpeg";
  } else if (header.tileType === 4) {
    headers["Content-Type"] = "image/webp";
  } else if (header.tileType === 5) {
    headers["Content-Type"] = "image/avif";
  }

  const zxyTile = await pmtilesSource.getZxy(z, x, y);

  return {
    data: zxyTile?.data ? Buffer.from(zxyTile.data) : zxyTile,
    headers: headers,
  };
}

export async function openMBTiles(filePath) {
  return new Promise((resolve, reject) => {
    new MBTiles(filePath + "?mode=ro", (error, mbtiles) => {
      if (error) {
        return reject(error);
      }

      resolve(mbtiles);
    });
  });
}

export async function getMBTilesInfo(mbtilesSource) {
  return new Promise((resolve, reject) => {
    mbtilesSource.getInfo((error, info) => {
      if (error) {
        return reject(error);
      }

      resolve(info);
    });
  });
}

export async function getMBTilesTile(mbtilesSource, z, x, y) {
  return new Promise((resolve, reject) => {
    mbtilesSource.getTile(z, x, y, (error, data, headers) => {
      if (error) {
        reject(error);
      }

      resolve({
        data: data,
        headers: headers || {},
      });
    });
  });
}
