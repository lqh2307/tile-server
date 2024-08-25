#!/bin/sh

if [ -z "$DISPLAY" ]; then
  xvfb-run -a -s "-terminate -nolisten unix" node ./src/main.js "$@"
else
  node ./src/main.js "$@"
fi
