#!/bin/sh
# Roles share one image: `api` migrates then serves, `worker` consumes jobs, `migrate` only migrates.
# `exec` makes node PID 1 so SIGTERM reaches the graceful-shutdown handler directly.
set -e
RUN="node --import tsx"
TRACE="--import ./src/instrumentation.ts"

case "${1:-api}" in
  api)
    $RUN src/db/cli.ts setup
    exec $RUN $TRACE src/server.ts
    ;;
  worker)
    exec $RUN $TRACE src/worker.ts
    ;;
  migrate)
    exec $RUN src/db/cli.ts setup
    ;;
  reindex)
    exec $RUN src/modules/search/reindex.cli.ts
    ;;
  *)
    exec "$@"
    ;;
esac
