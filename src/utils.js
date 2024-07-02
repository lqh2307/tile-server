"use strict";

import glyphCompose from "@mapbox/glyph-pbf-composite";
import MBTiles from "@mapbox/mbtiles";
import path from "node:path";
import axios from "axios";
import fs from "node:fs";
import { pngValidator } from "png-validator";
import { PMTiles, FetchSource } from "pmtiles";

/**
 * Find files in directory
 * @param {string} dirPath
 * @param {RegExp} regex
 * @returns {string[]}
 */
function findFiles(dirPath, regex) {
  return fs
    .readdirSync(dirPath)
    .filter(
      (fileName) =>
        regex.test(fileName) &&
        fs.statSync(path.join(dirPath, fileName)).isFile()
    );
}

/**
 * Replace local:// url with public http(s):// url
 * @param {Request} req
 * @param {string} url
 * @Returns {string}
 */
export function fixUrl(req, url) {
  if (
    url?.startsWith("mbtiles://") === true ||
    url?.startsWith("pmtiles://") === true
  ) {
    return `${getUrl(req)}data/${url.slice(11, -1)}.json`;
  } else if (url?.startsWith("sprites://") === true) {
    return url.replace("sprites://", `${getUrl(req)}sprites/`);
  } else if (url?.startsWith("fonts://") === true) {
    return url.replace("fonts://", `${getUrl(req)}fonts/`);
  }

  return url;
}

/**
 * Get host URL from request
 * @param {Request} req
 * @returns {string}
 */
