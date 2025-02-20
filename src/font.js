"use strict";

import fsPromise from "node:fs/promises";
import protobuf from "protocol-buffers";
import { printLog } from "./logger.js";
import { findFiles } from "./utils.js";
import { config } from "./config.js";
import fs from "node:fs";

const glyphsProto = protobuf(fs.readFileSync("public/protos/glyphs.proto"));

/**
 * Validate font
 * @param {string} pbfDirPath PBF font dir path
 * @returns {Promise<void>}
 */
export async function validateFont(pbfDirPath) {
  const pbfFileNames = await findFiles(
    pbfDirPath,
    /^\d{1,5}-\d{1,5}\.pbf$/,
    false,
    false
  );

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
          throw new Error("Font does not exist");
        }

        return await fsPromise.readFile(
          `${process.env.DATA_DIR}/fonts/${font}/${fileName}`
        );
      } catch (error) {
        printLog(
          "warning",
          `Failed to get font "${font}": ${error}. Using fallback font "${process.env.FALLBACK_FONT}"...`
        );

        return await fsPromise.readFile(
          `public/resources/fonts/${process.env.FALLBACK_FONT}/${fileName}`
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

/**
 * Get the size of Font folder path
 * @param {string} pbfDirPath Font dir path
 * @returns {Promise<number>}
 */
export async function getFontSize(pbfDirPath) {
  const fileNames = await findFiles(
    pbfDirPath,
    /^\d{1,5}-\d{1,5}\.pbf$/,
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
