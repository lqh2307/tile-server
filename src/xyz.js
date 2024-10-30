"use strict";

import fsPromise from "node:fs/promises";
import {
  detectFormatAndHeaders,
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
 * @param { "gif"|"png"|"jpg"|"jpeg"|"webp"|"pbf"} format
 * @returns {Promise<object>}
 */
export async function getXYZTile(sourcePath, z, x, y, format = "png") {
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
 * Get XYZ tile format from tiles
 * @param {object} sourcePath
 * @returns {Promise<number>}
 */
export async function getXYZFormatFromTiles(sourcePath) {
  const zFolders = await findFolders(sourcePath, /^\d+$/);

  loop: for (const zFolder of zFolders) {
    const xFolders = await findFolders(`${sourcePath}/${zFolder}`, /^\d+$/);

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
 * @param {"xyz"|"tms"} scheme - Tile scheme
 * @returns {Promise<number>}
 */
export async function getXYZBBoxFromTiles(sourcePath, scheme) {
  const boundsArr = [];

  const zFolders = await findFolders(sourcePath, /^\d+$/);

  for (const zFolder of zFolders) {
    const xFolders = await findFolders(`${sourcePath}/${zFolder}`, /^\d+$/);

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
            getBBoxFromTiles(xMin, yMin, xMax, yMax, zFolder, scheme)
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
  const folders = await findFolders(sourcePath, /^\d+$/);

  return zoomType === "minzoom"
    ? Math.min(...folders.map((folder) => Number(folder)))
    : Math.max(...folders.map((folder) => Number(folder)));
}

/**
 * Get XYZ infos
 * @param {object} mbtilesSource
 * @param {boolean} includeJSON
 * @param {"xyz"|"tms"} scheme - Tile scheme
 * @returns {Promise<object>}
 */
export async function getXYZInfos(
  sourcePath,
  scheme = "xyz",
  includeJSON = false
) {
  let metadata = {};

  /* Get metadatas */
  try {
    metadata = await fsPromise.readFile(`${sourcePath}/metadata.json`, "utf8");
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
    metadata.bounds = await getXYZBBoxFromTiles(sourcePath, scheme);
  }

  const tileJSON = createNewTileJSON(metadata);

  /* Add vector_layers and tilestats */
  if (includeJSON === true && metadata.format === "pbf") {
    tileJSON.vector_layers = metadata.vector_layers;
    tileJSON.tilestats = metadata.tilestats;
  }

  return tileJSON;
}
