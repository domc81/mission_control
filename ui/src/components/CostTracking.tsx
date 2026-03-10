/**
 * CostTracking.tsx
 *
 * Per-agent, per-model cost breakdown panel.
 * Fetches from GET /api/costs (served by proxy-server.cjs / api-costs.cjs).
 *
 * Cost data comes from /root/.openclaw/agents/{agent}/sessions/sessions.json
 * Fields used: model, totalTokens, inputTokens, outputTokens
 *
 * Pricing (OpenRouter defaults, mid-2025):
 *   Costs are estimated — exact rates vary. The API endpoint calculates
 *   using known per-million-token rates for each model.
 */

import { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentCost = {
  agent:         string;
  model:         string | null;
  totalTokens:   number;
  inputTokens:   number;
  outputTokens:  number;
  estimatedUsd:  number;
  sessionCount:  number;
};

export type CostSummary = {
  agents:         AgentCost[];
  totalUsd:       number;
  totalTokens:    number;
  generatedAt:    number;
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
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const json: CostSummary = await res.json();
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
  "claude":  "🟠",
  "gemini":  "🔵",
  "gpt":     "🟢",
  "grok":    "⚡",
  "minimax": "🟣",
  "default": "⬜",
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
  if (usd === 0)    return "$0.000";
  if (usd < 0.001)  return "<$0.001";
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
// Main component
// ---------------------------------------------------------------------------

export function CostTracking() {
  const { data, loading, error, refresh } = useCosts();
  const [sortBy, setSortBy] = useState<"cost" | "tokens" | "agent">("cost");

  const sorted = data
    ? [...data.agents].sort((a, b) => {
        if (sortBy === "cost")   return b.estimatedUsd - a.estimatedUsd;
        if (sortBy === "tokens") return b.totalTokens  - a.totalTokens;
        return a.agent.localeCompare(b.agent);
      })
    : [];

  const maxCost = sorted.reduce((m, a) => Math.max(m, a.estimatedUsd), 0);

  // Group by model for summary
  const byModel: Record<string, { tokens: number; usd: number; count: number }> = {};
  data?.agents.forEach(a => {
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
              <span className="ct-total-label">Est. Total Spend</span>
            </div>
            <div className="ct-total-card">
              <span className="ct-total-value">{formatTokens(data.totalTokens)}</span>
              <span className="ct-total-label">Total Tokens</span>
            </div>
            <div className="ct-total-card">
              <span className="ct-total-value">{data.agents.length}</span>
              <span className="ct-total-label">Agents</span>
            </div>
          </div>

          {/* Model breakdown */}
          <div className="ct-models">
            <h4 className="ct-section-title">By Model</h4>
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

          {/* Per-agent breakdown */}
          <div className="ct-agents">
            <div className="ct-agents-header">
              <h4 className="ct-section-title">By Agent</h4>
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
              {sorted.map(agent => (
                <div key={agent.agent} className="ct-agent-row">
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
              ))}
            </div>
          </div>

          <p className="ct-disclaimer">
            * Estimated costs based on known per-token rates. Actual billing may differ.
          </p>
        </>
      )}
    </section>
  );
}

export default CostTracking;
