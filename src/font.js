"use strict";

import { getDataFromURL, findFiles, delay, retry } from "./utils.js";
import fsPromise from "node:fs/promises";
import protobuf from "protocol-buffers";
import { printLog } from "./logger.js";
import { config } from "./config.js";
import fs from "node:fs";

const glyphsProto = protobuf(fs.readFileSync("public/protos/glyphs.proto"));

/**
 * Create font file with lock
 * @param {string} filePath File path to store font file
 * @param {Buffer} data Font buffer
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<void>}
 */
async function createFontFile(filePath, data, timeout) {
  const startTime = Date.now();

  const lockFilePath = `${filePath}.lock`;
  let lockFileHandle;

  while (Date.now() - startTime <= timeout) {
    try {
      lockFileHandle = await fsPromise.open(lockFilePath, "wx");

      const tempFilePath = `${filePath}.tmp`;

      try {
        await fsPromise.mkdir(path.dirname(filePath), {
          recursive: true,
        });

        await fsPromise.writeFile(tempFilePath, data);

        await fsPromise.rename(tempFilePath, filePath);
      } catch (error) {
        await fsPromise.rm(tempFilePath, {
          force: true,
        });

        throw error;
      }

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

        continue;
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

  throw new Error(`Timeout to access lock file`);
}

/**
 * Remove font file with lock
 * @param {string} filePath File path to remove font file
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<void>}
 */
export async function removeFontFile(filePath, timeout) {
  const startTime = Date.now();

  const lockFilePath = `${filePath}.lock`;
  let lockFileHandle;

  while (Date.now() - startTime <= timeout) {
    try {
      lockFileHandle = await fsPromise.open(lockFilePath, "wx");

      await fsPromise.rm(filePath, {
        force: true,
      });

      await lockFileHandle.close();

      await fsPromise.rm(lockFilePath, {
        force: true,
      });

      return;
    } catch (error) {
      if (error.code === "ENOENT") {
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

  throw new Error(`Timeout to access lock file`);
}

/**
 * Cache font file
 * @param {string} sourcePath Font folder path
 * @param {string} fontStack Fontstack
 * @param {Buffer} data Font buffer
 * @returns {Promise<void>}
 */
export async function cacheFontFile(sourcePath, fontStack, data) {
  await createFontFile(
    `${sourcePath}/${fontStack}.pbf`,
    data,
    300000 // 5 mins
  );
}

/**
 * Download font file
 * @param {string} url The URL to download the file from
 * @param {string} id Font ID
 * @param {string} fontStack Fontstack
 * @param {number} maxTry Number of retry attempts on failure
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<void>}
 */
export async function downloadFontFile(url, id, fontStack, maxTry, timeout) {
  await retry(async () => {
    try {
      // Get data from URL
      const response = await getDataFromURL(url, timeout, "arraybuffer");

      // Store data to file
      await cacheFontFile(
        `${process.env.DATA_DIR}/caches/fonts/${id}`,
        fontStack,
        response.data
      );
    } catch (error) {
      printLog(
        "error",
        `Failed to download font stack "${fontStack}" from "${url}": ${error}`
      );

      if (error.statusCode !== undefined) {
        if (
          error.statusCode === StatusCodes.NO_CONTENT ||
          error.statusCode === StatusCodes.NOT_FOUND
        ) {
          return;
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }
  }, maxTry);
}

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
          `Failed to get font "${font}": ${error}. Using fallback font "Open Sans Regular"...`
        );

        return await fsPromise.readFile(
          `public/resources/fonts/Open Sans Regular/${fileName}`
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