export function getUrl(req) {
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

export function fixTileJSONCenter(tileJSON) {
  if (tileJSON.bounds && !tileJSON.center) {
    const tiles = 4;

    tileJSON.center = [
      (tileJSON.bounds[0] + tileJSON.bounds[2]) / 2,
      (tileJSON.bounds[1] + tileJSON.bounds[3]) / 2,
      Math.round(
        -Math.log((tileJSON.bounds[2] - tileJSON.bounds[0]) / 360 / tiles) /
          Math.LN2
      ),
    ];
  }
}

export async function getFontsPbf(fontPath, names, range) {
  const fonts = names.split(",");

  const values = await Promise.all(
    fonts.map(async (font) => {
      try {
        return fs.readFileSync(path.join(fontPath, font, `${range}.pbf`));
      } catch (error) {
        const fallbackFont = "Open Sans Regular";

        printLog(
          "warning",
          `Failed to get font "${font}": ${error}. Using fallback font "${fallbackFont}"...`
        );

        return fs.readFileSync(
          path.resolve(
            "public",
            "resources",
            "fonts",
            fallbackFont,
            `${range}.pbf`
          )
        );
      }
    })
  );

  return glyphCompose.combine(values);
}

export function isValidHttpUrl(string) {
  try {
    const url = new URL(string);

    return url.protocol === "http:" || url.protocol === "https:";
  } catch (_) {
    return false;
  }
}

/**
 * Print log to console
 * @param {"debug"|"info"|"warning"|"error"} level
 * @param {string} msg
 * @returns {void}
 */
export function printLog(level, msg) {
  const dateTime = new Date().toISOString();

  switch (level) {
    case "debug": {
      console.debug(`${dateTime} ${`[DEBUG] ${msg}`}`);

      break;
    }

    case "warning": {
      console.warn(`${dateTime} ${`[WARNING] ${msg}`}`);

      break;
    }

    case "error": {
      console.error(`${dateTime} ${`[ERROR] ${msg}`}`);

      break;
    }

    default: {
      console.info(`${dateTime} ${`[INFO] ${msg}`}`);

      break;
    }
  }
}

export function validatePBFFont(pbfDirPath) {
  try {
    const pbfFileNames = findFiles(pbfDirPath, /^\d{1,5}-\d{1,5}\.pbf$/);

    if (pbfFileNames.length !== 256) {
      throw Error(`Pbf file count is not equal 256`);
    }
  } catch (error) {
    throw error;
  }
}

export function validateSprite(spriteDirPath) {
  try {
    const jsonSpriteFileNames = findFiles(
      spriteDirPath,
      /^sprite(@\d+x)?\.json$/
    );

    if (jsonSpriteFileNames.length === 0) {
      throw Error(`Json file count is equal 0`);
    }

    jsonSpriteFileNames.forEach((jsonSpriteFileName) => {
      /* Validate JSON sprite */
      const jsonFile = fs.readFileSync(
        path.join(spriteDirPath, jsonSpriteFileName),
        "utf8"
      );

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
      const pngData = fs.readFileSync(
        path.join(
          spriteDirPath,
          `${jsonSpriteFileName.slice(0, jsonSpriteFileName.lastIndexOf(".json"))}.png`
        )
      );

      pngValidator(pngData);
    });
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

  fs.writeFile(repoFilePath, jsonData, "utf8", (error) => {
    if (error) {
      throw error;
    }
  });
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
  if (fs.existsSync(outputPath) === true && overwrite === false) {
    const stat = fs.statSync(outputPath);
    if (stat.isFile() && stat.size > 0) {
      return outputPath;
    }
  }

  const response = await axios({
    url,
    method: "GET",
    responseType: "stream",
  });

  return new Promise((resolve, reject) => {
    const dir = path.dirname(outputPath);
    if (fs.existsSync(dir) === false) {
      fs.mkdirSync(dir, {
        recursive: true,
      });
    }

    const writer = fs.createWriteStream(outputPath);

    response.data.pipe(writer);

    let error = null;

    writer.on("error", (err) => {
      error = err;

      writer.close();

      reject(err);
    });

    writer.on("close", () => {
      if (!error) {
        resolve(outputPath);
      }
    });
  });
}

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

function getPMTilesTileType(typenum) {
  const headers = {};
  let tileType;

  if (typenum === 0) {
    tileType = "";
  } else if (typenum === 1) {
    tileType = "pbf";
    headers["Content-Type"] = "application/x-protobuf";
  } else if (typenum === 2) {
    tileType = "png";
    headers["Content-Type"] = "image/png";
  } else if (typenum === 3) {
    tileType = "jpeg";
    headers["Content-Type"] = "image/jpeg";
  } else if (typenum === 4) {
    tileType = "webp";
    headers["Content-Type"] = "image/webp";
  }

  return {
    type: tileType,
    headers: headers,
  };
}

export async function openPMTiles(filePath) {
  let source;

  if (isValidHttpUrl(filePath) === true) {
    source = new FetchSource(filePath);
  } else {
    source = new PMTilesFileSource(fs.openSync(filePath, "r"));
  }

  return new PMTiles(source);
}

export async function getPMTilesInfo(mbtilesSource) {
  const header = await mbtilesSource.getHeader();
  const metadata = await mbtilesSource.getMetadata();

  //Add missing metadata from header
  metadata["format"] = getPMTilesTileType(header.tileType).type;
  metadata["minzoom"] = header.minZoom;
  metadata["maxzoom"] = header.maxZoom;

  if (header.minLon && header.minLat && header.maxLon && header.maxLat) {
    metadata["bounds"] = [
      header.minLon,
      header.minLat,
      header.maxLon,
      header.maxLat,
    ];
  } else {
    metadata["bounds"] = [-180, -85.05112877980659, 180, 85.0511287798066];
  }

  if (header.centerZoom) {
    metadata["center"] = [
      header.centerLon,
      header.centerLat,
      header.centerZoom,
    ];
  } else {
    metadata["center"] = [
      header.centerLon,
      header.centerLat,
      parseInt(metadata["maxzoom"]) / 2,
    ];
  }

  return metadata;
}

export async function getPMTilesTile(pmtiles, z, x, y) {
  const header = await pmtiles.getHeader();
  const tileType = getPMTilesTileType(header.tileType);
  let zxyTile = await pmtiles.getZxy(z, x, y);

  if (zxyTile && zxyTile.data) {
    zxyTile = Buffer.from(zxyTile.data);
  } else {
    zxyTile = undefined;
  }

  return {
    data: zxyTile,
    headers: tileType.headers,
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
        headers: headers,
      });
    });
  });
}
