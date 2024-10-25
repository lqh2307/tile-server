"use strict";

import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { StatusCodes } from "http-status-codes";
import { PMTiles, FetchSource } from "pmtiles";
import fsPromise from "node:fs/promises";
import protobuf from "protocol-buffers";
import { config } from "./config.js";
import handlebars from "handlebars";
import https from "node:https";
import sqlite3 from "sqlite3";
import path from "node:path";
import http from "node:http";
import sharp from "sharp";
import fs from "node:fs";
import zlib from "zlib";
import util from "util";

const protoMessage = protobuf(fs.readFileSync("public/protos/glyphs.proto"));

/**
 * Combine any number of glyph (SDF) PBFs.
 * Returns a re-encoded PBF with the combined
 * font faces, composited using array order
 * to determine glyph priority.
 * @param {array} buffers An array of SDF PBFs.
 * @param {string} fontstack
 */
function combine(buffers, fontstack) {
  if (buffers?.length === 0) {
    return;
  }

  let result;
  const coverage = {};

  for (const buffer of buffers) {
    const decoded = protoMessage.glyphs.decode(buffer);
    const glyphs = decoded.stacks[0].glyphs;

    if (result === undefined) {
      for (const glyph of glyphs) {
        coverage[glyph.id] = true;
      }

      result = decoded;
    } else {
      for (const glyph of glyphs) {
        if (!coverage[glyph.id]) {
          result.stacks[0].glyphs.push(glyph);
          coverage[glyph.id] = true;
        }
      }

      result.stacks[0].name += ", " + decoded.stacks[0].name;
    }
  }

  if (fontstack !== undefined) {
    result.stacks[0].name = fontstack;
  }

  result.stacks[0].glyphs.sort((a, b) => a.id - b.id);

  return protoMessage.glyphs.encode(result);
}

/**
 * Get data
 * @param {string} url
 * @returns {Promise<Buffer>}
 */
export async function getData(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith("https://") === true ? https : http;

    const req = protocol.get(
      url,
      {
        agent: false,
      },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location !== undefined
        ) {
          return getData(res.headers.location).then(resolve).catch(reject);
        }

        const chunks = [];

        res.on("data", (chunk) => {
          chunks.push(chunk);
        });

        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(Buffer.concat(chunks));
          } else {
            reject(new Error(`Failed with status code ${res.statusCode}`));
          }
        });
      }
    );

    req.on("error", (err) => {
      reject(err);
    });

    req.end();
  });
}

/**
 * Check ready middleware
 * @returns {void}
 */
