"use strict";

import path from "node:path";
import { printLog, validateSVGIcon } from "./utils.js";

export const serve_icon = {
  remove: async (config) => {
    config.repo.icons = [];
  },

  add: async (config) => {
    const icons = config.icons;

    await Promise.all(
      icons.map(async (icon) => {
        try {
          /* Validate icon */
          validateSVGIcon(path.resolve(config.options.paths.icons, icon));

          config.repo.icons.push(icon);
        } catch (error) {
          printLog(
            "error",
            `Failed to load icon "${icon}": ${error}. Skipping...`
          );
        }
      })
    );
  },
};
