"use strict";

import path from "node:path";
import { printLog, validateSVGIcon } from "./utils.js";

export const serve_icon = {
  add: async (config) => {
    const iconsPath = config.options.paths.icons;
    const icons = config.icons;

    await Promise.all(
      icons.map(async (icon) => {
        try {
          const iconFilePath = path.resolve(iconsPath, icon);

          /* Validate icon */
          validateSVGIcon(iconFilePath);

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
