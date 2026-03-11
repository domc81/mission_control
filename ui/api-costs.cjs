/**
 * api-costs.cjs
 *
 * GET /api/costs — reads sessions.json files for all agents and returns
 * per-agent token usage + estimated USD cost.
 *
 * AGENT BILLING MODEL:
 *   Anthropic/Claude agents (Cestra, Architect) → Dominic's Anthropic Max
 *   subscription. No per-token cost. Show token counts only with note.
 *
 *   OpenRouter agents (Koda, Kyra, Veda, Vision, Orin, Loki, Fin) → real
 *   per-token costs apply. Estimated from known rates.
 *
 * Token pricing (OpenRouter mid-2025, per 1M tokens):
 *   claude-sonnet-4*     Anthropic Max — subscription only
 *   claude-*haiku*       Anthropic Max — subscription only
 *   claude-*             Anthropic Max — subscription only
 *   gemini-2.5-flash*    input $0.15 / output $0.60
 *   gemini*              input $0.35 / output $1.05
 *   gpt-4o-mini          input $0.15 / output $0.60
 *   gpt-4o               input $2.50 / output $10.00
 *   grok-code-fast*      input $5.00 / output $15.00
 *   grok*                input $5.00 / output $15.00
 *   minimax*             input $0.30 / output $0.30
 *   default (unknown)    input $1.00 / output $3.00
 *
 * Agents on Anthropic Max subscription (no cost to track):
 *   cestra, architect
 *
 * Agents on OpenRouter (real cost):
 *   koda, kyra, veda, vision, orin, loki, fin
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const AGENTS_DIR = process.env.AGENTS_DIR || '/root/.openclaw/agents';

// ---------------------------------------------------------------------------
// Agents on Anthropic Max subscription (no per-token billing)
// ---------------------------------------------------------------------------
const ANTHROPIC_MAX_AGENTS = new Set(['cestra', 'architect']);

// ---------------------------------------------------------------------------
// Pricing table — per million tokens [input, output]
// Only used for OpenRouter agents.
// ---------------------------------------------------------------------------
const PRICING = [
  { pattern: /claude/i,                 rates: [0, 0],   subscription: true  },
  { pattern: /anthropic/i,              rates: [0, 0],   subscription: true  },
  { pattern: /gemini-2\.5-flash/i,      rates: [0.15, 0.60]  },
  { pattern: /gemini/i,                 rates: [0.35, 1.05]  },
  { pattern: /gpt-4o-mini/i,            rates: [0.15, 0.60]  },
  { pattern: /gpt-4o/i,                 rates: [2.50, 10.00] },
  { pattern: /gpt/i,                    rates: [1.00, 3.00]  },
  { pattern: /grok-code-fast/i,         rates: [5.00, 15.00] },
  { pattern: /grok/i,                   rates: [5.00, 15.00] },
  { pattern: /minimax/i,                rates: [0.30, 0.30]  },
];

const DEFAULT_RATES = [1.00, 3.00];

function getRates(model) {
  if (!model) return { rates: DEFAULT_RATES, subscription: false };
  for (const entry of PRICING) {
    if (entry.pattern.test(model)) {
      return { rates: entry.rates, subscription: !!entry.subscription };
    }
  }
  return { rates: DEFAULT_RATES, subscription: false };
}

function estimateUsd(model, inputTok, outputTok, isSubscriptionAgent) {
  if (isSubscriptionAgent) return 0;
  const { rates, subscription } = getRates(model);
  if (subscription) return 0;
  const [inputRate, outputRate] = rates;
  return (inputTok / 1_000_000) * inputRate +
         (outputTok / 1_000_000) * outputRate;
}

// ---------------------------------------------------------------------------
// Read sessions.json for one agent
// ---------------------------------------------------------------------------

function readAgentSessions(agentName) {
  const filePath = path.join(AGENTS_DIR, agentName, 'sessions', 'sessions.json');
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Aggregate costs across all agents
// ---------------------------------------------------------------------------

function computeCosts() {
  let agents;
  try {
    agents = fs.readdirSync(AGENTS_DIR).filter(name => {
      const stat = fs.statSync(path.join(AGENTS_DIR, name));
      return stat.isDirectory();
    });
  } catch {
    return {
      agents: [],
      openrouterAgents: [],
      subscriptionAgents: [],
      totalUsd: 0,
      totalTokens: 0,
      generatedAt: Date.now(),
    };
  }

  const results = [];

  for (const agentName of agents) {
    const sessions = readAgentSessions(agentName);
    if (!sessions) continue;

    const isSubscription = ANTHROPIC_MAX_AGENTS.has(agentName.toLowerCase());

    let primaryModel = null;
    let totalTokens  = 0;
    let totalInput   = 0;
    let totalOutput  = 0;
    let sessionCount = 0;

    for (const [sessionKey, session] of Object.entries(sessions)) {
      if (!session || typeof session !== 'object') continue;

      if (!primaryModel && session.model) {
        primaryModel = session.model;
      }
      if (sessionKey.endsWith(':main') && session.model) {
        primaryModel = session.model;
      }

      const tt = session.totalTokens  || 0;
      const it = session.inputTokens  || 0;
      const ot = session.outputTokens || 0;

      totalTokens  += tt;
      totalInput   += it;
      totalOutput  += ot;
      sessionCount++;
    }

    if (totalTokens === 0 && totalInput === 0 && totalOutput === 0) continue;

    // Estimate token split
    let inputEst  = totalInput;
    let outputEst = totalOutput;

    if (totalTokens > (totalInput + totalOutput)) {
      const ratio = (totalInput + totalOutput) > 0
        ? totalInput / (totalInput + totalOutput)
        : 0.75;
      inputEst  = Math.round(totalTokens * ratio);
      outputEst = totalTokens - inputEst;
    }

    const estimatedUsd = isSubscription
      ? 0
      : estimateUsd(primaryModel, inputEst, outputEst, false);

    results.push({
      agent:        agentName,
      model:        primaryModel,
      totalTokens,
      inputTokens:  inputEst,
      outputTokens: outputEst,
      estimatedUsd,
      sessionCount,
      isSubscription,
    });
  }

  // Split into subscription vs OpenRouter for display
  const subscriptionAgents = results.filter(a => a.isSubscription);
  const openrouterAgents   = results.filter(a => !a.isSubscription);

  // Total cost = OpenRouter spend ONLY
  const totalUsd  = openrouterAgents.reduce((s, a) => s + a.estimatedUsd, 0);
  const totalTok  = results.reduce((s, a) => s + a.totalTokens,  0);

  return {
    agents:             results,          // all agents (for backwards compat)
    openrouterAgents,
    subscriptionAgents,
    totalUsd,                             // OpenRouter spend only
    totalTokens:        totalTok,
    generatedAt:        Date.now(),
  };
}

// ---------------------------------------------------------------------------
// HTTP handler (called from proxy-server.cjs)
// ---------------------------------------------------------------------------

function handleCostsRequest(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  try {
    const data = computeCosts();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  } catch (err) {
    console.error('[api-costs] Error computing costs:', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal error' }));
  }
}

module.exports = { handleCostsRequest };
