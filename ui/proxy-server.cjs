/**
 * proxy-server.cjs
 *
 * Lightweight production WebSocket proxy for DC81 Mission Control.
 *
 * Problem: The OpenClaw Gateway runs at ws://127.0.0.1:18789 (loopback only).
 * The React app is served as a static SPA from a Coolify public URL.
 * Browsers cannot connect to 127.0.0.1 from an external origin.
 *
 * Solution: This proxy runs on port 3001 (alongside `serve` on port 3000),
 * accepts WebSocket connections at /ws, and pipes them to the gateway.
 *
 * Coolify's Nginx (or your own nginx.conf) should proxy:
 *   location /ws {
 *     proxy_pass         http://localhost:3001;
 *     proxy_http_version 1.1;
 *     proxy_set_header   Upgrade $http_upgrade;
 *     proxy_set_header   Connection "upgrade";
 *     proxy_set_header   Host $host;
 *     proxy_read_timeout 86400;
 *   }
 *
 * Usage:
 *   node proxy-server.cjs
 *
 * Environment variables:
 *   GATEWAY_URL   — target gateway URL (default: ws://127.0.0.1:18789)
 *   PROXY_PORT    — port this proxy listens on (default: 3001)
 */

'use strict';

const http = require('http');
const net  = require('net');
const url  = require('url');

const GATEWAY_URL = process.env.GATEWAY_URL || 'ws://127.0.0.1:18789';
const PROXY_PORT  = parseInt(process.env.PROXY_PORT || '3001', 10);

// Parse gateway address
const gwUrl  = new url.URL(GATEWAY_URL);
const gwHost = gwUrl.hostname;
const gwPort = parseInt(gwUrl.port || '18789', 10);

console.log(`[ws-proxy] Starting on port ${PROXY_PORT} → ${GATEWAY_URL}`);

// ============================================================
// COST API — added by Architect Task 3 (do not reorder above WS logic)
// ============================================================
const { handleCostsRequest } = require('./api-costs.cjs');

const server = http.createServer((req, res) => {
  const reqPath = url.parse(req.url || '/').pathname;

  // GET /api/costs — per-agent token usage + estimated USD
  if (reqPath === '/api/costs') {
    handleCostsRequest(req, res);
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('DC81 WS Proxy OK\n');
});

server.on('upgrade', (req, clientSocket, head) => {
  // Only handle /ws path
  const reqPath = url.parse(req.url || '/').pathname;
  if (reqPath !== '/ws') {
    clientSocket.write(
      'HTTP/1.1 404 Not Found\r\n' +
      'Content-Type: text/plain\r\n\r\n' +
      'Not found\r\n'
    );
    clientSocket.destroy();
    return;
  }

  // Open raw TCP socket to gateway
  const gwSocket = net.connect(gwPort, gwHost, () => {
    // Forward the HTTP upgrade request to the gateway
    const reqLine = `GET ${gwUrl.pathname || '/'} HTTP/1.1\r\n`;
    const headers = [
      `Host: ${gwHost}:${gwPort}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
    ];

    // Forward relevant headers from the original request
    const forwardHeaders = [
      'sec-websocket-key',
      'sec-websocket-version',
      'sec-websocket-extensions',
      'sec-websocket-protocol',
    ];
    for (const h of forwardHeaders) {
      if (req.headers[h]) {
        headers.push(`${h}: ${req.headers[h]}`);
      }
    }

    gwSocket.write(reqLine + headers.join('\r\n') + '\r\n\r\n');
    if (head && head.length > 0) gwSocket.write(head);

    // Pipe: client → gateway and gateway → client
    gwSocket.pipe(clientSocket);
    clientSocket.pipe(gwSocket);
  });

  gwSocket.on('error', (err) => {
    console.error('[ws-proxy] Gateway connection error:', err.message);
    try {
      clientSocket.write(
        'HTTP/1.1 502 Bad Gateway\r\n' +
        'Content-Type: text/plain\r\n\r\n' +
        'Gateway unavailable\r\n'
      );
    } catch { /* ignore */ }
    clientSocket.destroy();
  });

  clientSocket.on('error', (err) => {
    console.error('[ws-proxy] Client socket error:', err.message);
    gwSocket.destroy();
  });

  gwSocket.on('end', () => clientSocket.end());
  clientSocket.on('end', () => gwSocket.end());
});

server.listen(PROXY_PORT, '0.0.0.0', () => {
  console.log(`[ws-proxy] Listening on port ${PROXY_PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[ws-proxy] SIGTERM received, shutting down');
  server.close(() => process.exit(0));
});
process.on('SIGINT', () => {
  console.log('[ws-proxy] SIGINT received, shutting down');
  server.close(() => process.exit(0));
});
