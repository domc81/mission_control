/**
 * proxy-server.cjs
 *
 * Combined production server for DC81 Mission Control.
 * Runs on a SINGLE port (default 3000) and handles:
 *
 *   GET /api/costs   — per-agent token usage + estimated USD
 *   /ws              — WebSocket proxy → OpenClaw Gateway (ws://127.0.0.1:18789)
 *   /*               — Static file serving from ./dist
 *
 * Why single-server: Coolify exposes ONE port. The previous two-process setup
 * (serve dist on 3000, ws-proxy on 3001) meant /ws and /api never reached the
 * proxy, returning HTML 404s from `serve` instead.
 *
 * WebSocket gateway proxy:
 *   The gateway runs at ws://127.0.0.1:18789 (loopback only).
 *   Browsers cannot connect to loopback from an external origin.
 *   We accept WS upgrades at /ws and pipe them to the gateway via raw TCP.
 *
 * Usage:
 *   node proxy-server.cjs
 *
 * Environment variables:
 *   GATEWAY_URL   — target gateway URL (default: ws://127.0.0.1:18789)
 *   PORT          — port this server listens on (default: 3000)
 *   DIST_DIR      — path to built static files (default: ./dist)
 */

'use strict';

const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const net   = require('net');
const url   = require('url');

const GATEWAY_URL = process.env.GATEWAY_URL || 'ws://127.0.0.1:18789';
const PORT        = parseInt(process.env.PORT || '3000', 10);
const DIST_DIR    = process.env.DIST_DIR || path.join(__dirname, 'dist');

// Parse gateway address
const gwUrl  = new url.URL(GATEWAY_URL);
const gwHost = gwUrl.hostname;
const gwPort = parseInt(gwUrl.port || '18789', 10);

console.log(`[mission-control] Starting on port ${PORT}`);
console.log(`[mission-control] Static files: ${DIST_DIR}`);
console.log(`[mission-control] WS gateway: ${GATEWAY_URL}`);

// ============================================================
// COST API
// ============================================================
const { handleCostsRequest } = require('./api-costs.cjs');

// ============================================================
// MIME types for static serving
// ============================================================
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
};

function getMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}

function serveStatic(req, res) {
  let reqPath = url.parse(req.url || '/').pathname || '/';

  // Decode and strip query string
  try { reqPath = decodeURIComponent(reqPath); } catch { /* ignore */ }

  // Resolve to file path
  let filePath = path.join(DIST_DIR, reqPath);

  // Security: prevent path traversal
  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  // Try exact file first, then index.html for SPA fallback
  function tryServe(fp) {
    fs.stat(fp, (err, stat) => {
      if (err || stat.isDirectory()) {
        // Try index.html in directory
        const indexPath = path.join(fp, 'index.html');
        fs.stat(indexPath, (err2, stat2) => {
          if (err2 || !stat2.isFile()) {
            // SPA fallback: serve root index.html
            const rootIndex = path.join(DIST_DIR, 'index.html');
            fs.readFile(rootIndex, (err3, data) => {
              if (err3) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Not found');
                return;
              }
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(data);
            });
          } else {
            serveFile(indexPath, res);
          }
        });
      } else if (stat.isFile()) {
        serveFile(fp, res);
      }
    });
  }

  function serveFile(fp, res) {
    fs.readFile(fp, (err, data) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal error');
        return;
      }
      const mime = getMime(fp);
      const headers = { 'Content-Type': mime };
      // Cache busting for assets (hashed filenames)
      if (fp.includes('/assets/')) {
        headers['Cache-Control'] = 'public, max-age=31536000, immutable';
      } else {
        headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
      }
      res.writeHead(200, headers);
      res.end(data);
    });
  }

  tryServe(filePath);
}

// ============================================================
// HTTP server
// ============================================================
const server = http.createServer((req, res) => {
  const reqPath = url.parse(req.url || '/').pathname || '/';

  // CORS headers for API routes
  if (reqPath.startsWith('/api/')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
  }

  // GET /api/costs
  if (reqPath === '/api/costs') {
    handleCostsRequest(req, res);
    return;
  }

  // Block /ws as HTTP (it should only be used for WS upgrades)
  if (reqPath === '/ws') {
    res.writeHead(426, { 'Content-Type': 'text/plain', 'Connection': 'Upgrade', 'Upgrade': 'websocket' });
    res.end('WebSocket upgrade required');
    return;
  }

  // Static files
  serveStatic(req, res);
});

// ============================================================
// WebSocket upgrade → proxy to gateway
// ============================================================
server.on('upgrade', (req, clientSocket, head) => {
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
    const reqLine = `GET ${gwUrl.pathname || '/'} HTTP/1.1\r\n`;
    const headers = [
      `Host: ${gwHost}:${gwPort}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
    ];

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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[mission-control] Listening on port ${PORT}`);
  console.log(`[mission-control] Serving static files from: ${DIST_DIR}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[mission-control] SIGTERM — shutting down');
  server.close(() => process.exit(0));
});
process.on('SIGINT', () => {
  console.log('[mission-control] SIGINT — shutting down');
  server.close(() => process.exit(0));
});
