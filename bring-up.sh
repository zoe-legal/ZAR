#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

docker network inspect zoe_czar >/dev/null 2>&1 || docker network create zoe_czar >/dev/null

docker compose down --remove-orphans
docker compose build --no-cache edge-nginx sample-ui zar-backend
docker compose up -d edge-nginx sample-ui zar-backend
