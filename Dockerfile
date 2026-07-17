# Imagen con Node + Chromium del sistema (más confiable en hosts como Railway/Render)
FROM node:20-slim

# Instala Chromium y las librerías que necesita para correr en modo headless
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libnss3 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libasound2 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libxcomposite1 \
    libxkbcommon0 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Le dice a Puppeteer que use el Chromium ya instalado (no descargue uno propio)
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
