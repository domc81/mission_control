/**
 * proxy-server.cjs
 *
 * Combined production server for DC81 Mission Control.
 * Runs on a SINGLE port (default 3000) and handles:
 *
 *   GET /api/costs   — per-agent token usage + estimated USD
 *   /ws              — Authenticated WebSocket relay → OpenClaw Gateway
 *   /*               — Static file serving from ./dist
 *
 * SECURITY: The gateway password is read from openclaw.json at startup.
 * It is NEVER sent to the browser. The proxy handles the gateway auth
 * handshake itself (challenge → connect → hello-ok), then forwards a
 * synthetic hello-ok to the browser. All subsequent frames are piped
 * transparently. The browser only ever sees post-auth gateway traffic.
 *
 * WebSocket relay architecture:
 *   Browser ──/ws──► Proxy (this server) ──► OpenClaw Gateway (loopback)
 *                    └── handles auth handshake internally ──┘
 *
 * Password source: /root/.openclaw/openclaw.json → gateway.auth.password
 * Fallback: GATEWAY_PASSWORD env var
 *
 * Environment variables:
 *   GATEWAY_URL      — target gateway WS URL (default: ws://127.0.0.1:18789)
 *   PORT             — port this server listens on (default: 3000)
 *   DIST_DIR         — path to built static files (default: ./dist)
 *   OPENCLAW_CONFIG  — path to openclaw.json (default: /root/.openclaw/openclaw.json)
 */

'use strict';

const http    = require('http');
const https   = require('https');
const fs      = require('fs');
const path    = require('path');
const net     = require('net');
const url     = require('url');
const crypto  = require('crypto');

// ============================================================
// Config
// ============================================================

const GATEWAY_URL     = process.env.GATEWAY_URL     || 'ws://127.0.0.1:18789';
const PORT            = parseInt(process.env.PORT    || '3000', 10);
const DIST_DIR        = process.env.DIST_DIR         || path.join(__dirname, 'dist');
const OPENCLAW_CONFIG = process.env.OPENCLAW_CONFIG  || '/root/.openclaw/openclaw.json';

// Parse gateway address
const gwUrl  = new url.URL(GATEWAY_URL);
const gwHost = gwUrl.hostname;
const gwPort = parseInt(gwUrl.port || '18789', 10);

// ============================================================
// Read gateway password from openclaw.json (never hardcoded)
// ============================================================

function readGatewayPassword() {
  // 1. Try env var override
  if (process.env.GATEWAY_PASSWORD) {
    return process.env.GATEWAY_PASSWORD;
  }

  // 2. Read from openclaw.json
  try {
    const raw  = fs.readFileSync(OPENCLAW_CONFIG, 'utf8');
    const config = JSON.parse(raw);
    const pw = config?.gateway?.auth?.password;
    if (pw) return pw;
  } catch (err) {
    console.warn('[mission-control] Could not read openclaw.json:', err.message);
  }

  console.error('[mission-control] FATAL: no gateway password found. Set GATEWAY_PASSWORD env var or check openclaw.json');
  process.exit(1);
}

const GATEWAY_PASSWORD = readGatewayPassword();
console.log(`[mission-control] Starting on port ${PORT}`);
console.log(`[mission-control] Static files: ${DIST_DIR}`);
console.log(`[mission-control] WS gateway: ${GATEWAY_URL}`);
console.log(`[mission-control] Gateway password: loaded from config ✓`);

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

