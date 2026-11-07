#!/bin/sh
# Runs ON THE SERVER, called by .github/workflows/deploy.yml after the code is copied into DEPLOY_PATH.
#
# In order (any failure stops the deploy and leaves the running version up):
#   1. checks the server's .env (present, private, no example values left)
#   2. builds the new images while the old containers keep serving
#   3. dumps Postgres into the backups volume before migrations run
#   4. restarts the stack; the api container runs migrations + seed on start
#   5. waits for the API /health and the back-office to answer
# It never removes volumes: the data stays in wilson-prod_pgdata / wilson-prod_s3data.
set -eu

cd "$(dirname "$0")/../.."
COMPOSE="docker compose -f docker-compose.prod.yml"

fail() { echo "deploy: $*" >&2; exit 1; }

# 1. Server-side configuration
[ -f .env ] || fail "$(pwd)/.env is missing. Create it from .env.production.example (see docs/deploy.md)."
chmod 600 .env
for var in MASTER_KEY LOOKUP_KEY POSTGRES_PASSWORD S3_ACCESS_KEY S3_SECRET_KEY PUBLIC_ORIGIN SEED_ADMIN_EMAIL SEED_ADMIN_PASSWORD; do
  value=$(grep -E "^${var}=" .env | tail -n 1 | cut -d= -f2-)
  [ -n "$value" ] || fail "$var is empty in .env"
  case "$value" in
    *CHANGE_ME*|*change-me*|*example.org*) fail "$var still has its example value in .env" ;;
  esac
done
$COMPOSE config -q

# 2. Build first, so a broken build never takes the site down
$COMPOSE build --pull

# 3. Backup before migrations (skipped on the very first deploy, when there is no database yet)
if [ -n "$($COMPOSE ps --status running -q postgres 2>/dev/null)" ]; then
  name="predeploy-$(date -u +%Y%m%dT%H%M%SZ).dump"
  $COMPOSE run --rm --no-deps -T --entrypoint sh backup -c \
    "umask 077 && pg_dump -Fc -f /backups/$name.tmp && mv /backups/$name.tmp /backups/$name && ls -1t /backups/predeploy-*.dump | tail -n +11 | xargs -r rm -f --" \
    || fail "database backup failed, stopping before migrations"
  echo "deploy: database backed up to the backups volume as $name"
fi

# 4. Restart on the new images
$COMPOSE up -d --remove-orphans

# 5. Health
port=$(grep -E '^WILSON_PORT=' .env | tail -n 1 | cut -d= -f2-)
port=${port:-8080}
probe_frontend() {
  if command -v curl >/dev/null 2>&1; then curl -fsS -o /dev/null "http://127.0.0.1:$port/"; else wget -q -O /dev/null "http://127.0.0.1:$port/"; fi
}
i=0
until $COMPOSE exec -T api wget -q -O /dev/null http://127.0.0.1:3000/health 2>/dev/null && probe_frontend; do
  i=$((i + 1))
  if [ "$i" -ge 60 ]; then
    $COMPOSE ps
    $COMPOSE logs --tail 80 api
    fail "the app did not become healthy within 2 minutes"
  fi
  sleep 2
done

docker image prune -f >/dev/null
echo "deploy: OK, $(cat REVISION 2>/dev/null || echo unknown) is live"
