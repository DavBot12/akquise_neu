# ----------- Build Phase (Vite) -----------
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# ----------- Production Phase (Nginx) -----------
FROM nginx:alpine

# Build-Ergebnis (aus dist/public/) in Nginx-Verzeichnis kopieren
RUN rm -rf /usr/share/nginx/html/*
COPY --from=builder /app/dist/public /usr/share/nginx/html

# Custom Nginx-Konfiguration mit Proxy zu Backend
COPY client/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
