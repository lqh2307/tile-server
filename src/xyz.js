"use strict";

import { StatusCodes } from "http-status-codes";
import fsPromise from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import http from "node:http";
import axios from "axios";
import {
  getLayerNamesFromPBFTile,
  detectFormatAndHeaders,
  getTileBoundsFromBBox,
  createNewTileJSON,
  getBBoxFromTiles,
  findFolders,
  findFiles,
} from "./utils.js";

/**
 * Get XYZ tile
 * @param {string} sourcePath
 * @param {number} z
 * @param {number} x
 * @param {number} y
 * @param {"jpeg"|"jpg"|"pbf"|"png"|"webp"|"gif"} format Tile format
 * @returns {Promise<object>}
 */
export async function getXYZTile(sourcePath, z, x, y, format) {
  try {
    const data = Buffer.from(
      await fsPromise.readFile(`${sourcePath}/${z}/${x}/${y}.${format}`)
    );

    return {
      data: data,
      headers: detectFormatAndHeaders(data).headers,
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error("Tile does not exist");
    }

    throw error;
  }
}

/**
 * Get XYZ tile from a URL
 * @param {string} url The URL to fetch data from
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<object>}
 */
export async function getXYZTileFromURL(url, timeout) {
  try {
    const response = await axios.get(url, {
      timeout: timeout,
      responseType: "arraybuffer",
      headers: {
        "User-Agent": "Tile Server",
      },
      httpAgent: new http.Agent({
        keepAlive: false,
      }),
      httpsAgent: new https.Agent({
        keepAlive: false,
      }),
    });

    if (response.status === StatusCodes.NO_CONTENT) {
      throw new Error("Tile does not exist");
    }

    return {
      data: response.data,
      headers: detectFormatAndHeaders(response.data).headers,
    };
  } catch (error) {
    if (error.message === "Tile does not exist") {
      throw error;
    } else if (error.response) {
      if (error.response.status === StatusCodes.NOT_FOUND) {
        throw new Error("Tile does not exist");
      } else {
        throw new Error(
          `Failed to request ${url} with status code: ${error.response.status} - ${error.response.statusText}`
        );
      }
    } else {
      throw new Error(`Failed to request ${url}: ${error.message}`);
    }
  }
}

/**
 * Get XYZ layers from tiles
 * @param {object} sourcePath
 * @returns {Promise<Array<string>>}
 */
export async function getXYZLayersFromTiles(sourcePath) {
  const layerNames = new Set();

  const pbfFilePaths = await findFiles(sourcePath, /^\d+\.pbf$/, true);

  for (const pbfFile of pbfFilePaths) {
    try {
      const layers = await getLayerNamesFromPBFTile(`${sourcePath}/${pbfFile}`);

      layers.forEach((layer) => layerNames.add(layer));
    } catch (error) {
      throw error;
    }
  }

  return Array.from(layerNames);
}

/**
 * Get XYZ tile format from tiles
 * @param {object} sourcePath
 * @returns {Promise<number>}
 */
export async function getXYZFormatFromTiles(sourcePath) {
  const zFolders = await findFolders(sourcePath, /^\d+$/, false);

  loop: for (const zFolder of zFolders) {
    const xFolders = await findFolders(
      `${sourcePath}/${zFolder}`,
      /^\d+$/,
      false
    );

    for (const xFolder of xFolders) {
      const yFiles = await findFiles(
        `${sourcePath}/${zFolder}/${xFolder}`,
        /^\d+\.(gif|png|jpg|jpeg|webp|pbf)$/
      );

      if (yFiles.length > 0) {
        metadata.format = yFiles[0].split(".")[1];

        break loop;
      }
    }
  }
}

/**
 * Get XYZ bounding box from tiles
 * @param {object} sourcePath
 * @returns {Promise<number>}
 */
export async function getXYZBBoxFromTiles(sourcePath) {
  const boundsArr = [];

  const zFolders = await findFolders(sourcePath, /^\d+$/, false);

  for (const zFolder of zFolders) {
    const xFolders = await findFolders(
      `${sourcePath}/${zFolder}`,
      /^\d+$/,
      false
    );

    if (xFolders.length > 0) {
      const xMin = Math.min(...xFolders.map((folder) => Number(folder)));
      const xMax = Math.max(...xFolders.map((folder) => Number(folder)));

      for (const xFolder of xFolders) {
        let yFiles = await findFiles(
          `${sourcePath}/${zFolder}/${xFolder}`,
          /^\d+\.(gif|png|jpg|jpeg|webp|pbf)$/
        );

        if (yFiles.length > 0) {
          yFiles = yFiles.map((yFile) => yFile.split(".")[0]);

          const yMin = Math.min(...yFiles.map((file) => Number(file)));
          const yMax = Math.max(...yFiles.map((file) => Number(file)));

          boundsArr.push(
            getBBoxFromTiles(xMin, yMin, xMax, yMax, zFolder, "xyz")
          );
        }
      }
    }
  }

  if (boundsArr.length > 0) {
    metadata.bounds = [
      Math.min(...boundsArr.map((bbox) => bbox[0])),
      Math.min(...boundsArr.map((bbox) => bbox[1])),
      Math.max(...boundsArr.map((bbox) => bbox[2])),
      Math.max(...boundsArr.map((bbox) => bbox[3])),
    ];
  }
}

