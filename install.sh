#!/usr/bin/env bash
set -e

echo "======================================="
echo " PadlizsanFanSub – Full Install Script "
echo "======================================="

# -------- CONFIG --------
APP_DIR="/opt/padli"
DB_NAME="padli"
DB_USER="padli"
DB_PASS="padli_pass"
DB_HOST="localhost"
DB_PORT="5432"

NODE_VERSION="20"
# ------------------------

echo "[1/9] System update"
apt update && apt upgrade -y

echo "[2/9] Installing base packages"
apt install -y curl ca-certificates gnupg lsb-release git

echo "[3/9] Installing Node.js ${NODE_VERSION}"
curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
apt install -y nodejs

echo "Node version:"
node -v
npm -v

echo "[4/9] Installing PostgreSQL"
apt install -y postgresql postgresql-contrib

systemctl enable postgresql
systemctl start postgresql

echo "[5/9] Creating database and user"
sudo -u postgres psql <<EOF
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}';
  END IF;
END
\$\$;

CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};
GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};
EOF

echo "[6/9] Creating tables"
sudo -u postgres psql -d ${DB_NAME} <<'EOF'
CREATE TABLE IF NOT EXISTS library (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  enabled BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS manga (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  folder TEXT,
  library_id INTEGER,
  anilist_id INTEGER,
  cover_url TEXT,
  description TEXT,
  UNIQUE (slug, library_id),
  FOREIGN KEY (library_id) REFERENCES library(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chapter (
  id SERIAL PRIMARY KEY,
  manga_id INTEGER NOT NULL,
  folder TEXT NOT NULL,
  title TEXT,
  FOREIGN KEY (manga_id) REFERENCES manga(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS genre (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS manga_genre (
  manga_id INTEGER REFERENCES manga(id) ON DELETE CASCADE,
  genre_id INTEGER REFERENCES genre(id) ON DELETE CASCADE,
  PRIMARY KEY (manga_id, genre_id)
);

CREATE INDEX IF NOT EXISTS idx_manga_slug ON manga(slug);
CREATE INDEX IF NOT EXISTS idx_chapter_manga ON chapter(manga_id);
EOF

echo "[7/9] Inserting default library"
sudo -u postgres psql -d ${DB_NAME} <<EOF
INSERT INTO library (name, path, enabled)
VALUES ('Default', '/mnt/manga', true)
ON CONFLICT DO NOTHING;
EOF

echo "[8/9] Installing Node dependencies"
cd ${APP_DIR}
npm install

echo "[9/9] Creating .env file"
cat > .env <<EOF
PORT=3000

DB_HOST=${DB_HOST}
DB_PORT=${DB_PORT}
DB_NAME=${DB_NAME}
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASS}

MANGA_ROOT=/mnt/manga
EOF

echo "======================================="
echo " INSTALL FINISHED SUCCESSFULLY "
echo "======================================="
echo ""
echo "Next steps:"
echo "  cd /opt/padli"
echo "  node server/scan.js"
echo "  node server/index.js"
echo ""
echo "Optional:"
echo "  systemctl service setup"
