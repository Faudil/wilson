#!/bin/sh
# Daily Postgres dump, run by the `backup` service of docker-compose.prod.yml.
# Writes /backups/daily-YYYYMMDD.dump (pg_dump custom format) once a day at BACKUP_HOUR,
# and deletes dumps older than BACKUP_KEEP_DAYS. Restore: see docs/deploy.md.
set -eu
umask 077
: "${BACKUP_HOUR:=3}" "${BACKUP_KEEP_DAYS:=14}"

while true; do
  if [ "$(date +%H)" -eq "$BACKUP_HOUR" ]; then
    file="/backups/daily-$(date +%Y%m%d).dump"
    if [ ! -s "$file" ]; then
      if pg_dump -Fc -f "$file.tmp"; then
        mv "$file.tmp" "$file"
        echo "backup: wrote $file"
      else
        rm -f "$file.tmp"
        echo "backup: pg_dump failed" >&2
      fi
      find /backups -name '*.dump' -type f -mtime "+$BACKUP_KEEP_DAYS" -delete
    fi
  fi
  sleep 600
done
