#!/bin/sh

while true; do
  if [ -z "$DISPLAY" ] && [ $XVFB_STARTED -eq 0 ]; then
    xvfb-run -a -s "-terminate -nolisten unix" node ./src/main.js "$@"

    XVFB_STARTED=1
  else
    node ./src/main.js "$@"
  fi

  EXIT_CODE=$?

  if [ $EXIT_CODE -eq 0 ]; then
    break
  elif [ $EXIT_CODE -ne 1 ]; then
    echo "Server exited with code: $EXIT_CODE. Restarting server after 5 seconds..."

    sleep 5
  fi
done
