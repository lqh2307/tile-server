"use strict";

import sharp from "sharp";

/**
 * Render image
 * @param {Buffer} data Image data buffer
 * @param {number} scale Scale
 * @param {number} compression Compression level
 * @param {256|512} size Image size
 * @param {number} z Zoom level
 * @returns {Promise<Buffer>}
 */
export async function processImage(data, scale, compression, size, z) {
  if (z === 0 && size === 256) {
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
        width: size * scale,
        height: size * scale,
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
 * Check if PNG image file/buffer is full transparent (alpha = 0)
 * @param {string|Buffer} filePathOrBuffer Path/Buffer of the PNG image
 * @returns {Promise<boolean>}
 */
export async function isFullTransparentPNGImage(filePathOrBuffer) {
  try {
    const { data, info } = await sharp(filePathOrBuffer).raw().toBuffer({
      resolveWithObject: true,
    });

    for (let i = 0; i < info.width * info.height * 4; i += 4) {
      if (data[i + 3] !== 0) {
        return false;
      }
    }

    return true;
  } catch (error) {
    return false;
  }
}
