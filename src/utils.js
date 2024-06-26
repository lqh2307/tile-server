"use strict";

import path from "node:path";
import fs from "node:fs";
import axios from "axios";
import glyphCompose from "@mapbox/glyph-pbf-composite";
import { pngValidator } from "png-validator";
import { PMTiles, FetchSource } from "pmtiles";

function findFiles(dirPath, regex, isRecurse = false, isJustBaseName = false) {
  if (isRecurse) {
    const files = fs.readdirSync(dirPath);
    const results = [];

    for (const file of files) {
      const filePath = path.join(dirPath, file);

      if (regex.test(file) && fs.statSync(filePath).isDirectory()) {
        const subResults = findFiles(filePath, regex, true);

        results.push(
          ...subResults.map((subResult) => path.join(file, subResult))
        );
      } else if (regex.test(file) && fs.statSync(filePath).isFile()) {
        results.push(file);
      }
    }

    if (isJustBaseName === true) {
      return results.map((result) => path.basename(result));
    }

    return results;
  } else {
    const fileNames = fs.readdirSync(dirPath);

    return fileNames.filter(
      (fileName) =>
        regex.test(fileName) &&
        fs.statSync(path.join(dirPath, fileName)).isFile()
    );
  }
}

/**
 * Replace local:// urls with public http(s):// urls
 * @param req
 * @param url
 */
export function fixUrl(req, url) {
  if (!url || typeof url !== "string" || url.indexOf("local://") !== 0) {
    return url;
  }

  return url.replace("local://", getUrl(req));
}

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
          `Font "${font}" is not found. Using fallback font "${fallbackFont}"...`
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

export function printLog(level, msg) {
  switch (level) {
    case "debug": {
      const logFormat = `${new Date().toISOString()} ${`[DEBUG] ${msg}`}`;

      console.debug(logFormat);

      break;
    }

    case "warning": {
      const logFormat = `${new Date().toISOString()} ${`[WARNING] ${msg}`}`;

      console.warn(logFormat);

      break;
    }

    case "error": {
      const logFormat = `${new Date().toISOString()} ${`[ERROR] ${msg}`}`;

      console.error(logFormat);

      break;
    }

    default: {
      const logFormat = `${new Date().toISOString()} ${`[INFO] ${msg}`}`;

      console.info(logFormat);

      break;
    }
  }
}

export function validatePBFFont(pbfDirPath) {
  try {
    const fileNames = findFiles(pbfDirPath, /^\d{1,5}-\d{1,5}\.pbf{1}$/);

    if (fileNames.length !== 256) {
      throw Error(`Font is invalid`);
    }
  } catch (error) {
    throw error;
  }
}

export function validateSprite(spriteDirPath) {
  try {
    const spritePattern = /^sprite(@\d+x)?\.(png|json){1}$/;

    const fileNameWoExts = [
      ...new Set(
        findFiles(spriteDirPath, spritePattern).map((fileName) =>
          path.basename(fileName, path.extname(fileName))
        )
      ),
    ];

    if (fileNameWoExts.length === 0) {
      throw Error(`Sprite is empty`);
    }

    fileNameWoExts.forEach((fileNameWoExt) => {
      /* Validate JSON sprite */
      const jsonFile = fs.readFileSync(
        path.join(spriteDirPath, `${fileNameWoExt}.json`),
        "utf8"
      );

      const jsonData = JSON.parse(jsonFile);

      Object.keys(jsonData).forEach((key) => {
        const value = jsonData[key];

        if (
          typeof value !== "object" ||
          !("height" in value) ||
          !("pixelRatio" in value) ||
          !("width" in value) ||
          !("x" in value) ||
          !("y" in value)
        ) {
          throw Error(
            `One of properties "height", "pixelRatio", "width", "x", "y" for sprite "${key}" is empty`
          );
        }
      });

      /* Validate PNG sprite */
      const pngData = fs.readFileSync(
        path.join(spriteDirPath, `${fileNameWoExt}.png`)
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

    console.log(`RSS: ${memoryUsage.rss}`);
    console.log(`Heap Total: ${memoryUsage.heapTotal}`);
    console.log(`Heap Used: ${memoryUsage.heapUsed}`);
    console.log(`External: ${memoryUsage.external}`);
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

/**
 *
 * @param typenum
 */
function getPmtilesTileType(typenum) {
  const header = {};
  let tileType;

  switch (typenum) {
    case 0:
      tileType = "Unknown";

      break;
    case 1:
      tileType = "pbf";
      header["Content-Type"] = "application/x-protobuf";

      break;
    case 2:
      tileType = "png";
      header["Content-Type"] = "image/png";

      break;
    case 3:
      tileType = "jpeg";
      header["Content-Type"] = "image/jpeg";

      break;
    case 4:
      tileType = "webp";
      header["Content-Type"] = "image/webp";

      break;
    case 5:
      tileType = "avif";
      header["Content-Type"] = "image/avif";

      break;
  }

  return {
    type: tileType,
    header: header,
  };
}

/**
 *
 * @param filePath
 */
export function openPMtiles(filePath) {
  let source;

  if (isValidHttpUrl(filePath) === true) {
    source = new FetchSource(filePath);
  } else {
    source = new PMTilesFileSource(fs.openSync(filePath, "r"));
  }

  return new PMTiles(source);
}

/**
 *
 * @param pmtiles
 */
export async function getPMtilesInfo(pmtiles) {
  const header = await pmtiles.getHeader();
  const metadata = await pmtiles.getMetadata();

  //Add missing metadata from header
  metadata["format"] = getPmtilesTileType(header.tileType).type;
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

/**
 *
 * @param pmtiles
 * @param z
 * @param x
 * @param y
 */
export async function getPMtilesTile(pmtiles, z, x, y) {
  const header = await pmtiles.getHeader();
  const tileType = getPmtilesTileType(header.tileType);
  let zxyTile = await pmtiles.getZxy(z, x, y);

  if (zxyTile && zxyTile.data) {
    zxyTile = Buffer.from(zxyTile.data);
  } else {
    zxyTile = undefined;
  }

  return {
    data: zxyTile,
    header: tileType.header,
  };
}
