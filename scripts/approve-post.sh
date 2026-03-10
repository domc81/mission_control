#!/usr/bin/env bash
# approve-post.sh — DC81 Content Ops
# Routes an approved social post to the correct posting script.
#
# Usage:
#   bash approve-post.sh <post_id> <APPROVE|REJECT> [reason]
#   bash approve-post.sh <post_id> APPROVE --dry-run
#
# post_id: UUID from content_posts table
# action:  APPROVE or REJECT (case-insensitive)
# reason:  (optional, REJECT only) rejection reason text

set -euo pipefail

# ---------------------------------------------------------------------------
# Args
# ---------------------------------------------------------------------------
if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <post_id> <APPROVE|REJECT> [reason|--dry-run]" >&2
  exit 1
fi

POST_ID="$1"
ACTION="${2^^}"   # uppercase
shift 2
REASON="${*:-}"
DRY_RUN=false

if [[ "$REASON" == "--dry-run" ]] || [[ "$ACTION" == "--DRY-RUN" ]]; then
  DRY_RUN=true
  REASON=""
fi

LOG_FILE="/root/.openclaw/workspace-cestra/logs/approve-post.log"
mkdir -p "$(dirname "$LOG_FILE")"

log() { echo "[$(date -u +%H:%M:%SZ)] $*" | tee -a "$LOG_FILE"; }
die() { log "ERROR: $*" >&2; exit 1; }

log "approve-post.sh start — post_id=$POST_ID action=$ACTION dry_run=$DRY_RUN"

# ---------------------------------------------------------------------------
# Load credentials
# ---------------------------------------------------------------------------
CREDS_FILE="/root/.dc81-supabase-credentials"
[[ -f "$CREDS_FILE" ]] || die "Supabase creds not found: $CREDS_FILE"

while IFS='=' read -r key value; do
  [[ -z "$key" || "$key" =~ ^# ]] && continue
  export "$key"="$value"
done < "$CREDS_FILE"

[[ -z "${DC81_SUPABASE_URL:-}" ]] && die "DC81_SUPABASE_URL not set"
[[ -z "${DC81_SUPABASE_ANON_KEY:-}" ]] && die "DC81_SUPABASE_ANON_KEY not set"

SB_URL="$DC81_SUPABASE_URL"
SB_KEY="$DC81_SUPABASE_ANON_KEY"

# Also load Late credentials (needed for late-post.py)
LATE_ENV="/root/.openclaw/workspace-cestra/scripts/load-late-env.sh"
[[ -f "$LATE_ENV" ]] && source "$LATE_ENV" 2>/dev/null || true

# ---------------------------------------------------------------------------
# Fetch post from Supabase (content_posts table)
# ---------------------------------------------------------------------------
log "Fetching post from content_posts..."
RESPONSE=$(curl -s \
  "$SB_URL/rest/v1/content_posts?id=eq.$POST_ID&select=id,platforms,status,content" \
  -H "apikey: $SB_KEY" \
  -H "Authorization: Bearer $SB_KEY")

ROW_COUNT=$(echo "$RESPONSE" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
if [[ "$ROW_COUNT" == "0" ]]; then
  # Fallback: try social_posts table
  log "Not found in content_posts — trying social_posts..."
  RESPONSE=$(curl -s \
    "$SB_URL/rest/v1/social_posts?id=eq.$POST_ID&select=id,platform,status,content" \
    -H "apikey: $SB_KEY" \
    -H "Authorization: Bearer $SB_KEY")
  ROW_COUNT=$(echo "$RESPONSE" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
  TABLE="social_posts"
  PLATFORM_FIELD="platform"
else
  TABLE="content_posts"
  PLATFORM_FIELD="platforms"
fi

[[ "$ROW_COUNT" == "0" ]] && die "Post $POST_ID not found in content_posts or social_posts"

PLATFORMS=$(echo "$RESPONSE" | python3 -c "
import sys, json
rows = json.load(sys.stdin)
row = rows[0]
# Handle both 'platform' (string) and 'platforms' (array)
val = row.get('platforms') or row.get('platform')
if isinstance(val, list):
    print(' '.join(val))
elif isinstance(val, str):
    print(val)
" 2>/dev/null)

log "Found post in $TABLE | platforms: $PLATFORMS | status: $(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)[0].get('status','?'))" 2>/dev/null)"

# ---------------------------------------------------------------------------
# REJECT path
# ---------------------------------------------------------------------------
if [[ "$ACTION" == "REJECT" ]]; then
  log "Action: REJECT | reason: ${REASON:-none}"
  if [[ "$DRY_RUN" == "true" ]]; then
    log "[DRY RUN] Would PATCH $TABLE status=rejected, rejection_reason='$REASON'"
    exit 0
  fi
  curl -s -X PATCH \
    "$SB_URL/rest/v1/$TABLE?id=eq.$POST_ID" \
    -H "apikey: $SB_KEY" \
    -H "Authorization: Bearer $SB_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"status\":\"rejected\",\"error_message\":\"Rejected: ${REASON}\"}" \
    -o /dev/null -w "Supabase PATCH: %{http_code}\n"
  log "Post $POST_ID rejected."
  exit 0
fi

# ---------------------------------------------------------------------------
# APPROVE path
# ---------------------------------------------------------------------------
if [[ "$ACTION" != "APPROVE" ]]; then
  die "Unknown action: $ACTION. Use APPROVE or REJECT."
fi

log "Action: APPROVE"

# Mark approved in Supabase
if [[ "$DRY_RUN" == "false" ]]; then
  curl -s -X PATCH \
    "$SB_URL/rest/v1/$TABLE?id=eq.$POST_ID" \
    -H "apikey: $SB_KEY" \
    -H "Authorization: Bearer $SB_KEY" \
    -H "Content-Type: application/json" \
    -d '{"status":"approved"}' \
    -o /dev/null -w "Supabase PATCH approved: %{http_code}\n"
fi

# Route to correct poster per platform
EXIT_CODE=0
for PLATFORM in $PLATFORMS; do
  log "Routing platform: $PLATFORM"

  case "$PLATFORM" in
    twitter|x)
      SCRIPT="node /root/.openclaw/workspace-cestra/scripts/x-post.cjs"
      ;;
    linkedin|instagram|facebook|tiktok|googlebusiness)
      SCRIPT="python3 /root/.openclaw/workspace-cestra/scripts/late-post.py"
      ;;
    *)
      log "[WARN] Unknown platform '$PLATFORM' — skipping"
      continue
      ;;
  esac

  if [[ "$DRY_RUN" == "true" ]]; then
    log "[DRY RUN] Would run: $SCRIPT $POST_ID"
    continue
  fi

  log "Running: $SCRIPT $POST_ID"
  if $SCRIPT "$POST_ID" >> "$LOG_FILE" 2>&1; then
    log "✓ $PLATFORM posted successfully"
  else
    log "✗ $PLATFORM posting FAILED (exit $?)"
    EXIT_CODE=1
  fi
done

if [[ "$DRY_RUN" == "true" ]]; then
  log "[DRY RUN] Complete — no changes made"
fi

log "approve-post.sh complete (exit $EXIT_CODE)"
exit $EXIT_CODE
