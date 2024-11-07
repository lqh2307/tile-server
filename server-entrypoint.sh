#!/bin/sh

# setup task
REMOVE_OPTION=""
if [ "$REMOVE_OLD_CACHE_LOCKS" = "YES" ]; then
  REMOVE_OPTION="-r"
fi

if [ "$SEED_TASK" = "YES" ] && [ "$CLEAN_UP_TASK" = "YES" ]; then
  node ./src/seed_and_cleanup.js -c -s $REMOVE_OPTION
elif [ "$SEED_TASK" = "YES" ]; then
  node ./src/seed_and_cleanup.js -s $REMOVE_OPTION
elif [ "$CLEAN_UP_TASK" = "YES" ]; then
  node ./src/seed_and_cleanup.js -c $REMOVE_OPTION
fi

# setup server
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
      echo "Server exited with code: $EXIT_CODE. Restarting server after 5 seconds..."

      sleep 5
    fi
  fi
done
