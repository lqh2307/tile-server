#!/bin/sh

# setup task
REMOVE_OLD_CACHE_OPTION=""
if [ "$REMOVE_OLD_CACHE_LOCKS" = "YES" ]; then
  REMOVE_OLD_CACHE_OPTION="-r"
fi

SEED_TASK_OPTION=""
if [ "$SEED_TASK" = "YES" ]; then
  SEED_TASK_OPTION="-s"
fi

CLEAN_UP_TASK_OPTION=""
if [ "$CLEAN_UP_TASK" = "YES" ]; then
  CLEAN_UP_TASK_OPTION="-c"
fi

if [ "$SEED_TASK" = "YES" ] || [ "$CLEAN_UP_TASK" = "YES" ] || [ "$REMOVE_OLD_CACHE_LOCKS" = "YES" ] ; then
  node ./src/seed_and_cleanup.js $SEED_TASK_OPTION $CLEAN_UP_TASK_OPTION $REMOVE_OLD_CACHE_OPTION
fi

# setup server
if [ "$START_SERVER" != "NO" ]; then
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
fi
