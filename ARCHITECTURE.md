# ARCHITECTURE - Independent Agent Registry

**DC81 Autonomous Squad** — All agents are independent, not subagents.

## Agent Directory Structure

```
/root/.openclaw/
├── agents/
│   ├── cestra/           # Squad Lead
│   │   └── SOUL.md, AGENTS.md
│   ├── veda/             # Product Intelligence
│   │   ├── SOUL.md, AGENTS.md
│   │   └── memory/
│   ├── orin/             # Customer Research
│   │   ├── SOUL.md, AGENTS.md
│   │   └── memory/
│   ├── vision/           # SEO Intelligence
│   │   ├── SOUL.md, AGENTS.md
│   │   └── memory/
│   └── loki/             # Content Intelligence
│       ├── SOUL.md, AGENTS.md
│       └── memory/
└── workspace-[agentname]/  # Operational workspaces
```

## Independent Agents

| Agent | Role | Convex ID | Heartbeat | Agent Space |
|-------|------|-----------|-----------|-------------|
| Cestra | Squad Lead | j97cnp3g5vvsaxsdv528q279m180rs94 | :00 | /root/.openclaw/agents/cestra/ |
| VEDA | Product Intelligence | j9794m411dkxq7cxnxp3q64ddh80r3dd | :02 | /root/.openclaw/agents/veda/ |
| ORIN | Customer Research | j97dfmkd4f97h02cv04681ygk180rfp0 | :04 | /root/.openclaw/agents/orin/ |
| Vision | SEO Intelligence | j97exdh8gemwt69xvmegzv2tzd80s8av | :06 | /root/.openclaw/agents/vision/ |
| Loki | Content Architect | j97fxpw585n54kf728044fax2d80sk7z | :08 | /root/.openclaw/agents/loki/ |

## Session Architecture

- **Cestra:** Main session (webchat + WhatsApp)
- **VEDA:** Independent isolated session (veda-independent)
- **ORIN:** Independent isolated session (orin-independent)
- **Vision:** Independent isolated session (vision-independent)
- **Loki:** Independent isolated session (loki-independent)

## Key Principles

1. Each agent has their own agent space at /root/.openclaw/agents/[agentname]/
2. Each agent has SOUL.md (personality) and AGENTS.md (operating manual)
3. Each agent has persistent memory in their agent space
4. Agents communicate via Convex (tasks, notifications, mentions)
5. Cestra is squad lead, not parent — all agents are peers

## Communication Flow

- **VEDA → ORIN:** "Validate this product opportunity"
- **ORIN → Cestra:** "GO/PIVOT/KILL recommendation"
- **Vision ↔ Loki:** Content briefs ↔ Content delivery
- **VEDA ↔ Vision:** Product-led growth insights
- **All → Cestra:** Strategic decisions, escalations
