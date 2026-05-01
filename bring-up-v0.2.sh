#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

docker network inspect zoe_czar >/dev/null 2>&1 || docker network create zoe_czar >/dev/null

docker compose -f docker-compose.v0.2.yml down --remove-orphans || true
docker compose -f docker-compose.v0.2.yml build edge-nginx sample-ui zar-backend
docker compose -f docker-compose.v0.2.yml up -d edge-nginx sample-ui zar-backend openfga
