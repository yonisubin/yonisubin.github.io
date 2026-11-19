#!/usr/bin/env bash
# Weekly backup of the only data that can't be rebuilt from the Knesset API: accounts,
# follows, push devices and notifications. Run from your own machine (cron or by hand):
#
#   DATABASE_URL='postgresql://user:pass@ep-xxx.neon.tech/db?sslmode=require' ops/backup_users.sh
#
# Writes ~/knesset-tracker-backups/users-YYYY-MM-DD.dump (custom format, compressed),
# readable only by you, and keeps the last 8. These files contain email addresses:
# never commit them, upload them to CI artifacts, or store them in a public place.
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL to the Neon connection string}"
URL="${DATABASE_URL/postgresql+psycopg:/postgresql:}"   # accept the SQLAlchemy form too
URL="${URL/postgresql+pg8000:/postgresql:}"
DIR="${BACKUP_DIR:-$HOME/knesset-tracker-backups}"
mkdir -p "$DIR" && chmod 700 "$DIR"
OUT="$DIR/users-$(date +%F).dump"
umask 077
pg_dump "$URL" --format=custom --no-owner --no-privileges \
  --table=app_user --table=subscription --table=push_subscription --table=notification \
  --file="$OUT"
echo "wrote $OUT ($(du -h "$OUT" | cut -f1))"
ls -1t "$DIR"/users-*.dump | tail -n +9 | xargs -r rm --
# Restore into a database that already has the schema (alembic upgrade head):
#   pg_restore --data-only --disable-triggers -d "$URL" "$OUT"
