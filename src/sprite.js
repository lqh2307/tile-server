"use strict";

import fsPromise from "node:fs/promises";
import { findFiles } from "./utils.js";
import sharp from "sharp";

sharp.cache(false);

/**
 * Validate sprite
 * @param {string} spriteDirPath Sprite dir path
 * @returns {Promise<void>}
 */
export async function validateSprite(spriteDirPath) {
  const [jsonSpriteFileNames, pngSpriteNames] = await Promise.all([
    findFiles(spriteDirPath, /^sprite(@\d+x)?\.json$/, false, true),
    findFiles(spriteDirPath, /^sprite(@\d+x)?\.png$/, false, true),
  ]);

  if (jsonSpriteFileNames.length !== pngSpriteNames.length) {
    throw new Error("Missing some JSON or PNG files");
  }

  const fileNameWoExts = jsonSpriteFileNames.map(
    (jsonSpriteFileName) => jsonSpriteFileName.split(".")[0]
  );

  await Promise.all(
    fileNameWoExts.map(async (fileNameWoExt) => {
      /* Validate JSON sprite */
      const fileData = await fsPromise.readFile(
        `${fileNameWoExt}.json`,
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
      const pngMetadata = await sharp(`${fileNameWoExt}.png`).metadata();

      if (pngMetadata.format !== "png") {
        throw new Error("Invalid PNG file");
      }
    })
  );
}

/**
 * Get sprite
 * @param {string} id Sprite ID
 * @param {string} fileName Sprite file name
 * @returns {Promise<Buffer>}
 */
export async function getSprite(id, fileName) {
  return await fsPromise.readFile(
    `${process.env.DATA_DIR}/sprites/${id}/${fileName}`
  );
}

/**
 * Get the size of Sprite folder path
 * @param {string} spriteDirPath Sprite dir path
 * @returns {Promise<number>}
 */
export async function getSpriteSize(spriteDirPath) {
  const fileNames = await findFiles(
    spriteDirPath,
    /^sprite(@\d+x)?\.(json|png)$/,
    false,
    true
  );

  let size = 0;

  for (const fileName of fileNames) {
    const stat = await fsPromise.stat(fileName);

    size += stat.size;
  }

  return size;
}
