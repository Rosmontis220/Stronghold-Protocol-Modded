#!/usr/bin/env bash
# Update the fused application while reusing the independently mounted resources.
set -euo pipefail
DIR=/opt/Stronghold-Fused
RESOURCE_ROOT=/opt/stronghold-resources
test -d "$DIR/.git" || test -f "$DIR/.git"
test -d "$RESOURCE_ROOT/assets"
git -C "$DIR" fetch origin master
git -C "$DIR" reset --hard origin/master
mkdir -p "$DIR/.deploy"
chmod 777 "$DIR/.deploy"
docker build -t stronghold-protocol:fused --build-arg FETCH_ASSETS=0 "$DIR"
docker compose -f "$DIR/compose.production.yml" up -d --no-build
for attempt in $(seq 1 30); do
  if curl -fsS --max-time 5 http://127.0.0.1:3001/resource-manifest.json >/dev/null && curl -fsS --max-time 5 http://127.0.0.1:3001/healthz; then
    exit 0
  fi
  sleep 2
done
docker logs --tail 50 stronghold-fused
exit 1
