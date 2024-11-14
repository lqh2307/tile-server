#!/bin/sh

while true; do
  if [ -z "$DISPLAY" ]; then
    xvfb-run -a -s "-terminate -nolisten unix" node --max-old-space-size=4096 ./src/main.js "$@"
  else
    node --max-old-space-size=4096 ./src/main.js "$@"
  fi

  EXIT_CODE=$?

  if [ $EXIT_CODE -eq 0 ]; then
    break
  else
    if [ $EXIT_CODE -ne 1 ]; then
      echo "Server exited with code: $EXIT_CODE. Restarting server after 5 seconds..."

      sleep 5
    fi
  fi
done
