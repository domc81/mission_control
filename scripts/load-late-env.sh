#!/bin/bash
# Load Late API credentials into environment variables
# Usage: source /root/.openclaw/workspace-cestra/scripts/load-late-env.sh

set -euo pipefail

CREDS_FILE="/root/.late-credentials"

if [ ! -f "$CREDS_FILE" ]; then
  echo "ERROR: Late credentials file not found at $CREDS_FILE" >&2
  exit 1
fi

# Read each line as KEY=VALUE and export
while IFS='=' read -r key value; do
  # Skip empty lines and comments
  [[ -z "$key" || "$key" =~ ^# ]] && continue
  export "$key"="$value"
done < "$CREDS_FILE"

# Validate required vars are set
REQUIRED_VARS=(
  LATE_API_KEY
  LATE_PROFILE_ID
  LATE_TWITTER_ID
  LATE_INSTAGRAM_ID
  LATE_LINKEDIN_ID
  LATE_FACEBOOK_ID
  LATE_TIKTOK_ID
  LATE_GBP_ID
)

for var in "${REQUIRED_VARS[@]}"; do
  if [ -z "${!var:-}" ]; then
    echo "ERROR: $var is not set in $CREDS_FILE" >&2
    exit 1
  fi
done

export LATE_API_BASE="https://getlate.dev/api/v1"

# Convenience aliases using verified Late account IDs (for late-post.py)
export LATE_ACCOUNT_LINKEDIN="${LATE_LINKEDIN_ID:-}"
export LATE_ACCOUNT_INSTAGRAM="${LATE_INSTAGRAM_ID:-}"
export LATE_ACCOUNT_FACEBOOK="${LATE_FACEBOOK_ID:-}"
export LATE_ACCOUNT_TIKTOK="${LATE_TIKTOK_ID:-}"
export LATE_ACCOUNT_GOOGLEBUSINESS="${LATE_GBP_ID:-}"

echo "Late credentials loaded: ${#REQUIRED_VARS[@]} variables set (+ LATE_API_BASE + LATE_ACCOUNT_* aliases)"
