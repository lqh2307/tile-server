#!/bin/sh

export DISPLAY=:99

Xvfb "${DISPLAY}" -nolisten unix & exec node src/main.js "$@"