/**
 * Get XYZ zoom level from tiles
 * @param {object} sourcePath
 * @param {"minzoom"|"maxzoom"} zoomType
 * @returns {Promise<number>}
 */
export async function getXYZZoomLevelFromTiles(
  sourcePath,
  zoomType = "maxzoom"
) {
  const folders = await findFolders(sourcePath, /^\d+$/, false);

  return zoomType === "minzoom"
    ? Math.min(...folders.map((folder) => Number(folder)))
    : Math.max(...folders.map((folder) => Number(folder)));
}

/**
 * Get XYZ infos
 * @param {object} mbtilesSource
 * @returns {Promise<object>}
 */
export async function getXYZInfos(sourcePath) {
  let metadata = {};

  /* Get metadatas */
  try {
    metadata = JSON.parse(
      await fsPromise.readFile(`${sourcePath}/metadata.json`, "utf8")
    );
  } catch (error) {}

  /* Try get min zoom */
  if (metadata.minzoom === undefined) {
    metadata.minzoom = await getXYZZoomLevelFromTiles(sourcePath, "minzoom");
  }

  /* Try get max zoom */
  if (metadata.maxzoom === undefined) {
    metadata.maxzoom = await getXYZZoomLevelFromTiles(sourcePath, "maxzoom");
  }

  /* Try get tile format */
  if (metadata.format === undefined) {
    metadata.format = await getXYZFormatFromTiles(sourcePath);
  }

  /* Try get bounds */
  if (metadata.bounds === undefined) {
    metadata.bounds = await getXYZBBoxFromTiles(sourcePath, "xyz");
  }

  /* Add vector_layers */
  if (metadata.format === "pbf" && metadata.vector_layers === undefined) {
    const layers = await getXYZLayersFromTiles(sourcePath);

    metadata.vector_layers = layers.map((layer) => {
      return {
        id: layer,
      };
    });
  }

  return createNewTileJSON(metadata);
}

/**
 * Create XYZ metadata.json file
 * @param {string} outputFolder Folder path to store metadata.json file
 * @param {Object<string,string>} metadatas Metadata object
 * @returns {Promise<void>}
 */
export async function createXYZMetadataFile(outputFolder, metadatas) {
  await fsPromise.writeFile(
    `${outputFolder}/metadata.json`,
    JSON.stringify(metadatas, null, 2)
  );
}

/**
 * Create XYZ md5.json file
 * @param {string} outputFolder Folder path to store md5.json file
 * @param {Object<string,string>} hashs Hash data object
 * @returns {Promise<void>}
 */
export async function createXYZMD5File(outputFolder, hashs) {
  await fsPromise.writeFile(
    `${outputFolder}/md5.json`,
    JSON.stringify(hashs, null, 2)
  );
}

/**
 * Create tile data file
 * @param {string} filePath File path to store tile data file
 * @param {Buffer} data Tile data
 * @returns {Promise<void>}
 */
export async function createXYZTileDataFile(filePath, data) {
  await fsPromise.mkdir(path.dirname(filePath), {
    recursive: true,
  });

  await fsPromise.writeFile(filePath, data);
}

/**
 * Get XYZ tile from bounding box for specific zoom levels intersecting a bounding box
 * @param {Array<number>} bbox [west, south, east, north] in EPSG:4326
 * @param {Array<number>} zooms Array of specific zoom levels
 * @returns {Array<string>} Array values as z/x/y
 */
export function getXYZTileFromBBox(bbox, zooms) {
  const tilesSummary = getTileBoundsFromBBox(bbox, zooms, "xyz");
  const tiles = [];

  for (const z in tilesSummary) {
    for (let x = tilesSummary[z].x[0]; x <= tilesSummary[z].x[1]; x++) {
      for (let y = tilesSummary[z].y[0]; y <= tilesSummary[z].y[1]; y++) {
        tiles.push(`/${z}/${x}/${y}`);
      }
    }
  }

  return tiles;
}
