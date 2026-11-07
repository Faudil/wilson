# Backup job: pg_dump (same major as the database) + age (encryption) + rclone (off-site copy, any S3 or SFTP).
FROM postgres:17-alpine
RUN apk add --no-cache age rclone curl
COPY scripts/deploy/backup.sh /backup.sh
ENTRYPOINT ["/bin/sh", "/backup.sh"]
