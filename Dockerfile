FROM node:22-alpine

WORKDIR /app

# Függőségek külön rétegben — cache-barát. A sharp és a bcrypt natív
# moduljaihoz szükséges fordítóeszközök csak a telepítés idejére kellenek,
# utána eltávolítjuk őket (kisebb image, kevesebb támadási felület).
COPY package*.json ./
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
 && npm ci --omit=dev \
 && npm cache clean --force \
 && apk del .build-deps

# Forráskód
COPY . .

# Futáshoz szükséges, írható mappák a nem root "node" felhasználónak
# (feltöltések, naplók, generált blog/sitemap, cache, PadliCrome-projektek).
# Bind mountnál a hoszton lévő mappák tulajdonosa is a 1000-es uid legyen,
# lásd INSTALL.md.
RUN mkdir -p uploads logs public/blog server/cache /mnt/manga2/padlicrome \
 && chown -R node:node uploads logs public server/cache /mnt/manga2/padlicrome

USER node

# A NODE_ENV-et a .env adja (production → secure sütik, HTTPS-átirányítás)
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/api/health" > /dev/null || exit 1

CMD ["node", "server/index.js"]
