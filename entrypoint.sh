#!/bin/sh

while true; do
  if [ -z "$DISPLAY" ]; then
    xvfb-run -a -s "-terminate -nolisten unix" node ./src/main.js "$@"
  else
    node ./src/main.js "$@"
  fi

  EXIT_CODE=$?

  if [ $EXIT_CODE -eq 0 ]; then
    break
  else
    if [ $EXIT_CODE -ne 1 ]; then
      echo "Exited with code: $EXIT_CODE. Restarting after 5 seconds..."

      sleep 5
    fi
  fi
done
