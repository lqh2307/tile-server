"use strict";

import fsPromise from "node:fs/promises";
import protobuf from "protocol-buffers";
import { printLog } from "./logger.js";
import { findFiles } from "./utils.js";
import { config } from "./config.js";
import fs from "node:fs";

const glyphsProto = protobuf(fs.readFileSync("public/protos/glyphs.proto"));
const fallbackFont = "Open Sans Regular";

/**
 * Validate font
 * @param {string} pbfDirPath PBF font dir path
 * @returns {Promise<void>}
 */
export async function validateFont(pbfDirPath) {
  const pbfFileNames = await findFiles(pbfDirPath, /^\d{1,5}-\d{1,5}\.pbf$/);

  if (pbfFileNames.length === 0) {
    throw new Error("Missing some PBF files");
  }
}

/**
 * Get fonts pbf
 * @param {string} ids Font IDs
 * @param {string} fileName Font file name
 * @returns {Promise<Buffer>}
 */
export async function getFonts(ids, fileName) {
  /* Get font datas */
  const buffers = await Promise.all(
    ids.split(",").map(async (font) => {
      try {
        /* Check font is exist? */
        if (config.repo.fonts[font] === undefined) {
          throw new Error("Font is not found");
        }

        return await fsPromise.readFile(
          `${config.dataDir}/fonts/${font}/${fileName}`
        );
      } catch (error) {
        printLog(
          "warning",
          `Failed to get font "${font}": ${error}. Using fallback font "${fallbackFont}"...`
        );

        return await fsPromise.readFile(
          `public/resources/fonts/${fallbackFont}/${fileName}`
        );
      }
    })
  );

  /* Merge font datas */
  let result;
  const coverage = {};

  for (const buffer of buffers) {
    const decoded = glyphsProto.glyphs.decode(buffer);
    const glyphs = decoded.stacks[0].glyphs;

    if (result === undefined) {
      for (const glyph of glyphs) {
        coverage[glyph.id] = true;
      }

      result = decoded;
    } else {
      for (const glyph of glyphs) {
        if (coverage[glyph.id] === undefined) {
          result.stacks[0].glyphs.push(glyph);

          coverage[glyph.id] = true;
        }
      }

      result.stacks[0].name += ", " + decoded.stacks[0].name;
    }
  }

  result.stacks[0].glyphs.sort((a, b) => a.id - b.id);

  return glyphsProto.glyphs.encode(result);
}
