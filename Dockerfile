FROM node:20-alpine

# sharp és bcrypt natív modulokhoz szükséges build eszközök
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Függőségek külön rétegben — cache-barát
COPY package*.json ./
RUN npm ci --omit=dev

# Forráskód
COPY . .

# Futáshoz szükséges mappák
RUN mkdir -p uploads logs public/blog

EXPOSE 3000

CMD ["node", "server/index.js"]
