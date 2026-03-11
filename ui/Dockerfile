# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Serve stage
FROM node:22-alpine AS runner

WORKDIR /app

RUN npm install -g serve

COPY --from=builder /app/dist ./dist
# Combined server: WS proxy + API + static file serving (single port)
COPY proxy-server.cjs ./proxy-server.cjs
COPY api-costs.cjs ./api-costs.cjs

EXPOSE 3000
EXPOSE 3001

# Port 3000: HTTP (static files + /api/costs) — through Traefik
# Port 3001: WebSocket relay (direct, bypasses Traefik)
CMD ["node", "proxy-server.cjs"]
