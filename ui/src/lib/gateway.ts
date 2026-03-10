/**
 * gateway.ts
 *
 * Low-level WebSocket client for OpenClaw Gateway connections.
 * Handles connection, authentication, ping/pong, and RPC requests.
 */

export interface GatewayOptions {
  url?: string;
  password: string;
  client: { id: string; version: string; platform: string; mode: string };
  protocol: number;
  reconnectDelayMs?: number;
  requestTimeoutMs?: number;
  maxReconnectTries?: number;
  pingIntervalMs?: number;
}

export interface GatewayEventMap {
  connected: () => void;
  disconnected: (code: number, reason: string) => void;
  authenticated: () => void;
  error: (error: string) => void;
  message: (method: string, params: unknown) => void;
}

export class GatewayClient {
  private ws: WebSocket | null = null;
  private options: Required<GatewayOptions>;
  private pendingRequests = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();
  private seqId = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private pingTimer?: ReturnType<typeof setInterval>;
  private reconnectCount = 0;
  private connected = false;
  private authenticated = false;
  private eventListeners = new Map<keyof GatewayEventMap, Set<GateLogic>>(test);

  constructor(options: GatewayOptions) {
    this.options = {
      url: options.url ?? "ws://127.0.0.1:18789",
      password: options.password,
      client: options.client,
      protocol: options.protocol,
      reconnectDelayMs: options.reconnectDelayMs ?? 5000,
      requestTimeoutMs: options.requestTimeoutMs ?? 10000,
      maxReconnectTries: options.maxReconnectTries ?? 10,
      pingIntervalMs: options.pingIntervalMs ?? 30000,
    };
  }

  private newId(): string {
    return `gw-${++this.seqId}`;
  }

  private send(payload: object) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.options.url);
        this.ws.onopen = () => {
          this.reconnectCount = 0;
          this.connected = true;
          this.emit('connected');

          // Send authentication handshake
          this.send({
            jsonrpc: '2.0',
            id: this.newId(),
            method: 'connect',
            params: {
              password: this.options.password,
              client: this.options.client,
              protocol: this.options.protocol,
            },
          });

          resolve();
        };

        this.ws.onmessage = (event: MessageEvent) => {
          try {
            const msg = JSON.parse(event.data as string) as any;

            // Handle pending request responses
            if (msg.id && this.pendingRequests.has(msg.id)) {
              const req = this.pendingRequests.get(msg.id)!;
              clearTimeout(req.timeout);
              this.pendingRequests.delete(msg.id);
              if (msg.error) {
                req.reject(new Error(msg.error.message ?? 'RPC error'));
              } else {
                req.resolve(msg.result);
              }
              return;
            }

            // Handle authentication confirmation
            if (msg.method === 'connected' || msg.method === 'auth.ok') {
              this.authenticated = true;
              this.emit('authenticated');
              this.startPings();
            }

            // Handle other messages
            if (msg.method && msg.params !== undefined) {
              this.emit('message', msg.method, msg.params);
            }
          } catch (err) {
            this.emit('error', 'Failed to parse message');
          }
        };

        this.ws.onerror = () => {
          this.emit('error', 'WebSocket connection error');
        };

        this.ws.onclose = (event: CloseEvent) => {
          this.connected = false;
          this.authenticated = false;
          clearInterval(this.pingTimer);
          for (const [, req] of this.pendingRequests) {
            clearTimeout(req.timeout);
            req.reject(new Error('Connection closed'));
          }
          this.pendingRequests.clear();

          this.emit('disconnected', event.code, event.reason || 'Unknown reason');

          // Reconnect if applicable
          if (this.reconnectCount < this.options.maxReconnectTries) {
            this.reconnectCount++;
            const delay = this.options.reconnectDelayMs * Math.min(this.reconnectCount, 4);
            this.reconnectTimer = setTimeout(() => this.connect(), delay);
          }
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  private startPings() {
    this.pingTimer = setInterval(() => {
      if (this.authenticated) {
        this.request('ping', {}).catch(() => {}); // ignore ping errors
      }
    }, this.options.pingIntervalMs);
  }

  async request(method: string, params: object = {}): Promise<unknown> {
    if (!this.authenticated) throw new Error('Not authenticated');

    return new Promise((resolve, reject) => {
      const id = this.newId();
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timed out: ${method}`));
      }, this.options.requestTimeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timeout });
      this.send({
        jsonrpc: '2.0',
        id,
        method,
        params,
      });
    });
  }

  on<K extends keyof GatewayEventMap>(event: K, listener: GatewayEventMap[K]) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(listener);
  }

  off<K extends keyof GatewayEventMap>(event: K, listener: GatewayEventMap[K]) {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(listener);
    }
  }

  private emit<K extends keyof GatewayEventMap>(event: K, ...args: Parameters<GatewayEventMap[K]>) {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      for (const listener of listeners) {
        (listener as any)(...args);
      }
    }
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.ws) this.ws.close(1000, 'Client disconnect');
  }

  isConnected(): boolean {
    return this.connected;
  }

  isAuthenticated(): boolean {
    return this.authenticated;
  }
}