// ============================================================
// Static file serving
// ============================================================
function serveStatic(req, res) {
  let reqPath = url.parse(req.url || '/').pathname || '/';
  try { reqPath = decodeURIComponent(reqPath); } catch { /* ignore */ }

  let filePath = path.join(DIST_DIR, reqPath);
  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  function tryServe(fp) {
    fs.stat(fp, (err, stat) => {
      if (err || stat.isDirectory()) {
        const indexPath = path.join(fp, 'index.html');
        fs.stat(indexPath, (err2, stat2) => {
          if (err2 || !stat2.isFile()) {
            const rootIndex = path.join(DIST_DIR, 'index.html');
            fs.readFile(rootIndex, (err3, data) => {
              if (err3) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
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
      if (err) { res.writeHead(500, { 'Content-Type': 'text/plain' }); res.end('Internal error'); return; }
      const mime = getMime(fp);
      const cacheControl = fp.includes('/assets/')
        ? 'public, max-age=31536000, immutable'
        : 'no-cache, no-store, must-revalidate';
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': cacheControl });
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

  if (reqPath.startsWith('/api/')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  }

  if (reqPath === '/api/costs') {
    handleCostsRequest(req, res);
    return;
  }

  if (reqPath === '/ws') {
    res.writeHead(426, { 'Content-Type': 'text/plain', 'Connection': 'Upgrade', 'Upgrade': 'websocket' });
    res.end('WebSocket upgrade required');
    return;
  }

  serveStatic(req, res);
});

// ============================================================
// WebSocket relay with server-side auth
//
// The proxy handles the gateway handshake on behalf of the browser:
//   1. Open TCP connection to gateway
//   2. Do the WS upgrade handshake
//   3. Wait for connect.challenge from gateway
//   4. Send connect request with real password (never visible to browser)
//   5. Receive hello-ok from gateway
//   6. Forward synthetic hello-ok to browser
//   7. Enter transparent pipe mode for all subsequent frames
//
// This ensures the password is only ever present on the server.
// ============================================================

server.on('upgrade', (req, clientSocket, head) => {
  const reqPath = url.parse(req.url || '/').pathname;
  if (reqPath !== '/ws') {
    clientSocket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    clientSocket.destroy();
    return;
  }

  // Open TCP connection to gateway
  const gwSocket = net.connect(gwPort, gwHost);

  // Buffer frames from browser while auth is in progress
  let authComplete = false;
  const browserBuffer = [];

  // ---- WS frame helpers ----
  // Simple WS frame parser/builder for text frames (opcode 0x1)
  // Handles unmasked frames from server and masked frames from client

  function buildTextFrame(text) {
    const payload = Buffer.from(text, 'utf8');
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.alloc(2);
      header[0] = 0x81; // FIN + text opcode
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    return Buffer.concat([header, payload]);
  }

  // Incrementally parse WS frames from a buffer
  // Returns { frames: [...parsed text strings], remaining: Buffer }
  function parseFrames(buf) {
    const frames = [];
    let offset = 0;
    while (offset + 2 <= buf.length) {
      const b0 = buf[offset];
      const b1 = buf[offset + 1];
      // const fin   = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked  = (b1 & 0x80) !== 0;
      let payloadLen = b1 & 0x7f;
      let headerLen = 2;

      if (payloadLen === 126) {
        if (offset + 4 > buf.length) break;
        payloadLen = buf.readUInt16BE(offset + 2);
        headerLen = 4;
      } else if (payloadLen === 127) {
        if (offset + 10 > buf.length) break;
        payloadLen = Number(buf.readBigUInt64BE(offset + 2));
        headerLen = 10;
      }

      if (masked) headerLen += 4;
      if (offset + headerLen + payloadLen > buf.length) break;

      // Extract payload
      let payload;
      if (masked) {
        const maskStart = headerLen - 4 + offset;
        const mask = buf.slice(maskStart, maskStart + 4);
        const raw  = buf.slice(offset + headerLen, offset + headerLen + payloadLen);
        payload = Buffer.alloc(payloadLen);
        for (let i = 0; i < payloadLen; i++) {
          payload[i] = raw[i] ^ mask[i % 4];
        }
      } else {
        payload = buf.slice(offset + headerLen, offset + headerLen + payloadLen);
      }

      if (opcode === 0x1 || opcode === 0x0) {
        // Text or continuation — attempt JSON parse
        frames.push(payload.toString('utf8'));
      } else if (opcode === 0x8) {
        frames.push(null); // close
      }
      // ping/pong (0x9/0xa) — skip, gateway handles
      offset += headerLen + payloadLen;
    }
    return { frames, remaining: buf.slice(offset) };
  }

  let gwRawBuf = Buffer.alloc(0);
  let gwUpgraded = false;
  let authReqId = null;
  const AUTH_TIMEOUT_MS = 10_000;

  const authTimeout = setTimeout(() => {
    if (!authComplete) {
      console.error('[ws-relay] Auth timeout — closing');
      clientSocket.write(buildTextFrame(JSON.stringify({
        type: 'event', event: 'connect.error',
        payload: { message: 'Auth timeout' }
      })));
      clientSocket.destroy();
      gwSocket.destroy();
    }
  }, AUTH_TIMEOUT_MS);

  gwSocket.on('error', (err) => {
    clearTimeout(authTimeout);
    console.error('[ws-relay] Gateway connection error:', err.message);
    try {
      clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\nGateway unavailable\r\n');
    } catch { /* ignore */ }
    clientSocket.destroy();
  });

  gwSocket.on('connect', () => {
    // Send HTTP upgrade request to gateway
    const reqLine  = `GET ${gwUrl.pathname || '/'} HTTP/1.1\r\n`;
    const wsKey    = crypto.randomBytes(16).toString('base64');
    const headers  = [
      `Host: ${gwHost}:${gwPort}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Key: ${wsKey}`,
      'Sec-WebSocket-Version: 13',
    ].join('\r\n');
    gwSocket.write(reqLine + headers + '\r\n\r\n');
  });

  gwSocket.on('data', (chunk) => {
    gwRawBuf = Buffer.concat([gwRawBuf, chunk]);

    if (!gwUpgraded) {
      // Wait for HTTP 101 response
      const headerEnd = gwRawBuf.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      const responseHead = gwRawBuf.slice(0, headerEnd).toString();
      if (!responseHead.includes('101')) {
        console.error('[ws-relay] Gateway did not upgrade:', responseHead.substring(0, 100));
        clientSocket.destroy();
        gwSocket.destroy();
        return;
      }
      gwUpgraded = true;
      gwRawBuf = gwRawBuf.slice(headerEnd + 4); // remaining after headers
    }

    // Parse WS frames
    const { frames, remaining } = parseFrames(gwRawBuf);
    gwRawBuf = remaining;

    for (const text of frames) {
      if (text === null) {
        // Gateway closed
        clientSocket.destroy();
        return;
      }

      let msg;
      try { msg = JSON.parse(text); } catch { continue; }

      if (!authComplete) {
        // ---- Auth phase ----
        if (msg.type === 'event' && msg.event === 'connect.challenge') {
          // Respond with connect request including real password — never forwarded to browser
          authReqId = `proxy-auth-${Date.now()}`;
          const connectFrame = buildTextFrame(JSON.stringify({
            type: 'req',
            id: authReqId,
            method: 'connect',
            params: {
              minProtocol: 3, maxProtocol: 3,
              client: { id: 'cli', version: '1.0.0', platform: 'web', mode: 'cli' },
              role: 'operator',
              scopes: ['operator.read', 'operator.write'],
              caps: [], commands: [], permissions: {},
              auth: { password: GATEWAY_PASSWORD },
              locale: 'en-US',
              userAgent: 'dc81-mission-control/1.0.0',
            },
          }));
          gwSocket.write(connectFrame);
          // Do NOT forward the challenge to the browser
          continue;
        }

        if (msg.type === 'res' && msg.id === authReqId) {
          clearTimeout(authTimeout);
          if (!msg.ok) {
            console.error('[ws-relay] Gateway auth failed:', msg.error);
            clientSocket.write(buildTextFrame(JSON.stringify({
              type: 'event', event: 'connect.error',
              payload: { message: 'Gateway authentication failed' }
            })));
            clientSocket.destroy();
            gwSocket.destroy();
            return;
          }

          // Auth succeeded — forward a synthetic gateway.ready event to the browser
          // Password is NOT included. Browser uses this to know auth is complete.
          authComplete = true;
          const syntheticHello = {
            type: 'event',
            event: 'gateway.ready',
            payload: {
              protocol: msg.payload?.protocol ?? 3,
              server: msg.payload?.server ?? {},
              features: msg.payload?.features ?? {},
            },
          };
          clientSocket.write(buildTextFrame(JSON.stringify(syntheticHello)));

          // Flush any frames the browser sent while we were authenticating
          for (const buffered of browserBuffer) {
            gwSocket.write(buffered);
          }
          browserBuffer.length = 0;
          continue;
        }

        // Any other message during auth — queue for browser after auth
        clientSocket.write(buildTextFrame(text));
        continue;
      }

      // ---- Post-auth: forward all gateway frames to browser ----
      clientSocket.write(buildTextFrame(text));
    }
  });

  gwSocket.on('end', () => {
    clearTimeout(authTimeout);
    clientSocket.end();
  });

  // ---- Handle the HTTP upgrade from browser → complete WS handshake ----
  // First, accept the browser's WS upgrade
  const wsKey     = req.headers['sec-websocket-key'];
  const acceptKey = crypto
    .createHash('sha1')
    .update(wsKey + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  clientSocket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${acceptKey}\r\n\r\n`
  );

  // Forward the initial head data if any
  if (head && head.length > 0) {
    // Buffer browser data during auth
    browserBuffer.push(head);
  }

  // ---- Browser → gateway pipe (after auth) ----
  let browserBuf = Buffer.alloc(0);

  clientSocket.on('data', (chunk) => {
    if (!authComplete) {
      // Buffer during auth (rare — browser shouldn't send before hello-ok)
      browserBuffer.push(chunk);
      return;
    }
    // Post-auth: forward browser frames directly to gateway
    // Browser sends masked frames; gateway expects them unmasked — unmask here
    browserBuf = Buffer.concat([browserBuf, chunk]);
    const { frames, remaining } = parseFrames(browserBuf);
    browserBuf = remaining;
    for (const text of frames) {
      if (text === null) { gwSocket.end(); return; }
      gwSocket.write(buildTextFrame(text));
    }
  });

  clientSocket.on('error', (err) => {
    clearTimeout(authTimeout);
    console.error('[ws-relay] Client socket error:', err.message);
    gwSocket.destroy();
  });

  clientSocket.on('end', () => {
    clearTimeout(authTimeout);
    gwSocket.end();
  });
});

// ============================================================
// Start
// ============================================================
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[mission-control] Listening on port ${PORT}`);
});

process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
process.on('SIGINT',  () => { server.close(() => process.exit(0)); });
