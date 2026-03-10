/**
 * GatewayBridge.tsx
 *
 * Agent Status Panel — reads live session data from the OpenClaw Gateway
 * via the useGateway hook and renders a synthwave-themed status grid.
 *
 * Displays for each session:
 *   • Session key (short label)
 *   • Agent name / model
 *   • Connection status indicator
 *   • Last message preview (truncated)
 *   • Estimated cost (USD) this session
 *   • Last active timestamp
 *
 * Also shows gateway health + connection state banner.
 */

import { useGateway, GatewaySession } from "./useGateway";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgoShort(ts: number | undefined): string {
  if (!ts) return "—";
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60)  return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60)  return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24)    return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatCost(usd: number | undefined): string {
  if (usd === undefined || usd === null) return "—";
  if (usd < 0.001) return "<$0.001";
  return `$${usd.toFixed(3)}`;
}

function formatTokens(n: number | undefined): string {
  if (!n) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

// Extract agent name from sessionKey: "agent:cestra:main" → "cestra"
function agentLabel(session: GatewaySession): string {
  const match = session.key.match(/^agent:([^:]+)/);
  if (match) return match[1];
  return session.key;
}

function isMainSession(session: GatewaySession): boolean {
  return session.key.endsWith(":main");
}

function modelShort(model: string | undefined): string {
  if (!model) return "—";
  return model.split("/").pop() ?? model;
}

function agentStatus(session: GatewaySession): "active" | "idle" | "stale" {
  if (!session.updatedAt) return "stale";
  const ageMs = Date.now() - session.updatedAt;
  if (ageMs < 5 * 60 * 1000)  return "active"; // <5min
  if (ageMs < 3 * 60 * 60 * 1000) return "idle"; // <3h
  return "stale";
}

const AGENT_EMOJI: Record<string, string> = {
  cestra:    "🎯",
  architect: "🏛️",
  koda:      "🔨",
  kyra:      "✍️",
  veda:      "🔮",
  orin:      "🔍",
  vision:    "👁️",
  loki:      "🎭",
  fin:       "💰",
  main:      "🧠",
};

const AGENT_ROLE: Record<string, string> = {
  cestra:    "Squad Lead",
  architect: "Tech Architect",
  koda:      "Code Engine",
  kyra:      "QA & Review",
  veda:      "Product Intel",
  orin:      "Research",
  vision:    "SEO",
  loki:      "Content",
  fin:       "Finance & Rev",
};

function agentEmoji(name: string): string {
  return AGENT_EMOJI[name.toLowerCase()] ?? "🤖";
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ConnectionBanner({ connected, authenticated, error }: {
  connected: boolean;
  authenticated: boolean;
  error: string | null;
}) {
  if (authenticated) {
    return (
      <div className="gw-banner gw-banner--ok">
        <span className="gw-banner-dot gw-banner-dot--ok" />
        Gateway connected
      </div>
    );
  }
  if (connected) {
    return (
      <div className="gw-banner gw-banner--pending">
        <span className="gw-banner-dot gw-banner-dot--pending" />
        Authenticating…
      </div>
    );
  }
  return (
    <div className="gw-banner gw-banner--error">
      <span className="gw-banner-dot gw-banner-dot--error" />
      {error ?? "Connecting to gateway…"}
    </div>
  );
}

function SessionCard({ session }: { session: GatewaySession }) {
  const name   = agentLabel(session);
  const emoji  = agentEmoji(name);
  const model  = modelShort(session.model);
  const status = agentStatus(session);
  const role   = AGENT_ROLE[name.toLowerCase()] ?? session.kind ?? "agent";

  const statusColors: Record<string, string> = {
    active: "#00d4ff",
    idle:   "#a0a0c0",
    stale:  "#444466",
  };

  return (
    <div className="gw-session-card" data-status={status}>
      <div className="gw-session-header">
        <span className="gw-session-emoji">{emoji}</span>
        <div className="gw-session-title">
          <span className="gw-session-name">{name}</span>
          <span className="gw-session-role">{role}</span>
        </div>
        <span
          className="gw-status-dot"
          style={{ background: statusColors[status] }}
          title={status}
        />
      </div>

      <div className="gw-session-model">{model}</div>

      <div className="gw-session-footer">
        <span className="gw-session-age">{timeAgoShort(session.updatedAt)}</span>
        <span className="gw-session-tokens">{formatTokens(session.totalTokens)} tok</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function GatewayBridge() {
  const { connected, authenticated, error, sessions, health, lastUpdated } = useGateway();

  return (
    <section className="panel gw-panel">
      <div className="gw-panel-header">
        <h2>Agent Status</h2>
        <div className="gw-panel-meta">
          {health && (
            <span className="gw-health-badge">
              {health.status === "ok" || health.status === "healthy" ? "✓ healthy" : health.status}
            </span>
          )}
          {lastUpdated && (
            <span className="gw-last-updated">
              Updated {timeAgoShort(lastUpdated)} ago
            </span>
          )}
        </div>
      </div>

      <ConnectionBanner
        connected={connected}
        authenticated={authenticated}
        error={error}
      />

      {sessions.length > 0 ? (
        <div className="gw-sessions-grid">
          {sessions.filter(s => isMainSession(s)).map(s => (
            <SessionCard key={s.key} session={s} />
          ))}
        </div>
      ) : authenticated ? (
        <p className="empty-state">No active sessions found</p>
      ) : (
        <p className="empty-state">Waiting for gateway data…</p>
      )}
    </section>
  );
}

export default GatewayBridge;
