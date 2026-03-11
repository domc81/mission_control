/**
 * useGateway.ts
 *
 * React hook for connecting to the OpenClaw Gateway via WebSocket.
 *
 * The gateway runs at ws://127.0.0.1:18789 (loopback only).
 * In the browser we connect via a reverse-proxy path:
 *   dev:  Vite proxy  → /ws → ws://127.0.0.1:18789
 *   prod: Node proxy  → /ws → ws://127.0.0.1:18789 (proxy-server.cjs on port 3001,
 *         nginx must forward /ws → http://localhost:3001)
 *
 * Protocol (verified live against running gateway):
 *   Frame format:    {type:"req"|"res"|"event", id?, method?, params?, ok?, payload?, error?}
 *   NOT JSON-RPC — the gateway uses OpenClaw's own framing.
 *
 *   Handshake (via proxy — browser never handles credentials):
 *   1. Browser connects to /ws on proxy-server
 *   2. Proxy handles gateway challenge + auth internally using password from openclaw.json
 *   3. Proxy forwards a synthetic hello-ok to the browser once authenticated
 *   4. Browser sees: {type:"res", id, ok:true, payload:{type:"hello-ok", ...}}
 *   5. All subsequent frames are piped transparently
 *
 *   Subsequent RPCs: {type:"req", id, method, params} → {type:"res", id, ok, payload|error}
 *
 * Key methods available (from gateway features.methods):
 *   sessions.list, sessions.preview, usage.cost, health, system-presence,
 *   cron.list, agents.list, usage.status, chat.history
 */

