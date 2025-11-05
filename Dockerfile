# ---- Build stage ----
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci || npm install

# Copy source code
COPY . .

# Build client/server
RUN npm run build
RUN npm prune --omit=dev


# ---- Runtime stage with Caddy ----
FROM caddy:latest

# Arbeitsverzeichnis
WORKDIR /srv

# Node vorbereiten
COPY --from=builder /app /srv/app

# Caddyfile hinzufügen
COPY Caddyfile /etc/caddy/Caddyfile

# Expose Ports
EXPOSE 80
EXPOSE 443

# Start Caddy (reverse proxy) + Node gleichzeitig
CMD ["sh", "-c", "node /srv/app/dist/index.js & caddy run --config /etc/caddy/Caddyfile --adapter caddyfile"]
