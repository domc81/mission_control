# DC81 Mission Control — Coolify Deployment Guide

## One-Time Setup

### 1. Create New Application in Coolify
- Go to Coolify → **New Resource** → **Application**
- Source: **GitHub** → `domc81/mission_control`
- Branch: `master`
- Build pack: **Nixpacks** (auto-detected)

### 2. Configure Paths
| Setting | Value |
|---|---|
| Base Directory | `/ui` |
| Publish Directory | *(leave blank — nixpacks handles it)* |
| Port | `3000` |

### 3. Add Environment Variable
In Coolify → Environment Variables, add:
```
VITE_CONVEX_URL=https://exciting-warbler-274.eu-west-1.convex.cloud
```

### 4. Deploy
Hit **Deploy**. Coolify will:
1. Clone `domc81/mission_control`
2. Enter the `/ui` directory
3. Run `npm ci && npm run build`
4. Serve the built `dist/` on port 3000

### 5. URL
Coolify will generate a URL automatically (e.g. `mission-control.yourdomain.com`).
You can also set a custom domain or access it via the auto-generated Coolify URL.

---

## Future Deploys
Any push to `master` on `domc81/mission_control` can trigger an auto-redeploy via Coolify's GitHub webhook (enable in Coolify app settings).

## Convex
The Convex backend is already live at `https://exciting-warbler-274.eu-west-1.convex.cloud`.
No changes needed there — it's deployed separately via the Convex CLI.