import { useEffect, useRef, useState, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GatewaySession = {
  key: string;           // sessionKey — "agent:cestra:main" etc.
  kind?: string;
  displayName?: string;
  channel?: string;
  model?: string;
  modelProvider?: string;
  updatedAt?: number;
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  // Enriched
  lastPreview?: string;
  costUsd?: number;
};

export type GatewayHealth = {
  status: string;
  uptime?: number;
  version?: string;
};

export type GatewayState = {
  connected: boolean;
  authenticated: boolean;
  error: string | null;
  sessions: GatewaySession[];
  health: GatewayHealth | null;
  lastUpdated: number | null;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WS_PATH =
  typeof window !== "undefined"
    ? `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`
    : "ws://localhost:3000/ws";

const RECONNECT_BASE_MS   = 3_000;
const REQUEST_TIMEOUT_MS  = 12_000;
const REFRESH_INTERVAL_MS = 30_000;
const MAX_RECONNECT_TRIES = 12;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useGateway(): GatewayState {
  const [state, setState] = useState<GatewayState>({
    connected: false,
    authenticated: false,
    error: null,
    sessions: [],
    health: null,
    lastUpdated: null,
  });

  const wsRef             = useRef<WebSocket | null>(null);
  const pendingRef        = useRef<Map<string, PendingRequest>>(new Map());
  const seqRef            = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshTimerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectCount    = useRef(0);
  const mountedRef        = useRef(true);

  // ---------- helpers ----------

  function nextId(): string {
    return `mc-${++seqRef.current}-${Date.now()}`;
  }

  function sendFrame(ws: WebSocket, payload: object) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }

  // RPC: sends {type:"req", id, method, params} and waits for matching {type:"res", id, ok, payload}
  function rpc(ws: WebSocket, method: string, params: object = {}): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = nextId();
      const timeout = setTimeout(() => {
        pendingRef.current.delete(id);
        reject(new Error(`RPC timeout: ${method}`));
      }, REQUEST_TIMEOUT_MS);

      pendingRef.current.set(id, { resolve, reject, timeout });
      sendFrame(ws, { type: "req", id, method, params });
    });
  }

  // ---------- data fetching (after auth) ----------

  const fetchData = useCallback(async (ws: WebSocket) => {
    try {
      // sessions.list returns {ts, count, sessions:[...]}
      const sessionsResult = await rpc(ws, "sessions.list", {}) as {
        sessions?: GatewaySession[];
        ts?: number;
        count?: number;
      };
      const rawSessions: GatewaySession[] = sessionsResult?.sessions ?? [];

      // health
      let health: GatewayHealth | null = null;
      try {
        const h = await rpc(ws, "health", {}) as Record<string, unknown>;
        health = {
          status: (h?.status as string) ?? "ok",
          uptime: h?.uptime as number | undefined,
          version: h?.version as string | undefined,
        };
      } catch { /* non-fatal */ }

      if (!mountedRef.current) return;

      setState(prev => ({
        ...prev,
        sessions: rawSessions,
        health,
        lastUpdated: Date.now(),
        error: null,
      }));
    } catch (err) {
      console.warn("[useGateway] fetchData error:", err);
    }
  }, []);

  // ---------- connection lifecycle ----------

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const ws = new WebSocket(WS_PATH);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) { ws.close(); return; }
        // DON'T send connect here — must wait for connect.challenge event from server
        setState(prev => ({ ...prev, connected: true, error: null }));
      };

      ws.onmessage = (event: MessageEvent) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(event.data as string);
        } catch {
          return;
        }

        const msgType  = msg.type as string;
        const msgId    = msg.id as string | undefined;
        const msgEvent = msg.event as string | undefined;

        // ---- OpenClaw gateway events ----

        // connect.challenge is handled server-side by the proxy.
        // The browser should never receive this — but swallow it if it does.
        if (msgType === "event" && msgEvent === "connect.challenge") {
          return;
        }

        // connect.error — proxy failed to auth with gateway
        if (msgType === "event" && msgEvent === "connect.error") {
          const payload = msg.payload as { message?: string } | undefined;
          setState(prev => ({
            ...prev,
            error: payload?.message ?? "Gateway authentication failed",
          }));
          return;
        }

        // gateway.ready — proxy has authenticated with gateway on our behalf
        if (msgType === "event" && msgEvent === "gateway.ready") {
          reconnectCount.current = 0;
          setState(prev => ({ ...prev, authenticated: true, error: null }));
          fetchData(ws);
          if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
          refreshTimerRef.current = setInterval(() => fetchData(ws), REFRESH_INTERVAL_MS);
          return;
        }

        // ---- RPC response: {type:"res", id, ok, payload|error} ----
        if (msgType === "res" && msgId) {
          const pending = pendingRef.current.get(msgId);
          if (pending) {
            clearTimeout(pending.timeout);
            pendingRef.current.delete(msgId);
            if (msg.ok) {
              pending.resolve(msg.payload);
            } else {
              const errObj = msg.error as { message?: string } | string | undefined;
              const errMsg = typeof errObj === "string" ? errObj : (errObj?.message ?? "RPC error");
              pending.reject(new Error(errMsg));
            }
          }
          return;
        }

        // Other gateway events (tool calls, session updates etc.) — extend here later
      };

      ws.onerror = () => {
        if (!mountedRef.current) return;
        setState(prev => ({
          ...prev,
          error: "WebSocket error — is the proxy running?",
          connected: false,
          authenticated: false,
        }));
      };

      ws.onclose = (event: CloseEvent) => {
        if (!mountedRef.current) return;
        if (refreshTimerRef.current) {
          clearInterval(refreshTimerRef.current);
          refreshTimerRef.current = null;
        }
        for (const [, pending] of pendingRef.current) {
          clearTimeout(pending.timeout);
          pending.reject(new Error("WebSocket closed"));
        }
        pendingRef.current.clear();

        const errMsg = event.code === 1000 ? null : `Gateway disconnected (${event.code})`;
        setState(prev => ({
          ...prev,
          connected: false,
          authenticated: false,
          error: errMsg,
        }));

        if (reconnectCount.current < MAX_RECONNECT_TRIES) {
          reconnectCount.current++;
          const delay = RECONNECT_BASE_MS * Math.min(2 ** (reconnectCount.current - 1), 16);
          reconnectTimerRef.current = setTimeout(connect, delay);
        }
      };
    } catch (err) {
      setState(prev => ({
        ...prev,
        error: `Failed to open WebSocket: ${err}`,
        connected: false,
      }));
    }
  }, [fetchData]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (refreshTimerRef.current)   clearInterval(refreshTimerRef.current);
      const ws = wsRef.current;
      if (ws) {
        ws.onclose = null;
        ws.close(1000, "component unmount");
      }
      for (const [, pending] of pendingRef.current) {
        clearTimeout(pending.timeout);
      }
      pendingRef.current.clear();
    };
  }, [connect]);

  return state;
}
