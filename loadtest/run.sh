#!/usr/bin/env bash
# Load-test driver. Run from the repo root:
#   loadtest/run.sh up                  build and start the stack (API and worker as separate containers)
#   loadtest/run.sh <scenario> [k6 args] run browse | search | pricing | checkout | webhooks | soak | smoke
#   loadtest/run.sh metrics [window]    server-side metrics from Prometheus
#   loadtest/run.sh down                stop and remove the stack and its volumes
set -euo pipefail
cd "$(dirname "$0")/.."

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-sfload}"
COMPOSE=(docker compose -f docker-compose.yml -f loadtest/docker-compose.loadtest.yml)
mkdir -p loadtest/results

k6() {
  local name="$1"
  shift
  "${COMPOSE[@]}" --profile loadtest run --rm --no-deps -T k6 run \
    --summary-export "/loadtest/results/${name}.json" \
    --summary-trend-stats 'avg,med,p(90),p(95),p(99),max' \
    "$@" "scenarios/${name}.js"
}

case "${1:-}" in
  up)
    "${COMPOSE[@]}" --profile observability up -d --build --wait mongo redis meilisearch api worker prometheus grafana
    "${COMPOSE[@]}" run --rm search-index
    ;;
  down)
    "${COMPOSE[@]}" --profile observability --profile loadtest down -v --remove-orphans
    ;;
  browse | search | pricing | soak)
    scenario="$1"
    shift
    k6 "$scenario" "$@"
    ;;
  checkout)
    shift
    node loadtest/setup/fixtures.mjs checkout
    k6 checkout-spike "$@" || status=$?
    node loadtest/setup/verify.mjs checkout
    exit "${status:-0}"
    ;;
  webhooks)
    shift
    node loadtest/setup/fixtures.mjs webhooks
    k6 webhook-burst "$@" || status=$?
    node loadtest/setup/verify.mjs webhooks
    exit "${status:-0}"
    ;;
  smoke)
    k6 browse -e RATE=40 -e DURATION=20s
    k6 pricing -e RATE=15 -e DURATION=20s
    HOT_STOCK=20 BUYERS=80 node loadtest/setup/fixtures.mjs checkout
    k6 checkout-spike
    node loadtest/setup/verify.mjs checkout
    ;;
  metrics)
    node loadtest/setup/metrics.mjs "${2:-3m}"
    ;;
  *)
    sed -n '2,7p' "$0"
    exit 1
    ;;
esac