export function checkReadyMiddleware() {
  return async (req, res, next) => {
    try {
      if (config.startupComplete === false) {
        return res.status(StatusCodes.SERVICE_UNAVAILABLE).send("Starting...");
      }

      next();
    } catch (error) {
      printLog("error", `Failed to check ready server: ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

/**
 * Get xyz tile center from lon lat z
 * @param {number} lon
 * @param {number} lat
 * @param {number} z
 * @param {"xyz"|"tms"} scheme
 * @returns {[number,number,number]}
 */
export function getXYZCenterFromLonLatZ(lon, lat, z, scheme = "xyz") {
  const size = 256 * Math.pow(2, z);
  const bc = size / 360;
  const cc = size / (2 * Math.PI);

  if (lon > 180) {
    lon = 180;
  } else if (lon < -180) {
    lon = -180;
  }

  let x = size / 2 + lon * bc;
  if (x > size) {
    x = size;
  }

  if (lat > 85.051129) {
    lat = 85.051129;
  } else if (lat < -85.051129) {
    lat = -85.051129;
  }

  let y = size / 2 - cc * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
  if (y > size) {
    y = size;
  }

  if (scheme === "tms") {
    y = size - y;
  }

  return [Math.round(x / 256), Math.round(y / 256), z];
}

/**
 * Get lon lat tile center from x, y, z
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {"xyz"|"tms"} scheme
 * @returns {[number,number]}
 */
export function getLonLatCenterFromXYZ(x, y, z, scheme = "xyz") {
  let px = (x + 0.5) * 256;
  let py = (y + 0.5) * 256;

  const size = 256 * Math.pow(2, z);
  const bc = size / 360;
  const cc = size / (2 * Math.PI);
  const zc = size / 2;

  if (scheme === "tms") {
    py = size - py;
  }

  return [
    (px - zc) / bc,
    (180 / Math.PI) *
    (2 * Math.atan(Math.exp((py - zc) / -cc)) - 0.5 * Math.PI),
  ];
}

/**
 * Compile template
 * @param {string} template
 * @param {object} data
 * @returns {Promise<string>}
 */
export async function compileTemplate(template, data) {
  const fileData = await fsPromise.readFile(
    `public/templates/${template}.tmpl`,
    "utf8"
  );
  const compiler = handlebars.compile(fileData);

  return compiler(data);
}

/**
 * Render data
 * @param {object} item
 * @param {number} scale
 * @param {256|512} tileSize
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {"xyz"|"tms"} scheme
 * @returns {Promise<Buffer>}
 */
export async function renderData(
  item,
  scale,
  tileSize,
  x,
  y,
  z,
  scheme = "xyz"
) {
  const params = {
    zoom: z,
    center: getLonLatCenterFromXYZ(x, y, z, scheme),
    width: tileSize,
    height: tileSize,
  };

  if (tileSize === 256) {
    if (z !== 0) {
      params.zoom = z - 1;
    } else {
      // HACK1: This hack allows tile-server to support zoom level 0 - 256px tiles, which would actually be zoom -1 in maplibre-gl-native
      params.width = 512;
      params.height = 512;
      // END HACK1
    }
  }

  const renderer = await item.renderers[scale - 1].acquire();

  return new Promise((resolve, reject) => {
    renderer.render(params, (error, data) => {
      item.renderers[scale - 1].release(renderer);

      if (error) {
        return reject(error);
      }

      resolve(data);
    });
  });
}

/**
 * Render image
 * @param {object} data
 * @param {number} scale
 * @param {number} compression
 * @param {256|512} tileSize
 * @param {number} z
 * @returns {Promise<Buffer>}
 */
export async function processImage(data, scale, compression, tileSize, z) {
  if (z === 0 && tileSize === 256) {
    // HACK2: This hack allows tile-server to support zoom level 0 - 256px tiles, which would actually be zoom -1 in maplibre-gl-native
    return await sharp(data, {
      raw: {
        premultiplied: true,
        width: 512 * scale,
        height: 512 * scale,
        channels: 4,
      },
    })
      .resize({
        width: 256 * scale,
        height: 256 * scale,
      })
      .png({
        compressionLevel: compression,
      })
      .toBuffer();
    // END HACK2
  } else {
    return await sharp(data, {
      raw: {
        premultiplied: true,
        width: tileSize * scale,
        height: tileSize * scale,
        channels: 4,
      },
    })
      .png({
        compressionLevel: compression,
      })
      .toBuffer();
  }
}

/**
 * Find matching files in directory
 * @param {string} dirPath
 * @param {RegExp} regex
 * @returns {Promise<string[]>}
 */
export async function findFiles(dirPath, regex) {
  const fileNames = await fsPromise.readdir(dirPath);

  const results = [];
  for (const fileName of fileNames) {
    const stat = await fsPromise.stat(`${dirPath}/${fileName}`);

    if (
      regex.test(fileName) === true &&
      stat.isFile() === true &&
      stat.size > 0
    ) {
      results.push(fileName);
    }
  }

  return results;
}

/**
 * Find matching folders in directory
 * @param {string} dirPath
 * @param {RegExp} regex
 * @returns {Promise<string[]>}
 */
export async function findFolders(dirPath, regex) {
  const folderNames = await fsPromise.readdir(dirPath);

  const results = [];
  for (const folderName of folderNames) {
    const folderPath = `${dirPath}/${folderName}`;
    const stat = await fsPromise.stat(folderPath);

    if (regex.test(dirPath) === true && stat.isDirectory() === true) {
      results.push(folderName);
    }
  }

  return results;
}

/**
 * Get request host
 * @param {Request} req
 * @returns {string}
 */
export function getRequestHost(req) {
  return `${req.protocol}://${req.headers.host}/`;
}

/**
 * Get fonts pbf
 * @param {string} ids
 * @param {string} fileName
 * @returns {Promise<Buffer>}
 */
export async function getFontsPBF(ids, fileName) {
  const data = await Promise.all(
    ids.split(",").map(async (font) => {
      try {
        /* Check font is exist? */
        if (config.repo.fonts[font] === undefined) {
          throw new Error("Font is not found");
        }

        return await fsPromise.readFile(
          `${config.paths.fonts}/${font}/${fileName}`
        );
      } catch (error) {
        printLog(
          "warning",
          `Failed to get font "${font}": ${error}. Using fallback font "${config.fallbackFont}"...`
        );

        return await fsPromise.readFile(
          `public/resources/fonts/${config.fallbackFont}/${fileName}`
        );
      }
    })
  );

  return combine(data);
}

/**
 * Get sprite
 * @param {string} id
 * @param {string} fileName
 * @returns {Promise<Buffer>}
 */
export async function getSprite(id, fileName) {
  return await fsPromise.readFile(`${config.paths.sprites}/${id}/${fileName}`);
}

/**
 * Print log to console
 * @param {"info"|"warning"|"error"} level
 * @param {string} msg
 * @returns {void}
 */
export function printLog(level, msg) {
  if (level === "warning") {
    console.warn(
      `[PID = ${process.pid}] ${new Date().toISOString()} [WARNING] ${msg}`
    );
  } else if (level === "error") {
    console.error(
      `[PID = ${process.pid}] ${new Date().toISOString()} [ERROR] ${msg}`
    );
  } else {
    console.info(
      `[PID = ${process.pid}] ${new Date().toISOString()} [INFO] ${msg}`
    );
  }
}

/**
 * Validate font
 * @param {string} pbfDirPath
 * @returns {Promise<void>}
 */
export async function validateFont(pbfDirPath) {
  const pbfFileNames = await findFiles(pbfDirPath, /^\d{1,5}-\d{1,5}\.pbf$/);

  if (pbfFileNames.length === 0) {
    throw new Error("Missing some PBF files");
  }
}

/**
 * Validate data info (no validate json field)
 * @param {object} info
 * @returns {void}
 */
export function validateDataInfo(info) {
  /* Validate name */
  if (info.name === undefined) {
    throw new Error("Data name info is invalid");
  }

  /* Validate type */
  if (info.type !== undefined) {
    if (["baselayer", "overlay"].includes(info.type) === false) {
      throw new Error("Data type info is invalid");
    }
  }

  /* Validate format */
  if (
    ["jpeg", "jpg", "pbf", "png", "webp", "gif"].includes(info.format) === false
  ) {
    throw new Error("Data format info is invalid");
  }

  /* Validate json */
  /*
  if (info.format === "pbf" && info.json === undefined) {
    throw new Error(`Data json info is invalid`);
  }
  */

  /* Validate minzoom */
  if (info.minzoom < 0 || info.minzoom > 22) {
    throw new Error("Data minzoom info is invalid");
  }

  /* Validate maxzoom */
  if (info.maxzoom < 0 || info.maxzoom > 22) {
    throw new Error("Data maxzoom info is invalid");
  }

  /* Validate minzoom & maxzoom */
  if (info.minzoom > info.maxzoom) {
    throw new Error("Data zoom info is invalid");
  }

  /* Validate bounds */
  if (info.bounds !== undefined) {
    if (
      info.bounds.length !== 4 ||
      Math.abs(info.bounds[0]) > 180 ||
      Math.abs(info.bounds[2]) > 180 ||
      Math.abs(info.bounds[1]) > 90 ||
      Math.abs(info.bounds[3]) > 90 ||
      info.bounds[0] >= info.bounds[2] ||
      info.bounds[1] >= info.bounds[3]
    ) {
      throw new Error("Data bounds info is invalid");
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
      throw new Error("Data center info is invalid");
    }
  }
}

/**
 * Validate style
 * @param {object} config
 * @param {object} styleJSON
 * @returns {Promise<void>}
 */
export async function validateStyle(config, styleJSON) {
  /* Validate style */
  const validationErrors = validateStyleMin(styleJSON);
  if (validationErrors.length > 0) {
    throw new Error(
      validationErrors
        .map((validationError) => "\n\t" + validationError.message)
        .join()
    );
  }

  /* Validate fonts */
  if (styleJSON.glyphs !== undefined) {
    if (
      styleJSON.glyphs.startsWith("fonts://") === false &&
      styleJSON.glyphs.startsWith("https://") === false &&
      styleJSON.glyphs.startsWith("http://") === false
    ) {
      throw new Error("Invalid fonts url");
    }
  }

  /* Validate sprite */
  if (styleJSON.sprite !== undefined) {
    if (styleJSON.sprite.startsWith("sprites://") === true) {
      const spriteID = styleJSON.sprite.slice(
        10,
        styleJSON.sprite.lastIndexOf("/")
      );

      if (config.repo.sprites[spriteID] === undefined) {
        throw new Error(`Sprite "${spriteID}" is not found`);
      }
    } else if (
      styleJSON.sprite.startsWith("https://") === false &&
      styleJSON.sprite.startsWith("http://") === false
    ) {
      throw new Error("Invalid sprite url");
    }
  }

  /* Validate sources */
  await Promise.all(
    Object.keys(styleJSON.sources).map(async (id) => {
      const source = styleJSON.sources[id];

      if (source.url !== undefined) {
        if (
          source.url.startsWith("pmtiles://") === true ||
          source.url.startsWith("mbtiles://") === true
        ) {
          const queryIndex = source.url.indexOf("?");
          const sourceID =
            queryIndex === -1
              ? source.url.slice(10)
              : source.url.slice(10, queryIndex);

          if (config.repo.datas[sourceID] === undefined) {
            throw new Error(
              `Source "${id}" is not found data source "${sourceID}"`
            );
          }
        } else if (
          source.url.startsWith("https://") === false &&
          source.url.startsWith("http://") === false
        ) {
          throw new Error(`Source "${id}" is invalid data url "${url}"`);
        }
      }

      if (source.urls !== undefined) {
        if (source.urls.length === 0) {
          throw new Error(`Source "${id}" is invalid data urls`);
        }

        source.urls.forEach((url) => {
          if (
            url.startsWith("pmtiles://") === true ||
            url.startsWith("mbtiles://") === true
          ) {
            const queryIndex = url.indexOf("?");
            const sourceID =
              queryIndex === -1 ? url.slice(10) : url.slice(10, queryIndex);

            if (config.repo.datas[sourceID] === undefined) {
              throw new Error(
                `Source "${id}" is not found data source "${sourceID}"`
              );
            }
          } else if (
            url.startsWith("https://") === false &&
            url.startsWith("http://") === false
          ) {
            throw new Error(`Source "${id}" is invalid data url "${url}"`);
          }
        });
      }

      if (source.tiles !== undefined) {
        if (source.tiles.length === 0) {
          throw new Error(`Source "${id}" is invalid tile urls`);
        }

        source.tiles.forEach((tile) => {
          if (
            tile.startsWith("pmtiles://") === true ||
            tile.startsWith("mbtiles://") === true
          ) {
            const queryIndex = tile.indexOf("?");
            const sourceID =
              queryIndex === -1 ? tile.slice(10) : tile.slice(10, queryIndex);

            if (config.repo.datas[sourceID] === undefined) {
              throw new Error(
                `Source "${id}" is not found data source "${sourceID}"`
              );
            }
          } else if (
            tile.startsWith("https://") === false &&
            tile.startsWith("http://") === false
          ) {
            throw new Error(`Source "${id}" is invalid tile url "${url}"`);
          }
        });
      }
    })
  );
}

/**
 * Validate sprite
 * @param {string} spriteDirPath
 * @returns {Promise<void>}
 */
export async function validateSprite(spriteDirPath) {
  const [jsonSpriteFileNames, pngSpriteNames] = await Promise.all([
    findFiles(spriteDirPath, /^sprite(@\d+x)?\.json$/),
    findFiles(spriteDirPath, /^sprite(@\d+x)?\.png$/),
  ]);

  if (jsonSpriteFileNames.length !== pngSpriteNames.length) {
    throw new Error("Missing some JSON or PNG files");
  }

  const fileNameWoExts = jsonSpriteFileNames.map((jsonSpriteFileName) =>
    path.basename(jsonSpriteFileName, path.extname(jsonSpriteFileName))
  );

  await Promise.all(
    fileNameWoExts.map(async (fileNameWoExt) => {
      /* Validate JSON sprite */
      const fileData = await fsPromise.readFile(
        `${spriteDirPath}/${fileNameWoExt}.json`,
        "utf8"
      );

      Object.values(JSON.parse(fileData)).forEach((value) => {
        if (
          typeof value !== "object" ||
          "height" in value === false ||
          "pixelRatio" in value === false ||
          "width" in value === false ||
          "x" in value === false ||
          "y" in value === false
        ) {
          throw new Error("Invalid JSON file");
        }
      });

      /* Validate PNG sprite */
      const pngMetadata = await sharp(
        `${spriteDirPath}/${fileNameWoExt}.png`
      ).metadata();

      if (pngMetadata.format !== "png") {
        throw new Error("Invalid PNG file");
      }
    })
  );
}

/**
 * Download file using HTTP or HTTPS
 * @param {string} url - The URL to download the file from
 * @param {string} outputPath - The path where the file will be saved
 * @returns {Promise<string>} - Returns the output path if successful
 */
export async function downloadFile(url, outputPath) {
  await fsPromise.mkdir(path.dirname(outputPath), {
    recursive: true,
  });

  const protocol = url.startsWith("https://") === true ? https : http;

  return new Promise((resolve, reject) => {
    const request = protocol.get(
      url,
      {
        agent: false,
      },
      (response) => {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          const writer = fs.createWriteStream(outputPath);

          response.pipe(writer);

          writer
            .on("finish", () => {
              resolve(outputPath);
            })
            .on("error", (error) => {
              reject(error);
            });
        } else if (
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location !== undefined
        ) {
          return downloadFile(response.headers.location, outputPath)
            .then(resolve)
            .catch(reject);
        } else {
          reject(new Error(`Failed with status code ${response.statusCode}`));
        }
      }
    );

    request.on("error", (error) => {
      reject(error);
    });

    request.end();
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

  getBytes(offset, length) {
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
 * @returns {object}
 */
export function openPMTiles(filePath) {
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
 * Get PMTiles infos
 * @param {object} pmtilesSource
 * @param {boolean} includeJSON
 * @returns {Promise<object>}
 */
export async function getPMTilesInfos(pmtilesSource, includeJSON = false) {
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
  } else if (header.tileType === 5) {
    metadata.format = "avif";
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

  const tileJSON = createNewTileJSON(metadata);

  if (includeJSON === true && metadata.format === "pbf") {
    tileJSON.vector_layers = metadata.vector_layers;
    tileJSON.tilestats = metadata.tilestats;
  }

  return tileJSON;
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

  const data = Buffer.from(zxyTile.data);

  return {
    data: data,
    headers: detectFormatAndHeaders(data).headers,
  };
}

/**
 * Open MBTiles
 * @param {string} filePath
 * @param {"sqlite3.OPEN_READONLY"|"sqlite3.OPEN_READWRITE"} mode
 * @returns {Promise<object>}
 */
export async function openMBTiles(filePath, mode = sqlite3.OPEN_READONLY) {
  return new Promise((resolve, reject) => {
    const mbtilesSource = new sqlite3.Database(filePath, mode, (error) => {
      if (error) {
        return reject(error);
      }

      resolve(mbtilesSource);
    });
  });
}

/**
 * Check unique index is exist on the tiles table?
 * @param {object} mbtilesSource
 * @returns {Promise<boolean>}
 */
async function isExistTilesIndex(mbtilesSource) {
  const indexes = await new Promise((resolve, reject) => {
    mbtilesSource.all("PRAGMA index_list (tiles)", (error, indexes) => {
      if (error) {
        return reject(error);
      }

      resolve(indexes);
    });
  });

  if (indexes !== undefined) {
    for (const index of indexes) {
      const columns = await new Promise((resolve, reject) => {
        mbtilesSource.all(`PRAGMA index_info (${index})`, (error, columns) => {
          if (error) {
            return reject(error);
          }

          resolve(columns);
        });
      });

      if (
        columns?.length === 3 &&
        columns[0].name === "zoom_level" &&
        columns[1].name === "tile_column" &&
        columns[2].name === "tile_row"
      ) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check unique index is exist on the metadata table?
 * @param {object} mbtilesSource
 * @returns {Promise<boolean>}
 */
async function isExistMetadataIndex(mbtilesSource) {
  const indexes = await new Promise((resolve, reject) => {
    mbtilesSource.all("PRAGMA index_list (metadata)", (error, indexes) => {
      if (error) {
        return reject(error);
      }

      resolve(indexes);
    });
  });

  if (indexes !== undefined) {
    for (const index of indexes) {
      const columns = await new Promise((resolve, reject) => {
        mbtilesSource.all(`PRAGMA index_info (${index})`, (error, columns) => {
          if (error) {
            return reject(error);
          }

          resolve(columns);
        });
      });

      if (columns?.length === 1 && columns[0].name === "name") {
        return true;
      }
    }
  }

  return false;
}

/**
 * Create unique index on the metadata table
 * @param {string} mbtilesFilePath
 * @returns {Promise<void>}
 */
export async function createMetadataIndex(mbtilesFilePath) {
  const mbtilesSource = await openMBTiles(
    mbtilesFilePath,
    sqlite3.OPEN_READWRITE
  );

  if ((await isExistMetadataIndex(mbtilesSource)) === true) {
    return;
  }

  return new Promise((resolve, reject) => {
    mbtilesSource.run(
      "CREATE UNIQUE INDEX metadata_unique_index ON metadata (name)",
      (error) => {
        if (error) {
          return reject(error);
        }

        resolve();
      }
    );
  }).finally(() => {
    mbtilesSource.close();
  });
}

/**
 * Create unique index on the tiles table
 * @param {string} mbtilesFilePath
 * @returns {Promise<void>}
 */
export async function createTilesIndex(mbtilesFilePath) {
  const mbtilesSource = await openMBTiles(
    mbtilesFilePath,
    sqlite3.OPEN_READWRITE
  );

  if ((await isExistTilesIndex(mbtilesSource)) === true) {
    return;
  }

  return new Promise((resolve, reject) => {
    mbtilesSource.run(
      "CREATE UNIQUE INDEX tiles_unique_index ON tiles (zoom_level, tile_column, tile_row)",
      (error) => {
        if (error) {
          return reject(error);
        }

        resolve();
      }
    );
  }).finally(() => {
    mbtilesSource.close();
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
    mbtilesSource.get(
      `SELECT tile_data FROM tiles WHERE zoom_level = ${z} AND tile_column = ${x} AND tile_row = ${y}`,
      (error, row) => {
        if (error) {
          return reject(error);
        }

        if (!row?.tile_data) {
          return reject(new Error("Tile does not exist"));
        }

        const data = Buffer.from(row.tile_data);

        resolve({
          data: data,
          headers: detectFormatAndHeaders(data).headers,
        });
      }
    );
  });
}

/**
 * Create new tileJSON
 * @param {object} metadata
 * @returns
 */
export function createNewTileJSON(metadata) {
  // Default
  const data = {
    tilejson: "2.2.0",
    name: "Unknown",
    description: "Unknown",
    attribution: "<b>Viettel HighTech</b>",
    version: "1.0.0",
    type: "overlay",
    format: "png",
    bounds: [-180, -85.051129, 180, 85.051129],
    minzoom: 0,
    maxzoom: 22,
  };

  // Overwrite
  if (metadata !== undefined) {
    if (metadata.tilejson !== undefined) {
      data.tilejson = metadata.tilejson;
    }

    if (metadata.name !== undefined) {
      data.name = metadata.name;
    }

    if (metadata.description !== undefined) {
      data.description = metadata.description;
    }

    if (metadata.attribution !== undefined) {
      data.attribution = metadata.attribution;
    }

    if (metadata.type !== undefined) {
      data.type = metadata.type;
    }

    if (metadata.format !== undefined) {
      data.format = metadata.format;
    }

    /*
    if (metadata.scheme !== undefined) {
      data.scheme = metadata.scheme;
    }
    */

    if (metadata.version !== undefined) {
      data.version = metadata.version;
    }

    if (metadata.template !== undefined) {
      data.template = metadata.template;
    }

    if (metadata.legend !== undefined) {
      data.legend = metadata.legend;
    }

    if (metadata.tiles !== undefined) {
      data.tiles = [...metadata.tiles];
    }

    if (metadata.grids !== undefined) {
      data.grids = [...metadata.grids];
    }

    if (metadata.data !== undefined) {
      data.data = [...metadata.data];
    }

    if (metadata.bounds !== undefined) {
      data.bounds = [...metadata.bounds];
    }

    if (metadata.center !== undefined) {
      data.center = [...metadata.center];
    }

    if (metadata.minzoom !== undefined) {
      data.minzoom = metadata.minzoom;
    }

    if (metadata.maxzoom !== undefined) {
      data.maxzoom = metadata.maxzoom;
    }
  }

  // Calculate center
  if (data.center === undefined) {
    data.center = [
      (data.bounds[0] + data.bounds[2]) / 2,
      (data.bounds[1] + data.bounds[3]) / 2,
      Math.round((data.minzoom + data.maxzoom) / 2),
    ];
  }

  return data;
}

/**
 * Get MBTiles min zoom from tiles
 * @param {object} mbtilesSource
 * @returns {Promise<number>}
 */
export async function getMBTilesMinZoomFromTiles(mbtilesSource) {
  return await new Promise((resolve, reject) => {
    mbtilesSource.get(
      "SELECT MIN(zoom_level) AS minzoom FROM tiles",
      (error, row) => {
        if (error) {
          return reject(error);
        }

        if (row) {
          return resolve(row.minzoom);
        }

        reject(new Error("No tile found"));
      }
    );
  });
}

/**
 * Get MBTiles max zoom from tiles
 * @param {object} mbtilesSource
 * @returns {Promise<number>}
 */
export async function getMBTilesMaxZoomFromTiles(mbtilesSource) {
  return await new Promise((resolve, reject) => {
    mbtilesSource.get(
      "SELECT MAX(zoom_level) AS maxzoom FROM tiles",
      (error, row) => {
        if (error) {
          return reject(error);
        }

        if (row) {
          return resolve(row.maxzoom);
        }

        reject(new Error("No tile found"));
      }
    );
  });
}

/**
 * Get MBTiles tile format from tiles
 * @param {object} mbtilesSource
 * @returns {Promise<number>}
 */
export async function getMBTilesFormatFromTiles(mbtilesSource) {
  return await new Promise((resolve, reject) => {
    mbtilesSource.get("SELECT tile_data FROM tiles LIMIT 1", (error, row) => {
      if (error) {
        return reject(error);
      }

      if (row) {
        return resolve(detectFormatAndHeaders(row.tile_data).format);
      }

      reject(new Error("No tile found"));
    });
  });
}

/**
 * Get MBTiles infos
 * @param {object} mbtilesSource
 * @param {boolean} includeJSON
 * @returns {Promise<object>}
 */
export async function getMBTilesInfos(mbtilesSource, includeJSON = false) {
  const metadata = {};

  /* Get metadatas */
  await new Promise((resolve, reject) => {
    mbtilesSource.all("SELECT name, value FROM metadata", (error, rows) => {
      if (error) {
        return reject(error);
      }

      if (rows) {
        rows.forEach((row) => {
          switch (row.name) {
            case "json":
              if (includeJSON === true) {
                try {
                  Object.assign(metadata, JSON.parse(row.value));
                } catch (error) {
                  return reject(error);
                }
              }

              break;
            case "minzoom":
            case "maxzoom":
              metadata[row.name] = Number(row.value);

              break;
            case "center":
            case "bounds":
              metadata[row.name] = row.value
                .split(",")
                .map((elm) => Number(elm));

              break;
            default:
              metadata[row.name] = row.value;

              break;
          }
        });
      }

      resolve();
    });
  });

  /* Try get min zoom */
  if (metadata.minzoom === undefined) {
    metadata.minzoom = await getMBTilesMinZoomFromTiles(mbtilesSource);
  }

  /* Try get max zoom */
  if (metadata.maxzoom === undefined) {
    metadata.maxzoom = await getMBTilesMaxZoomFromTiles(mbtilesSource);
  }

  /* Try get tile format */
  if (metadata.format === undefined) {
    metadata.format = await getMBTilesFormatFromTiles(mbtilesSource);
  }

  const tileJSON = createNewTileJSON(metadata);

  /* Add vector_layers and tilestats */
  if (includeJSON === true && metadata.format === "pbf") {
    tileJSON.vector_layers = metadata.vector_layers;
    tileJSON.tilestats = metadata.tilestats;
  }

  return tileJSON;
}

/**
 * Close MBTiles
 * @param {object} mbtilesSource
 * @returns {Promise<void>}
 */
export async function closeMBTiles(mbtilesSource) {
  return new Promise((resolve, reject) => {
    mbtilesSource.close((error) => {
      if (error) {
        return reject(error);
      }

      resolve();
    });
  });
}

/**
 * Return either a format as an extension: png, pbf, jpg, webp, gif and
 * headers - Content-Type and Content-Encoding - for a response containing this kind of image
 * @param {Buffer} buffer input
 * @returns {object}
 */
export function detectFormatAndHeaders(buffer) {
  let format;
  const headers = {};

  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    format = "png";
    headers["Content-Type"] = "image/png";
  } else if (
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[buffer.length - 2] === 0xff &&
    buffer[buffer.length - 1] === 0xd9
  ) {
    format = "jpeg"; // equivalent jpg
    headers["Content-Type"] = "image/jpeg"; // equivalent image/jpg
  } else if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38 &&
    (buffer[4] === 0x39 || buffer[4] === 0x37) &&
    buffer[5] === 0x61
  ) {
    format = "gif";
    headers["Content-Type"] = "image/gif";
  } else if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    format = "webp";
    headers["Content-Type"] = "image/webp";
  } else {
    format = "pbf";
    headers["Content-Type"] = "application/x-protobuf";

    if (buffer[0] === 0x78 && buffer[1] === 0x9c) {
      headers["Content-Encoding"] = "deflate";
    } else if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
      headers["Content-Encoding"] = "gzip";
    }
  }

  return {
    format,
    headers,
  };
}

/**
 *
 */
export const gzipAsync = util.promisify(zlib.gzip);

/**
 *
 */
export const unzipAsync = util.promisify(zlib.unzip);
