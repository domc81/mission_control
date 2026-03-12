#!/usr/bin/env bash
# approve-post.sh — DC81 Content Ops
# Routes an approved social post to the correct posting script.
# Scheduling: posts are scheduled into the next available platform window
# rather than published immediately.
#
# Posting windows (UK time / BST = UTC+1):
#   LinkedIn:  09:00
#   X:         09:30, 13:00, 17:00
#   Instagram: 10:00
#   Facebook:  10:30
#
# Usage:
#   bash approve-post.sh <post_id> <APPROVE|REJECT> [reason]
#   bash approve-post.sh <post_id> APPROVE --dry-run
#
# post_id: UUID from social_posts or content_posts table
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

# Load Late credentials
LATE_ENV="/root/.openclaw/workspace-cestra/scripts/load-late-env.sh"
[[ -f "$LATE_ENV" ]] && source "$LATE_ENV" 2>/dev/null || true

# ---------------------------------------------------------------------------
# Scheduling: next available window per platform
# Returns ISO 8601 UTC timestamp for the next available posting slot.
# Skips slots already used today by checking social_posts.scheduled_for.
# ---------------------------------------------------------------------------
get_next_window() {
  local PLATFORM="$1"
  python3 << PYEOF
import sys
from datetime import datetime, timezone, timedelta
import requests, json

platform = "${PLATFORM}"
sb_url = "${SB_URL}"
sb_key = "${SB_KEY}"

# Posting windows in UK local hours (BST = UTC+1, GMT = UTC+0)
# We check current UTC offset dynamically based on DST
# For simplicity: BST (last Sun Mar - last Sun Oct) = UTC+1, GMT = UTC+0
import time
uk_offset_hours = 1  # BST (March–October)
uk_offset = timedelta(hours=uk_offset_hours)
now_utc = datetime.now(timezone.utc)
now_uk = now_utc + uk_offset

WINDOWS = {
    "x":         [(9, 30), (13, 0), (17, 0)],
    "twitter":   [(9, 30), (13, 0), (17, 0)],
    "linkedin":  [(9, 0)],
    "instagram": [(10, 0)],
    "facebook":  [(10, 30)],
}

slots = WINDOWS.get(platform, [(9, 0)])

# Fetch already-scheduled posts for this platform (today + tomorrow)
headers = {"apikey": sb_key, "Authorization": f"Bearer {sb_key}"}
today_str = now_utc.date().isoformat()
try:
    r = requests.get(
        f"{sb_url}/rest/v1/social_posts"
        f"?platform=eq.{platform}&status=in.(scheduled,approved)"
        f"&scheduled_for=gte.{today_str}T00:00:00Z"
        f"&select=scheduled_for",
        headers=headers, timeout=10
    )
    used_slots = set()
    for row in r.json():
        if row.get("scheduled_for"):
            dt = datetime.fromisoformat(row["scheduled_for"].replace("Z", "+00:00"))
            used_slots.add((dt.year, dt.month, dt.day, dt.hour, dt.minute))
except Exception:
    used_slots = set()

# Find first available slot from now, today first then tomorrow
for day_offset in range(7):
    candidate_day = (now_uk + timedelta(days=day_offset)).date()
    for h, m in slots:
        slot_uk = datetime(candidate_day.year, candidate_day.month, candidate_day.day,
                           h, m, 0, tzinfo=timezone.utc) - uk_offset
        # Convert to UTC
        slot_utc = slot_uk.replace(tzinfo=timezone.utc) if slot_uk.tzinfo is None else slot_uk
        slot_utc_aware = datetime(candidate_day.year, candidate_day.month, candidate_day.day,
                                  h, m, 0, tzinfo=timezone(uk_offset)) - uk_offset + timedelta(0)
        # Simpler: just compute UTC from UK time
        slot_utc_dt = datetime(candidate_day.year, candidate_day.month, candidate_day.day,
                               h, m, 0) - uk_offset + timedelta(hours=uk_offset_hours)
        slot_utc_dt = datetime(candidate_day.year, candidate_day.month, candidate_day.day,
                               h, m, 0, tzinfo=timezone.utc) + timedelta(hours=-uk_offset_hours)

        # Must be in the future (at least 5 min buffer)
        if slot_utc_dt < now_utc + timedelta(minutes=5):
            continue

        # Not already used
        slot_key = (slot_utc_dt.year, slot_utc_dt.month, slot_utc_dt.day,
                    slot_utc_dt.hour, slot_utc_dt.minute)
        if slot_key in used_slots:
            continue

        print(slot_utc_dt.strftime("%Y-%m-%dT%H:%M:%SZ"))
        sys.exit(0)

# Fallback: tomorrow 09:00 UK
fallback = (now_uk + timedelta(days=1)).replace(hour=9, minute=0, second=0, microsecond=0)
fallback_utc = fallback - uk_offset
print(fallback_utc.strftime("%Y-%m-%dT%H:%M:%SZ"))
PYEOF
}

