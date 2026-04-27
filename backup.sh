#!/bin/bash
# .env betöltése
set -a
source /opt/padli/.env
set +a

KEEP_DAYS=${BACKUP_KEEP_DAYS:-7}
BACKUP_DIR="/opt/backup"
DATE=$(date +%Y%m%d)
FILENAME="$BACKUP_DIR/padli-Sql_$DATE.sql"

mkdir -p "$BACKUP_DIR"

# Ments
sudo -u postgres pg_dump padli > "$FILENAME"

if [ $? -eq 0 ]; then
  echo "$(date) - Backup sikeres: $FILENAME"
  # Régi backupok törlése
  find "$BACKUP_DIR" -name "padliSql*.sql" -mtime +$KEEP_DAYS -delete
  echo "$(date) - $KEEP_DAYS napnál régebbi backupok törölve"
else
  echo "$(date) - Backup SIKERTELEN!" >&2
fi
