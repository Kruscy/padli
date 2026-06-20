#!/bin/bash
# Kavita képek biztonsági mentése /mnt/manga2/backup/Kavita-ra,
# majd törlésük az eredeti helyről (csak mappák maradnak).
# Futtatás előtt győződj meg róla, hogy minden kép fent van R2-ben!

set -euo pipefail

SRC="/mnt/manga/Kavita"
DST="/mnt/manga2/backup/Kavita"
LOG="/opt/padli/logs/kavita-backup-$(date +%Y%m%d-%H%M).log"

echo "$(date) === Kavita backup indulás ===" | tee -a "$LOG"
echo "Forrás: $SRC" | tee -a "$LOG"
echo "Cél:    $DST" | tee -a "$LOG"

# 1. Backup mappa létrehozása
mkdir -p "$DST"

# 2. Képek másolása (struktúra megőrzésével, find + cp)
echo "$(date) Képek másolása indul..." | tee -a "$LOG"
COPY_COUNT=0
while IFS= read -r -d '' srcfile; do
  relpath="${srcfile#$SRC/}"
  dstfile="$DST/$relpath"
  dstdir="$(dirname "$dstfile")"
  mkdir -p "$dstdir"
  cp "$srcfile" "$dstfile"
  COPY_COUNT=$((COPY_COUNT + 1))
  if [ $((COPY_COUNT % 1000)) -eq 0 ]; then
    echo "$(date) Másolva: $COPY_COUNT" | tee -a "$LOG"
  fi
done < <(find "$SRC" -type f \( \
  -name "*.jpg" -o -name "*.jpeg" -o \
  -name "*.png" -o -name "*.webp" -o \
  -name "*.gif" -o -name "*.avif" \
\) -print0)

echo "$(date) Másolás kész. Összesen: $COPY_COUNT fájl" | tee -a "$LOG"

# 3. Ellenőrzés: összeszámoljuk az átmásolt és az eredetiben lévő képeket
SRC_COUNT=$(find "$SRC" -type f \( -name "*.jpg" -o -name "*.jpeg" -o -name "*.png" -o -name "*.webp" -o -name "*.gif" -o -name "*.avif" \) | wc -l)
DST_COUNT=$(find "$DST" -type f \( -name "*.jpg" -o -name "*.jpeg" -o -name "*.png" -o -name "*.webp" -o -name "*.gif" -o -name "*.avif" \) | wc -l)

echo "$(date) Forrásban: $SRC_COUNT kép | Backupban: $DST_COUNT kép" | tee -a "$LOG"

if [ "$SRC_COUNT" -ne "$DST_COUNT" ]; then
  echo "$(date) ❌ HIBA: A képek száma nem egyezik! Törlés megszakítva." | tee -a "$LOG"
  exit 1
fi

echo "$(date) ✅ Képszám egyezik. Törlés indul..." | tee -a "$LOG"

# 4. Képek törlése az eredeti helyről (mappák megmaradnak)
find "$SRC" -type f \( \
  -name "*.jpg" -o -name "*.jpeg" -o \
  -name "*.png" -o -name "*.webp" -o \
  -name "*.gif" -o -name "*.avif" \
\) -delete

REMAINING=$(find "$SRC" -type f | wc -l)
echo "$(date) Törlés kész. Maradék fájl SRC-ben: $REMAINING" | tee -a "$LOG"
echo "$(date) === Backup befejezve ===" | tee -a "$LOG"
