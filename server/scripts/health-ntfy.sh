#!/bin/bash
# Egészség-ellenőrzés → otthoni ntfy (2026-11-23). Cron: 2 percenként.
# Riaszt: honlap nem válaszol (2 egymás utáni hibánál), szolgáltatás leállt,
# összeomlott és újraindult (NRestarts nőtt), Postgres nem elérhető.
# Helyreálláskor „rendben” üzenet. Állapot: /var/lib/padli-health/
NTFY="$(grep -m1 '^NTFY_URL=' /opt/padli/.env | cut -d= -f2-)"
[ -z "$NTFY" ] && exit 0
ST=/var/lib/padli-health
send() { # cím, üzenet, prioritás, tag
  python3 - "$NTFY" "$1" "$2" "$3" "$4" <<'PY'
import json, sys, urllib.request, urllib.parse
url, title, msg, prio, tag = sys.argv[1:6]
u = urllib.parse.urlparse(url)
body = json.dumps({"topic": u.path.strip("/"), "title": title, "message": msg[:3500], "priority": int(prio), "tags": [tag]}).encode()
try: urllib.request.urlopen(urllib.request.Request(f"{u.scheme}://{u.netloc}/", body, {"Content-Type": "application/json"}), timeout=8)
except Exception as e: print("ntfy hiba:", e)
PY
}
# check <név> <ok?0/1> <hibaüzenet> [küszöb]
check() {
  local name=$1 ok=$2 msg=$3 need=${4:-1} f="$ST/$1.fail"
  if [ "$ok" = 0 ]; then
    [ -f "$f.sent" ] && { rm -f "$f" "$f.sent"; send "PadlizsanFanSub – rendben" "✅ $name: újra rendben." 3 white_check_mark; }
    rm -f "$f"; return
  fi
  local n=$(( $(cat "$f" 2>/dev/null || echo 0) + 1 )); echo $n > "$f"
  if [ $n -ge $need ] && [ ! -f "$f.sent" ]; then touch "$f.sent"; send "PadlizsanFanSub – HIBA" "🔴 $msg" 5 rotating_light; fi
}

code=$(curl -s -o /dev/null -w "%{http_code}" -m 10 http://localhost:3000/api/online-count)
[ "$code" = 200 ]; check honlap $? "A honlap nem válaszol (HTTP $code) — padlizsanfansub.service" 2

pg_isready -q -t 5; check postgres $? "A Postgres adatbázis nem elérhető" 2

for u in padlizsanfansub padli-api anilist-worker; do
  systemctl is-active -q $u; check "svc-$u" $? "A(z) $u szolgáltatás nem fut ($(systemctl is-active $u))"
  # Összeomlás + automatikus újraindulás: nő az NRestarts (kézi restart nem növeli)
  r=$(systemctl show $u -p NRestarts --value); p=$(cat "$ST/$u.nrestarts" 2>/dev/null || echo "$r"); echo "$r" > "$ST/$u.nrestarts"
  if [ "$r" -gt "$p" ] 2>/dev/null; then
    log=$(journalctl -u $u -n 200 --no-pager -o cat 2>/dev/null | grep -iE "error|exception|fatal|killed|oom" | tail -5)
    send "PadlizsanFanSub – összeomlás" "⚠️ A(z) $u összeomlott és újraindult ($((r-p))×). Utolsó hibák:
${log:-(nincs hibasor a naplóban)}" 4 warning
  fi
done
