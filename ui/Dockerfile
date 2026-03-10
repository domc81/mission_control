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
# WS proxy server — bridges browser to loopback-only gateway
COPY proxy-server.cjs ./proxy-server.cjs

EXPOSE 3000
EXPOSE 3001

# Start both the WS proxy (port 3001) and the static file server (port 3000)
CMD ["sh", "-c", "node proxy-server.cjs & serve dist -s -l 3000"]
