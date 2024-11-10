#!/bin/sh

./seed-and-cleanup-entrypoint.sh $SEED_AND_CLEAN_UP_PARAMS

./server-entrypoint.sh $SERVER_PARAMS
