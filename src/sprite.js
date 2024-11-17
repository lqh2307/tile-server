"use strict";

import fsPromise from "node:fs/promises";
import { findFiles } from "./utils.js";
import { config } from "./config.js";
import sharp from "sharp";

/**
 * Validate sprite
 * @param {string} spriteDirPath Sprite dir path
 * @returns {Promise<void>}
 */
export async function validateSprite(spriteDirPath) {
  const [jsonSpriteFileNames, pngSpriteNames] = await Promise.all([
    findFiles(spriteDirPath, /^sprite(@\d+x)?\.json$/, false),
    findFiles(spriteDirPath, /^sprite(@\d+x)?\.png$/, false),
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
 * Get sprite
 * @param {string} id Sprite ID
 * @param {string} fileName Sprite file name
 * @returns {Promise<Buffer>}
 */
export async function getSprite(id, fileName) {
  return await fsPromise.readFile(`${config.paths.sprites}/${id}/${fileName}`);
}
