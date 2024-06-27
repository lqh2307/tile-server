#!/bin/sh

xvfb-run -n 99 node ./src/main.js "$@"
