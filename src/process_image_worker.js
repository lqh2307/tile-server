import { parentPort, workerData } from "node:worker_threads";
import { processImage } from "./utils.js";

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
