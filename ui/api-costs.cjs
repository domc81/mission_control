/**
 * api-costs.cjs
 *
 * GET /api/costs — reads sessions.json files for all agents and returns
 * per-agent token usage + estimated USD cost.
 *
 * Called from proxy-server.cjs. Exported as a function that receives
 * the http.IncomingMessage (req) and http.ServerResponse (res).
 *
 * Token pricing (OpenRouter mid-2025, per 1M tokens):
 *   claude-sonnet-4*     input $3.00 / output $15.00
 *   claude-*haiku*       input $0.25 / output $1.25
 *   gemini-2.5-flash*    input $0.15 / output $0.60
 *   gpt-4o               input $2.50 / output $10.00
 *   gpt-4o-mini          input $0.15 / output $0.60
 *   grok-*               input $5.00 / output $15.00
 *   minimax-*            input $0.30 / output $0.30
 *   default (unknown)    input $1.00 / output $3.00
 *
 * Note: `totalTokens` in sessions.json is the cumulative lifetime total.
 * `inputTokens`/`outputTokens` reflect only the LAST run's delta.
 * We use totalTokens as a reasonable proxy for lifetime usage, split
 * proportionally by last-known input:output ratio.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const AGENTS_DIR = process.env.AGENTS_DIR || '/root/.openclaw/agents';

// ---------------------------------------------------------------------------
// Pricing table — per million tokens [input, output]
// ---------------------------------------------------------------------------

const PRICING = [
  { pattern: /claude-sonnet/i,          rates: [3.00,  15.00] },
  { pattern: /claude-opus/i,            rates: [15.00, 75.00] },
  { pattern: /claude.*haiku/i,          rates: [0.25,  1.25]  },
  { pattern: /claude/i,                 rates: [3.00,  15.00] },
  { pattern: /gemini-2\.5-flash/i,      rates: [0.15,  0.60]  },
  { pattern: /gemini/i,                 rates: [0.35,  1.05]  },
  { pattern: /gpt-4o-mini/i,            rates: [0.15,  0.60]  },
  { pattern: /gpt-4o/i,                 rates: [2.50,  10.00] },
  { pattern: /gpt/i,                    rates: [1.00,  3.00]  },
  { pattern: /grok-code-fast/i,         rates: [5.00,  15.00] },
  { pattern: /grok/i,                   rates: [5.00,  15.00] },
  { pattern: /minimax/i,                rates: [0.30,  0.30]  },
];

const DEFAULT_RATES = [1.00, 3.00];

function getRates(model) {
  if (!model) return DEFAULT_RATES;
  for (const { pattern, rates } of PRICING) {
    if (pattern.test(model)) return rates;
  }
  return DEFAULT_RATES;
}

function estimateUsd(model, inputTok, outputTok) {
  const [inputRate, outputRate] = getRates(model);
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
    return { agents: [], totalUsd: 0, totalTokens: 0, generatedAt: Date.now() };
  }

  const results = [];

  for (const agentName of agents) {
    const sessions = readAgentSessions(agentName);
    if (!sessions) continue;

    // Find the "main" session (agentName:main pattern) for model info
    // Fall back to any session with a model set
    let primaryModel = null;
    let totalTokens  = 0;
    let totalInput   = 0;
    let totalOutput  = 0;
    let sessionCount = 0;

    for (const [sessionKey, session] of Object.entries(sessions)) {
      if (!session || typeof session !== 'object') continue;

      // Prefer main session for model
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

    // Estimate USD:
    // totalTokens is lifetime cumulative — split proportionally by last-known i/o ratio
    let inputEst  = totalInput;
    let outputEst = totalOutput;

    if (totalTokens > (totalInput + totalOutput)) {
      // totalTokens is larger (cumulative); use it with a 3:1 input:output ratio as fallback
      const ratio = (totalInput + totalOutput) > 0
        ? totalInput / (totalInput + totalOutput)
        : 0.75;
      inputEst  = Math.round(totalTokens * ratio);
      outputEst = totalTokens - inputEst;
    }

    const estimatedUsd = estimateUsd(primaryModel, inputEst, outputEst);

    results.push({
      agent:        agentName,
      model:        primaryModel,
      totalTokens,
      inputTokens:  inputEst,
      outputTokens: outputEst,
      estimatedUsd,
      sessionCount,
    });
  }

  const totalUsd    = results.reduce((s, a) => s + a.estimatedUsd, 0);
  const totalTok    = results.reduce((s, a) => s + a.totalTokens,  0);

  return {
    agents:       results,
    totalUsd,
    totalTokens:  totalTok,
    generatedAt:  Date.now(),
  };
}

// ---------------------------------------------------------------------------
// HTTP handler (called from proxy-server.cjs)
// ---------------------------------------------------------------------------

function handleCostsRequest(req, res) {
  // CORS for dev
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
