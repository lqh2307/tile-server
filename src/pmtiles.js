"use strict";

import { PMTiles, FetchSource } from "pmtiles";
import fs from "node:fs";
import {
  detectFormatAndHeaders,
  createNewTileJSON,
  calculateMD5,
} from "./utils.js";

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
 * @returns {Promise<object>}
 */
export async function getPMTilesInfos(pmtilesSource) {
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

  return createNewTileJSON(metadata);
}

/**
 * Get PMTiles tile
 * @param {object} pmtilesSource
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
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
 * Get PMTiles tile MD5
 * @param {object} pmtilesSource
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @returns {Promise<string>}
 */
export async function getPMTilesTileMD5(pmtilesSource, z, x, y) {
  const zxyTile = await pmtilesSource.getZxy(z, x, y);
  if (!zxyTile?.data) {
    throw new Error("Tile MD5 does not exist");
  }

  resolve(calculateMD5(Buffer.from(zxyTile.data)));
}
