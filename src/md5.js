"use strict";

import { isMBTilesExistColumns } from "./mbtiles.js";
import fsPromise from "node:fs/promises";
import { delay } from "./utils.js";
import path from "node:path";
import crypto from "crypto";

/**
 * Calculate MD5 hash of a buffer
 * @param {Buffer} buffer The buffer data of the file
 * @returns {string} The MD5 hash
 */
export function calculateMD5(buffer) {
  return crypto.createHash("md5").update(buffer).digest("hex");
}

/**
 * Update XYZ md5.json file
 * @param {string} filePath File path to store md5.json file
 * @param {Object<string,string>} hashAdds Hash data object
 * @returns {Promise<void>}
 */
async function updateXYZMD5File(filePath, hashAdds = {}) {
  const tempFilePath = `${filePath}.tmp`;

  try {
    const hashs = JSON.parse(await fsPromise.readFile(filePath, "utf8"));

    await fsPromise.writeFile(
      tempFilePath,
      JSON.stringify(
        {
          ...hashs,
          ...hashAdds,
        },
        null,
        2
      ),
      "utf8"
    );

    await fsPromise.rename(tempFilePath, filePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      await fsPromise.mkdir(path.dirname(filePath), {
        recursive: true,
      });

      await fsPromise.writeFile(
        filePath,
        JSON.stringify(hashAdds, null, 2),
        "utf8"
      );
    } else {
      await fsPromise.rm(tempFilePath, {
        force: true,
      });

      throw error;
    }
  }
}

/**
 * Update XYZ md5.json file with lock
 * @param {string} filePath File path to store md5.json file
 * @param {Object<string,string>} hashAdds Hash data object
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<void>}
 */
export async function updateXYZMD5FileWithLock(
  filePath,
  hashAdds = {},
  timeout
) {
  const startTime = Date.now();
  const lockFilePath = `${filePath}.lock`;
  let lockFileHandle;

  while (Date.now() - startTime <= timeout) {
    try {
      lockFileHandle = await fsPromise.open(lockFilePath, "wx");

      await updateXYZMD5File(filePath, hashAdds);

      await lockFileHandle.close();

      await fsPromise.rm(lockFilePath, {
        force: true,
      });

      return;
    } catch (error) {
      if (error.code === "ENOENT") {
        await fsPromise.mkdir(path.dirname(filePath), {
          recursive: true,
        });

        await updateXYZMD5FileWithLock(filePath, hashAdds, timeout);

        return;
      } else if (error.code === "EEXIST") {
        await delay(50);
      } else {
        if (lockFileHandle !== undefined) {
          await lockFileHandle.close();

          await fsPromise.rm(lockFilePath, {
            force: true,
          });
        }

        throw error;
      }
    }
  }

  throw new Error(`Timeout to access ${lockFilePath} file`);
}

/**
 * Get XYZ tile MD5
 * @param {string} sourcePath Folder path
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @param {"jpeg"|"jpg"|"pbf"|"png"|"webp"|"gif"} format Tile format
 * @returns {Promise<string>}
 */
export async function getXYZTileMD5(sourcePath, z, x, y, format) {
  try {
    const data = await fsPromise.readFile(`${sourcePath}/md5.json`);

    const hashs = JSON.parse(data);

    if (hashs[`${z}/${x}/${y}`] === undefined) {
      throw new Error("Tile MD5 does not exist");
    }
  } catch (error) {
    if (error.code === "ENOENT") {
      try {
        let data = await fsPromise.readFile(
          `${sourcePath}/${z}/${x}/${y}.${format}`
        );
        if (!data) {
          throw new Error("Tile MD5 does not exist");
        }

        return calculateMD5(Buffer.from(data));
      } catch (error) {
        if (error.code === "ENOENT") {
          throw new Error("Tile MD5 does not exist");
        }

        throw error;
      }
    }

    throw error;
  }
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

/**
 * Get MBTiles tile MD5
 * @param {object} mbtilesSource
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @returns {Promise<string>}
 */
export async function getMBTilesTileMD5(mbtilesSource, z, x, y) {
  if (await isMBTilesExistColumns(mbtilesSource, "tiles", ["md5"])) {
    return new Promise((resolve, reject) => {
      mbtilesSource.get(
        `SELECT md5 FROM tiles WHERE zoom_level = ${z} AND tile_column = ${x} AND tile_row = ${y}`,
        (error, row) => {
          if (error) {
            return reject(error);
          }

          if (!row?.md5) {
            return reject(new Error("Tile MD5 does not exist"));
          }

          resolve(row.md5);
        }
      );
    });
  } else {
    return new Promise((resolve, reject) => {
      mbtilesSource.get(
        `SELECT tile_data FROM tiles WHERE zoom_level = ${z} AND tile_column = ${x} AND tile_row = ${y}`,
        (error, row) => {
          if (error) {
            return reject(error);
          }

          if (!row?.tile_data) {
            return reject(new Error("Tile MD5 does not exist"));
          }

          resolve(calculateMD5(Buffer.from(row.tile_data)));
        }
      );
    });
  }
}
