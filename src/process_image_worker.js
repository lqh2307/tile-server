"use strict";

import { processImage } from "./utils.js";
import {
  parentPort,
  workerData,
} from "node:worker_threads";

(async () => {
  try {
    const data = await processImage(
      workerData.data,
      workerData.scale,
      workerData.compression,
      workerData.tileSize,
      workerData.z
    );

    parentPort.postMessage({
      data: data,
    });
  } catch (error) {
    parentPort.postMessage({
      error: error.message,
    });
  }
})();