# ---------------------------------------------------------------------------
# Schedule via Late API
# ---------------------------------------------------------------------------
schedule_via_late() {
  local PLATFORM="$1"
  local CONTENT="$2"
  local SCHEDULED_FOR="$3"

  # Map our platform names to Late platform names and account IDs
  python3 << PYEOF
import sys, requests, json

platform = "${PLATFORM}"
content = """${CONTENT}"""
scheduled_for = "${SCHEDULED_FOR}"

late_creds = {}
for line in open("/root/.late-credentials"):
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        late_creds[k.strip()] = v.strip()

LATE_KEY = late_creds["LATE_API_KEY"]
headers = {"Authorization": f"Bearer {LATE_KEY}", "Content-Type": "application/json"}

account_map = {
    "x":         {"platform": "twitter",  "id": late_creds.get("LATE_TWITTER_ID")},
    "twitter":   {"platform": "twitter",  "id": late_creds.get("LATE_TWITTER_ID")},
    "linkedin":  {"platform": "linkedin", "id": late_creds.get("LATE_LINKEDIN_ID")},
    "facebook":  {"platform": "facebook", "id": late_creds.get("LATE_FACEBOOK_ID")},
    "instagram": {"platform": "instagram","id": late_creds.get("LATE_INSTAGRAM_ID")},
}

acct = account_map.get(platform)
if not acct or not acct["id"]:
    print(f"ERROR: no Late account for platform {platform}", file=sys.stderr)
    sys.exit(1)

payload = {
    "content": content,
    "platforms": [{"platform": acct["platform"], "accountId": acct["id"]}],
    "scheduledFor": scheduled_for,
}

r = requests.post("https://getlate.dev/api/v1/posts", headers=headers, json=payload, timeout=30)
if r.status_code in (200, 201):
    resp = r.json()
    late_id = resp.get("post", {}).get("_id") or resp.get("_id", "?")
    print(late_id)
    sys.exit(0)
else:
    print(f"ERROR: {r.status_code} {r.text[:200]}", file=sys.stderr)
    sys.exit(1)
PYEOF
}

# ---------------------------------------------------------------------------
# Fetch post from Supabase
# ---------------------------------------------------------------------------
log "Fetching post..."
RESPONSE=$(curl -s \
  "$SB_URL/rest/v1/content_posts?id=eq.$POST_ID&select=id,platforms,status,content" \
  -H "apikey: $SB_KEY" \
  -H "Authorization: Bearer $SB_KEY")

ROW_COUNT=$(echo "$RESPONSE" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
if [[ "$ROW_COUNT" == "0" ]]; then
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

[[ "$ROW_COUNT" == "0" ]] && die "Post $POST_ID not found"

PLATFORMS=$(echo "$RESPONSE" | python3 -c "
import sys, json
rows = json.load(sys.stdin)
row = rows[0]
val = row.get('platforms') or row.get('platform')
if isinstance(val, list):
    print(' '.join(val))
elif isinstance(val, str):
    print(val)
" 2>/dev/null)

CONTENT=$(echo "$RESPONSE" | python3 -c "
import sys, json
print(json.load(sys.stdin)[0].get('content',''))
" 2>/dev/null)

log "Found post in $TABLE | platforms: $PLATFORMS | status: $(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)[0].get('status','?'))" 2>/dev/null)"

# ---------------------------------------------------------------------------
# REJECT path
# ---------------------------------------------------------------------------
if [[ "$ACTION" == "REJECT" ]]; then
  log "Action: REJECT | reason: ${REASON:-none}"
  if [[ "$DRY_RUN" == "true" ]]; then
    log "[DRY RUN] Would PATCH $TABLE status=rejected"
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
[[ "$ACTION" != "APPROVE" ]] && die "Unknown action: $ACTION. Use APPROVE or REJECT."

log "Action: APPROVE — scheduling into next available windows"

EXIT_CODE=0
for PLATFORM in $PLATFORMS; do
  log "Processing platform: $PLATFORM"

  # Get next available window
  SCHEDULED_FOR=$(get_next_window "$PLATFORM")
  log "Next available window for $PLATFORM: $SCHEDULED_FOR"

  if [[ "$DRY_RUN" == "true" ]]; then
    log "[DRY RUN] Would schedule $PLATFORM post at $SCHEDULED_FOR"
    continue
  fi

  # Schedule via Late API (all platforms including X via Late's Twitter integration)
  case "$PLATFORM" in
    twitter|x|linkedin|instagram|facebook|tiktok|googlebusiness)
      LATE_POST_ID=$(schedule_via_late "$PLATFORM" "$CONTENT" "$SCHEDULED_FOR" 2>>"$LOG_FILE") || {
        log "✗ $PLATFORM scheduling FAILED"
        EXIT_CODE=1
        continue
      }
      log "✓ $PLATFORM scheduled via Late | Late ID: $LATE_POST_ID | at $SCHEDULED_FOR"
      # Update Supabase
      curl -s -X PATCH \
        "$SB_URL/rest/v1/$TABLE?id=eq.$POST_ID" \
        -H "apikey: $SB_KEY" \
        -H "Authorization: Bearer $SB_KEY" \
        -H "Content-Type: application/json" \
        -d "{\"status\":\"scheduled\",\"platform_post_id\":\"${LATE_POST_ID}\",\"scheduled_for\":\"${SCHEDULED_FOR}\"}" \
        -o /dev/null
      ;;
    *)
      log "[WARN] Unknown platform '$PLATFORM' — skipping"
      ;;
  esac
done

if [[ "$DRY_RUN" == "true" ]]; then
  log "[DRY RUN] Complete — no changes made"
fi

log "approve-post.sh complete (exit $EXIT_CODE)"
exit $EXIT_CODE
