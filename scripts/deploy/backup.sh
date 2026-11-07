#!/bin/sh
# Daily backup, run by the `backup` service of docker-compose.prod.yml (image docker/backup.Dockerfile).
#
# 1. Postgres dump to /backups/daily-YYYYMMDD.dump (pg_dump custom format), kept BACKUP_KEEP_DAYS days on the server.
# 2. Off-site copy (when BACKUP_S3_BUCKET is set): the dump is encrypted with `age` for BACKUP_AGE_RECIPIENT (a public
#    key: the private key is NOT on the server, so a seized or hacked server cannot read the off-site copies), then
#    uploaded with rclone. The document blobs are copied too; they are already encrypted by the API.
#    Nothing is ever sent off-site unencrypted: without BACKUP_AGE_RECIPIENT the off-site step refuses to run.
# 3. On failure, an alert to ALERT_WEBHOOK_URL (if set).
#
# BACKUP_NOW=1 runs once and exits (for testing: `docker compose -f docker-compose.prod.yml run --rm -e BACKUP_NOW=1 backup`).
# Restore: see docs/deploy.md and docs/security.md.
set -eu
umask 077
: "${BACKUP_HOUR:=3}" "${BACKUP_KEEP_DAYS:=14}" "${BACKUP_S3_PREFIX:=wilson}" "${BACKUP_DIR:=/backups}"

alert() {
  echo "backup: $*" >&2
  if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
    msg="Wilson backup: $*"
    curl -fsS -m 10 -H 'content-type: application/json' -d "{\"text\":\"$msg\",\"content\":\"$msg\"}" "$ALERT_WEBHOOK_URL" >/dev/null || true
  fi
}

offsite_configured() { [ -n "${BACKUP_S3_BUCKET:-}" ]; }

if offsite_configured; then
  [ -n "${BACKUP_AGE_RECIPIENT:-}" ] || { alert "BACKUP_S3_BUCKET is set but BACKUP_AGE_RECIPIENT is empty: refusing to send unencrypted backups off-site"; exit 1; }
  # rclone remotes from environment variables, no config file: "offsite" (EU bucket) and "local" (bundled SeaweedFS).
  export RCLONE_CONFIG_OFFSITE_TYPE=s3 RCLONE_CONFIG_OFFSITE_PROVIDER="${BACKUP_S3_PROVIDER:-Other}" \
    RCLONE_CONFIG_OFFSITE_ENDPOINT="${BACKUP_S3_ENDPOINT:-}" RCLONE_CONFIG_OFFSITE_REGION="${BACKUP_S3_REGION:-}" \
    RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID="${BACKUP_S3_ACCESS_KEY:-}" RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET_KEY:-}" \
    RCLONE_CONFIG_OFFSITE_NO_CHECK_BUCKET=true
  export RCLONE_CONFIG_LOCAL_TYPE=s3 RCLONE_CONFIG_LOCAL_PROVIDER=Other RCLONE_CONFIG_LOCAL_ENDPOINT="${S3_ENDPOINT:-http://s3:9000}" \
    RCLONE_CONFIG_LOCAL_ACCESS_KEY_ID="${S3_ACCESS_KEY:-}" RCLONE_CONFIG_LOCAL_SECRET_ACCESS_KEY="${S3_SECRET_KEY:-}" \
    RCLONE_CONFIG_LOCAL_REGION="${S3_REGION:-us-east-1}" RCLONE_CONFIG_LOCAL_FORCE_PATH_STYLE=true
fi

run_backup() {
  stamp=$(date +%Y%m%d)
  file="$BACKUP_DIR/daily-$stamp.dump"
  if [ ! -s "$file" ]; then
    if pg_dump -Fc -f "$file.tmp"; then
      mv "$file.tmp" "$file"
      echo "backup: wrote $file"
    else
      rm -f "$file.tmp"
      alert "pg_dump failed"
      return 1
    fi
  fi
  find "$BACKUP_DIR" -name '*.dump' -type f -mtime "+$BACKUP_KEEP_DAYS" -delete
  find "$BACKUP_DIR" -name '*.age' -type f -delete

  offsite_configured || return 0
  enc="$BACKUP_DIR/daily-$stamp.dump.age"
  if ! age -r "$BACKUP_AGE_RECIPIENT" -o "$enc" "$file"; then
    rm -f "$enc"
    alert "encryption failed (check BACKUP_AGE_RECIPIENT)"
    return 1
  fi
  dest="offsite:$BACKUP_S3_BUCKET/$BACKUP_S3_PREFIX"
  if ! rclone copyto --s3-no-check-bucket "$enc" "$dest/db/daily-$stamp.dump.age"; then
    rm -f "$enc"
    alert "upload of the database backup failed"
    return 1
  fi
  rm -f "$enc"
  echo "backup: encrypted copy uploaded to $dest/db/"
  touch "$BACKUP_DIR/.offsite-$stamp"
  find "$BACKUP_DIR" -name '.offsite-*' -type f -mtime +3 -delete
  # Encrypted document blobs: copy new files, never delete off-site (a wiped server must not wipe the copy).
  if [ -n "${S3_ACCESS_KEY:-}" ] && ! rclone copy --s3-no-check-bucket "local:${S3_BUCKET:-wilson}" "$dest/blobs"; then
    alert "copy of the document blobs failed"
    return 1
  fi
  # Optional pruning. Better: a lifecycle rule on the bucket and a key that cannot delete (see docs/security.md).
  if [ -n "${BACKUP_REMOTE_KEEP_DAYS:-}" ]; then
    rclone delete --min-age "${BACKUP_REMOTE_KEEP_DAYS}d" "$dest/db" || alert "pruning old off-site backups failed"
  fi
}

if [ "${BACKUP_NOW:-}" = "1" ]; then
  run_backup
  exit $?
fi

done_today() {
  stamp=$(date +%Y%m%d)
  if offsite_configured; then [ -f "$BACKUP_DIR/.offsite-$stamp" ]; else [ -s "$BACKUP_DIR/daily-$stamp.dump" ]; fi
}

# Every 10 minutes during BACKUP_HOUR until today's backup (and its off-site copy) succeeded.
while true; do
  if [ "$(date +%H)" -eq "$BACKUP_HOUR" ] && ! done_today; then
    run_backup || true
  fi
  sleep 600
done
