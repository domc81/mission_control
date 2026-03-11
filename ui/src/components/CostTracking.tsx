/**
 * CostTracking.tsx
 *
 * Per-agent, per-model cost breakdown panel.
 * Fetches from GET /api/costs (served by proxy-server.cjs / api-costs.cjs).
 *
 * Billing model:
 *   Anthropic/Claude agents (Cestra, Architect) → Anthropic Max subscription.
 *   No per-token cost. Shows token counts + "Subscription" note.
 *
 *   OpenRouter agents (Koda, Kyra, Veda, Vision, Orin, Loki, Fin) →
 *   real per-token costs. Estimated from known rates.
 *
 *   Total cost = OpenRouter spend only.
 */

import { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentCost = {
  agent:          string;
  model:          string | null;
  totalTokens:    number;
  inputTokens:    number;
  outputTokens:   number;
  estimatedUsd:   number;
  sessionCount:   number;
  isSubscription: boolean;
};

export type CostSummary = {
  agents:             AgentCost[];
  openrouterAgents:   AgentCost[];
  subscriptionAgents: AgentCost[];
  totalUsd:           number;   // OpenRouter spend only
  totalTokens:        number;
  generatedAt:        number;
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

function useCosts() {
  const [data, setData]       = useState<CostSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    try {
      const res = await fetch("/api/costs");
      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        const text = await res.text();
        throw new Error(`Expected JSON but got: ${text.substring(0, 100)}`);
      }
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const json: CostSummary = await res.json();
      // Backfill openrouterAgents / subscriptionAgents if old API format
      if (!json.openrouterAgents) {
        json.openrouterAgents   = json.agents.filter(a => !a.isSubscription);
        json.subscriptionAgents = json.agents.filter(a => a.isSubscription);
      }
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch_();
    const interval = setInterval(fetch_, 60_000);
    return () => clearInterval(interval);
  }, [fetch_]);

  return { data, loading, error, refresh: fetch_ };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MODEL_EMOJI: Record<string, string> = {
  "claude":   "🟠",
  "gemini":   "🔵",
  "gpt":      "🟢",
  "grok":     "⚡",
  "minimax":  "🟣",
  "default":  "⬜",
};

function modelEmoji(model: string | null): string {
  if (!model) return MODEL_EMOJI.default;
  const lower = model.toLowerCase();
  for (const [key, emoji] of Object.entries(MODEL_EMOJI)) {
    if (lower.includes(key)) return emoji;
  }
  return MODEL_EMOJI.default;
}

function modelShort(model: string | null): string {
  if (!model) return "unknown";
  return model.split("/").pop() ?? model;
}

function formatUsd(usd: number): string {
  if (usd === 0)   return "$0.000";
  if (usd < 0.001) return "<$0.001";
  return `$${usd.toFixed(3)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

const AGENT_EMOJI: Record<string, string> = {
  cestra:    "🎯",
  architect: "🏛️",
  builder:   "🔨",
  koda:      "🔨",
  qa:        "🧪",
  veda:      "🔮",
  orin:      "🔍",
  vision:    "👁️",
  loki:      "🎭",
  fin:       "💰",
  kyra:      "✍️",
  main:      "🧠",
};

function agentEmoji(name: string): string {
  return AGENT_EMOJI[name.toLowerCase()] ?? "🤖";
}

// ---------------------------------------------------------------------------
// Bar chart (pure CSS — no external deps)
// ---------------------------------------------------------------------------

function CostBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 2;
  return (
    <div className="ct-bar-bg">
      <div
        className="ct-bar-fill"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent row — OpenRouter (has cost)
// ---------------------------------------------------------------------------
function OpenRouterAgentRow({ agent, maxCost }: { agent: AgentCost; maxCost: number }) {
  return (
    <div className="ct-agent-row">
      <div className="ct-agent-info">
        <span className="ct-agent-emoji">{agentEmoji(agent.agent)}</span>
        <span className="ct-agent-name">{agent.agent}</span>
        <span className="ct-agent-model">{modelEmoji(agent.model)} {modelShort(agent.model)}</span>
      </div>
      <CostBar value={agent.estimatedUsd} max={maxCost} color="var(--neon-magenta)" />
      <div className="ct-agent-nums">
        <span className="ct-agent-tokens">{formatTokens(agent.totalTokens)}</span>
        <span className="ct-agent-cost">{formatUsd(agent.estimatedUsd)}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent row — Subscription (no cost, show tokens only)
// ---------------------------------------------------------------------------
function SubscriptionAgentRow({ agent }: { agent: AgentCost }) {
  return (
    <div className="ct-agent-row ct-agent-row--subscription">
      <div className="ct-agent-info">
        <span className="ct-agent-emoji">{agentEmoji(agent.agent)}</span>
        <span className="ct-agent-name">{agent.agent}</span>
        <span className="ct-agent-model">{modelEmoji(agent.model)} {modelShort(agent.model)}</span>
      </div>
      <div className="ct-sub-bar">
        <div className="ct-sub-fill" style={{ width: "100%" }} />
      </div>
      <div className="ct-agent-nums">
        <span className="ct-agent-tokens">{formatTokens(agent.totalTokens)}</span>
        <span className="ct-agent-cost ct-sub-label">Subscription</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CostTracking() {
  const { data, loading, error, refresh } = useCosts();
  const [sortBy, setSortBy] = useState<"cost" | "tokens" | "agent">("cost");

  const openrouter = data
    ? [...(data.openrouterAgents ?? [])].sort((a, b) => {
        if (sortBy === "cost")   return b.estimatedUsd - a.estimatedUsd;
        if (sortBy === "tokens") return b.totalTokens  - a.totalTokens;
        return a.agent.localeCompare(b.agent);
      })
    : [];

  const subscription = data?.subscriptionAgents ?? [];

  const maxCost = openrouter.reduce((m, a) => Math.max(m, a.estimatedUsd), 0);

  // Group OpenRouter agents by model for summary
  const byModel: Record<string, { tokens: number; usd: number; count: number }> = {};
  openrouter.forEach(a => {
    const key = a.model ?? "unknown";
    if (!byModel[key]) byModel[key] = { tokens: 0, usd: 0, count: 0 };
    byModel[key].tokens += a.totalTokens;
    byModel[key].usd    += a.estimatedUsd;
    byModel[key].count  += 1;
  });

  return (
    <section className="panel ct-panel">
      <div className="ct-header">
        <h2>Cost Tracking</h2>
        <button className="ct-refresh-btn" onClick={refresh} title="Refresh">↻</button>
      </div>

      {loading && <p className="empty-state">Calculating costs…</p>}
      {error   && <p className="ct-error">⚠️ {error}</p>}

      {data && (
        <>
          {/* Total summary */}
          <div className="ct-totals">
            <div className="ct-total-card">
              <span className="ct-total-value">{formatUsd(data.totalUsd)}</span>
              <span className="ct-total-label">OpenRouter Spend</span>
            </div>
            <div className="ct-total-card">
              <span className="ct-total-value">{formatTokens(data.totalTokens)}</span>
              <span className="ct-total-label">Total Tokens</span>
            </div>
            <div className="ct-total-card ct-total-card--sub">
              <span className="ct-total-value">{subscription.length}</span>
              <span className="ct-total-label">Subscription Agents</span>
            </div>
          </div>

          {/* OpenRouter model breakdown */}
          {Object.keys(byModel).length > 0 && (
            <div className="ct-models">
              <h4 className="ct-section-title">OpenRouter — By Model</h4>
              <div className="ct-model-list">
                {Object.entries(byModel)
                  .sort(([, a], [, b]) => b.usd - a.usd)
                  .map(([model, stats]) => (
                    <div key={model} className="ct-model-row">
                      <span className="ct-model-emoji">{modelEmoji(model)}</span>
                      <span className="ct-model-name">{modelShort(model)}</span>
                      <span className="ct-model-tokens">{formatTokens(stats.tokens)}</span>
                      <span className="ct-model-cost">{formatUsd(stats.usd)}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* OpenRouter agents */}
          {openrouter.length > 0 && (
            <div className="ct-agents">
              <div className="ct-agents-header">
                <h4 className="ct-section-title">OpenRouter Agents</h4>
                <div className="ct-sort-btns">
                  {(["cost", "tokens", "agent"] as const).map(s => (
                    <button
                      key={s}
                      className={`ct-sort-btn ${sortBy === s ? "ct-sort-btn--active" : ""}`}
                      onClick={() => setSortBy(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div className="ct-agent-list">
                {openrouter.map(agent => (
                  <OpenRouterAgentRow key={agent.agent} agent={agent} maxCost={maxCost} />
                ))}
              </div>
            </div>
          )}

          {/* Subscription agents */}
          {subscription.length > 0 && (
            <div className="ct-agents">
              <h4 className="ct-section-title ct-sub-section-title">
                🟠 Anthropic Max — Subscription
              </h4>
              <p className="ct-sub-note">
                Cestra and Architect run on Dominic's Anthropic Max plan.
                Token usage tracked below — no per-token cost.
              </p>
              <div className="ct-agent-list">
                {subscription.map(agent => (
                  <SubscriptionAgentRow key={agent.agent} agent={agent} />
                ))}
              </div>
            </div>
          )}

          <p className="ct-disclaimer">
            * OpenRouter costs estimated from known per-token rates. Actual billing may differ.
            Claude agents (Cestra, Architect) use Anthropic Max subscription — not billed per token.
          </p>
        </>
      )}
    </section>
  );
}

export default CostTracking;
