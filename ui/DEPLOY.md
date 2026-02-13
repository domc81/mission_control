# Mission Control Deployment Guide

## Option 1: Vercel (Recommended - 2 minutes)

```bash
cd /root/.openclaw/workspace-cestra/ui

# Install Vercel CLI
npm i -g vercel

# Deploy (will ask for login)
vercel --prod
```

**Or connect to Vercel:**
1. Push this repo to GitHub/GitLab
2. Import project in Vercel
3. Set `VITE_CONVEX_URL` environment variable to your Convex URL
4. Deploy

---

## Option 2: Netlify

```bash
cd /root/.openclaw/workspace-cestra/ui

# Build static files
npm install
npm run build

# Deploy build/ folder to Netlify (drag & drop or CLI)
```

---

## Option 3: Cloudflare Pages (Free)

```bash
npm install -g wrangler
wrangler pages deploy build
```

---

## Environment Variables Required

For any deployment, set:
- `VITE_CONVEX_URL=https://exciting-warbler-274.eu-west-1.convex.cloud`

---

## What You Get

Once deployed:
- **Real-time updates** (no polling!) via Convex subscriptions
- **Agent status** live
- **Kanban board** drag-drop
- **Document CRUD**
- **Activity feed** with filters

The URL will be something like:
- `mission-control.vercel.app`
- `dc81-dashboard.netlify.app`
