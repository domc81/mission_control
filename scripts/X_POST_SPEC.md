# X_POST_SPEC.md — X/Twitter Posting Integration

**Author:** Architect  
**Date:** 2026-03-09  
**Status:** Final  
**Task ID:** jx72vph13mcpasvmwxykja8efh82jk41  

---

## 1. Overview

This spec defines two Node.js scripts and an approval workflow update for posting to X (Twitter) via the v2 API. All posts require explicit human (Dominic) approval via WhatsApp before being published. No external npm dependencies are used — only Node.js built-ins (`https`, `crypto`, `fs`, `readline`).

---

## 2. Credential File Format

**File:** `/root/.x-credentials`  
**File:** `/root/.dc81-supabase-credentials`

Both files use env-style `KEY=VALUE` lines, one per line, no quotes, no export prefix.

### `/root/.x-credentials` — required keys:
```
X_CONSUMER_KEY=<value>
X_CONSUMER_SECRET=<value>
X_ACCESS_TOKEN=<value>
X_ACCESS_TOKEN_SECRET=<value>
```

### `/root/.dc81-supabase-credentials` — required keys:
```
DC81_SUPABASE_URL=<value>      # e.g. https://api-dc81.dc81.io
DC81_SUPABASE_ANON_KEY=<value> # anon key — relies on RLS policies being correctly configured
```

**Credential parsing — shared logic (inline in each script):**
```
function parseCredFile(path):
  read file as UTF-8 string
  split by newline
  for each line:
    skip if empty or starts with '#'
    split on first '=' only
    store key → value in object
  return object
```

---

## 3. Script: `draft-x-post.js`

**File path:** `/root/.openclaw/workspace-cestra/scripts/draft-x-post.js`  
**Runtime:** Node.js (built-ins only)  
**Invocation:** `node draft-x-post.js "<post text>"`

### 3.1 Responsibilities
1. Accept post text as CLI argument (`process.argv[2]`)
2. Validate character count ≤ 280 (hard limit; fail immediately if exceeded)
3. Insert a new row into `social_posts` via Supabase REST API
4. Print the new row's UUID to stdout
5. Exit 0 on success, exit 1 on any failure

### 3.2 Input Validation
```
text = process.argv[2]
if (!text) → stderr "Error: post text required as first argument" → exit 1
if (text.length > 280) → stderr "Error: text is N chars, max 280" → exit 1
```

Note: Twitter counts characters using Unicode code points. For spec simplicity, use `[...text].length` (spread to handle emoji/multi-byte) rather than `.length`.

### 3.3 Supabase Insert

**Endpoint:** `POST {SUPABASE_URL}/rest/v1/social_posts`

**Request headers:**
```
apikey: {DC81_SUPABASE_ANON_KEY}
Authorization: Bearer {DC81_SUPABASE_ANON_KEY}
Content-Type: application/json
Prefer: return=representation
```

**Request body:**
```json
{
  "platform": "x",
  "content": "<text>",
  "media_urls": [],
  "status": "pending_approval",
  "scheduled_for": null
}
```

**Success:** HTTP 201. Parse response JSON array, extract `[0].id`. Print to stdout.

**Failure:** HTTP 4xx/5xx. Print full response body to stderr. Exit 1.

### 3.4 Output
On success, print only the UUID to stdout (no extra text), so callers can capture it cleanly:
```
<uuid>
```

---

## 4. Script: `x-post.js`

**File path:** `/root/.openclaw/workspace-cestra/scripts/x-post.js`  
**Runtime:** Node.js (built-ins only: `https`, `crypto`, `fs`)  
**Invocation:** `node x-post.js <post_id>`

### 4.1 Responsibilities
1. Accept Supabase row UUID as CLI argument (`process.argv[2]`)
2. Fetch the `social_posts` row from Supabase
3. Validate status is `approved` (abort if not)
4. Post content to X v2 API using OAuth 1.0a
5. On success: update row status → `posted`, set `platform_post_id`, set `posted_at`
6. On failure: update row status → `failed`, log error
7. All actions written to JSON-lines log file
8. Rate limit / transient error handling: exponential backoff, max 3 retries

### 4.2 Fetch Post from Supabase

**Endpoint:** `GET {SUPABASE_URL}/rest/v1/social_posts?id=eq.{post_id}&select=*`

**Request headers:**
```
apikey: {DC81_SUPABASE_ANON_KEY}
Authorization: Bearer {DC81_SUPABASE_ANON_KEY}
```

**Success:** HTTP 200, JSON array. Take `[0]`.  
**Validation:**
- If array is empty → log error "post not found", exit 1
- If `row.status !== 'approved'` → log error "post not in approved status (actual: {status})", exit 1
- If `row.platform !== 'x'` → log error "wrong platform: {platform}", exit 1

### 4.3 OAuth 1.0a Signing

X v2 API requires OAuth 1.0a for user-context write operations (posting tweets). Implementation using only Node.js `crypto`.

**Parameters collected for signing:**
```
oauth_consumer_key      = X_CONSUMER_KEY
oauth_nonce             = random 32-char hex string (crypto.randomBytes(16).toString('hex'))
oauth_signature_method  = HMAC-SHA1
oauth_timestamp         = Math.floor(Date.now() / 1000).toString()
oauth_token             = X_ACCESS_TOKEN
oauth_version           = 1.0
```

**Signature Base String construction:**
1. HTTP method: `POST`
2. Base URL: `https://api.x.com/2/tweets` (percent-encoded)
3. Collect all oauth_* parameters (no oauth_signature)
4. Sort parameters alphabetically by key
5. Percent-encode each key and value using RFC 3986 (`encodeURIComponent`)
6. Join as `key=value` pairs with `&`
7. Percent-encode the entire parameter string
8. Concatenate: `POST&{encoded_base_url}&{encoded_param_string}`

**Signing key:** `{percent_encode(X_CONSUMER_SECRET)}&{percent_encode(X_ACCESS_TOKEN_SECRET)}`

**Signature:** `crypto.createHmac('sha1', signingKey).update(baseString).digest('base64')`

**Authorization header:**
```
OAuth oauth_consumer_key="{value}",
      oauth_nonce="{value}",
      oauth_signature="{percent_encoded_signature}",
      oauth_signature_method="HMAC-SHA1",
      oauth_timestamp="{value}",
      oauth_token="{value}",
      oauth_version="1.0"
```
All values in the header must be percent-encoded and double-quoted.

### 4.4 Post to X v2 API

**Endpoint:** `POST https://api.x.com/2/tweets`

**Request headers:**
```
Authorization: OAuth ...  (constructed above)
Content-Type: application/json
```

**Request body:**
```json
{
  "text": "<row.content>"
}
```

**Success:** HTTP 201. Response body: `{ "data": { "id": "...", "text": "..." } }`. Extract `data.id` as `tweet_id`.

**Rate limit / retry logic:**
- HTTP 429 (Too Many Requests): read `x-rate-limit-reset` header (Unix timestamp). Wait until reset + 1s, then retry.
- HTTP 503 / network error: exponential backoff — wait `2^attempt * 1000ms` (attempt 0=1s, 1=2s, 2=4s).
- Max retries: 3. After 3 failures, treat as terminal failure.
- HTTP 4xx (except 429): do NOT retry (client error, permanent). Log and fail immediately.

### 4.5 Update Supabase on Success

**Endpoint:** `PATCH {SUPABASE_URL}/rest/v1/social_posts?id=eq.{post_id}`

**Request headers:**
```
apikey: {DC81_SUPABASE_ANON_KEY}
Authorization: Bearer {DC81_SUPABASE_ANON_KEY}
Content-Type: application/json
```

**Request body:**
```json
{
  "status": "posted",
  "platform_post_id": "<tweet_id>",
  "posted_at": "<ISO 8601 timestamp — new Date().toISOString()>",
  "updated_at": "<ISO 8601 timestamp>"
}
```

**Success:** HTTP 200 or 204. Log success.  
**Failure:** Log PATCH error. Do not retry (tweet was already posted — idempotency concern).

### 4.6 Update Supabase on Failure

**Endpoint:** `PATCH {SUPABASE_URL}/rest/v1/social_posts?id=eq.{post_id}`

**Request body:**
```json
{
  "status": "failed",
  "updated_at": "<ISO 8601 timestamp>"
}
```

Note: No `rejection_reason` field is set on failure — that field is reserved for human rejections. The error detail lives in the log file.

### 4.7 Log Format

**File:** `/root/.openclaw/workspace-cestra/logs/x-post.log`  
**Format:** JSON Lines (one JSON object per line, newline-terminated)

Each log entry:
```json
{
  "timestamp": "2026-03-09T17:59:00.000Z",
  "action": "post_attempt" | "post_success" | "post_failed" | "retry" | "supabase_update" | "validation_error",
  "post_id": "<uuid>",
  "result": "ok" | "error",
  "tweet_id": "<string or null>",
  "attempt": 1,
  "error": "<error message or null>",
  "http_status": 201
}
```

Log append strategy: open file with `fs.appendFileSync`. Do not hold file handle open. Each write is a single `JSON.stringify(entry) + '\n'`.

---

## 5. Approval Workflow

### 5.1 Cestra's Trigger Behaviour (draft-x-post.js post-insert)

After `draft-x-post.js` successfully inserts a row and returns a UUID, Cestra (the agent calling the script) must send a WhatsApp message to Dominic with this exact format:

```
📝 X Post Approval Request

Content: [post text]
Characters: [N]/280
Post ID: [uuid]

Reply:
• APPROVE [post_id] — post immediately
• REJECT [post_id] [reason] — reject with reason
• [edited text] | [post_id] — edit and approve
```

**Note on edit format:** Use `|` as the delimiter between edited text and post_id (since spaces are ambiguous in free text). This must be documented in APPROVAL_HANDLER.md.

### 5.2 APPROVAL_HANDLER.md Updates Required

The following handler logic must be added to Cestra's `APPROVAL_HANDLER.md`. Cestra processes incoming WhatsApp messages from Dominic and pattern-matches:

#### Pattern: `APPROVE <post_id>`
```
1. PATCH social_posts set status="approved", updated_at=now WHERE id=post_id
2. Run: node /root/.openclaw/workspace-cestra/scripts/x-post.js <post_id>
3. On x-post.js exit 0: WhatsApp Dominic "✅ Posted to X. Post ID: <tweet_id>"
4. On x-post.js exit 1: WhatsApp Dominic "❌ Post failed. Check logs."
```

#### Pattern: `REJECT <post_id> <reason>`
```
Parses:
  post_id = second word
  reason  = everything after second word (may contain spaces)

1. PATCH social_posts set status="rejected", rejection_reason=<reason>, updated_at=now WHERE id=post_id
2. WhatsApp Dominic "🚫 Post rejected. Reason logged."
```

#### Pattern: `<edited text> | <post_id>`
```
Parses:
  Split on last occurrence of ' | '
  edited_text = left side (trimmed)
  post_id     = right side (trimmed)

Validation:
  [...edited_text].length <= 280 → error if not

1. PATCH social_posts set content=<edited_text>, status="approved", updated_at=now WHERE id=post_id
2. Run: node /root/.openclaw/workspace-cestra/scripts/x-post.js <post_id>
3. On exit 0: WhatsApp Dominic "✅ Edited post published to X."
4. On exit 1: WhatsApp Dominic "❌ Post failed after edit. Check logs."
```

#### Ambiguity resolution:
- Parse in order: APPROVE → REJECT → edit-with-pipe
- If none match and message contains a UUID-shaped string, treat as unrecognised and do nothing (log only)
- UUID pattern: `[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`

### 5.3 Supabase PATCH for Approval/Rejection (Cestra's calls)

**Endpoint:** `PATCH {SUPABASE_URL}/rest/v1/social_posts?id=eq.{post_id}`

**Headers:** same anon key headers as above

**Approval body:**
```json
{ "status": "approved", "updated_at": "<now ISO>" }
```

**Rejection body:**
```json
{ "status": "rejected", "rejection_reason": "<reason>", "updated_at": "<now ISO>" }
```

**Edit+approve body:**
```json
{ "content": "<edited_text>", "status": "approved", "updated_at": "<now ISO>" }
```

---

## 6. Error Handling & Audit Strategy

### 6.1 Log file
- Path: `/root/.openclaw/workspace-cestra/logs/x-post.log`
- Rotation: not in scope for v1 — log accumulates. Flag for future task if file exceeds 10MB.
- All log writes: `fs.appendFileSync` (sync, safe for single-process script use)

### 6.2 Failure notification
When `x-post.js` exits with code 1 (all retries exhausted), Cestra must WhatsApp Dominic:
```
❌ X Post Failed

Post ID: [uuid]
Error: [last error message from log]
Retries: 3/3 exhausted

Check: /root/.openclaw/workspace-cestra/logs/x-post.log
```

### 6.3 Process exit codes
| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Failure (validation, API error, retries exhausted) |

Scripts must not swallow uncaught exceptions — wrap top-level in try/catch, log, exit 1.

---

## 7. Dependency Map

```
draft-x-post.js
  READS:  /root/.dc81-supabase-credentials
  WRITES: social_posts (INSERT, status=pending_approval)
  OUTPUT: UUID to stdout

x-post.js
  READS:  /root/.x-credentials
  READS:  /root/.dc81-supabase-credentials
  READS:  social_posts (SELECT by id)
  WRITES: social_posts (PATCH status, platform_post_id, posted_at)
  WRITES: /root/.openclaw/workspace-cestra/logs/x-post.log
  CALLS:  https://api.x.com/2/tweets (POST)

Cestra (approval handler)
  READS:  WhatsApp inbound from Dominic
  READS:  /root/.dc81-supabase-credentials
  WRITES: social_posts (PATCH status/rejection_reason/content)
  CALLS:  x-post.js (exec)
  SENDS:  WhatsApp to Dominic (status updates)
```

---

## 8. Explicit Assumptions

1. **Anon key + RLS** — scripts use `DC81_SUPABASE_ANON_KEY`. All operations (INSERT, SELECT, UPDATE/PATCH) rely on RLS policies being correctly configured on `social_posts`. Required policies: INSERT (anon), SELECT (anon), UPDATE (anon). Scripts do not bypass RLS.
2. **`updated_at` is not auto-managed by a trigger** — scripts set it explicitly. If a DB trigger exists that handles `updated_at`, remove those fields from PATCH bodies to avoid conflict.
3. **Single-process execution** — no concurrency; scripts are invoked serially by Cestra. No locking mechanism needed.
4. **X API credentials are for a user context account** — OAuth 1.0a with access token/secret means tweets are posted as the authenticated user, not an app.
5. **WhatsApp approval messages arrive via Cestra's existing WhatsApp inbound handler** — APPROVAL_HANDLER.md is already a live document; this spec adds X-post patterns to it.
6. **`draft-x-post.js` is called by Cestra (or CLI)** — not exposed as an API route.
7. **Log directory exists** — scripts do not create the `/logs/` directory; it is assumed to exist. (Cestra should `mkdir -p` on first run or the directory is pre-created.)

---

## 9. Security Notes

- Credential files must be `chmod 600`, readable only by the process owner
- Scripts must never log credential values
- `DC81_SUPABASE_ANON_KEY` must never be logged or sent in WhatsApp messages
- OAuth signing keys are held in memory only during script execution

---

## 10. Future Extensions (out of scope for v1)

- Media attachment support (`media_urls` field is already in schema — implementation deferred)
- LinkedIn / Instagram / TikTok posting (same `social_posts` table, new scripts)
- Scheduled posting (use `scheduled_for` column with a cron job calling `x-post.js`)
- Log rotation
- Dashboard UI for post management

---

## GRAPH_UPDATE

```
---GRAPH_UPDATE_START---
ENTITIES:
- TYPE: Script | NAME: x-post.js | file_path: scripts/x-post.js | script_type: posting | description: Posts approved X/Twitter content via v2 API with OAuth 1.0a signing; updates social_posts on success/failure; retries with backoff; logs to x-post.log
- TYPE: Script | NAME: draft-x-post.js | file_path: scripts/draft-x-post.js | script_type: drafting | description: Creates pending_approval draft row in Supabase social_posts; validates 280-char limit; outputs UUID to stdout
- TYPE: Decision | NAME: OAuth 1.0a for X API signing | rationale: Required by X v2 API for user-context write actions (posting tweets); OAuth 2.0 bearer token is read-only | alternatives_considered: OAuth 2.0 bearer (read-only, cannot post) | status: active
- TYPE: Decision | NAME: No external npm dependencies in scripts | rationale: Reduces operational risk, no package management needed on VPS, Node.js built-ins sufficient for HTTPS, crypto, and file I/O | alternatives_considered: axios (HTTP), oauth-1.0a (signing) | status: active
- TYPE: Decision | NAME: Pipe delimiter for edit-approve command | rationale: Free-text post content may contain spaces; a pipe character is unlikely in post text and provides unambiguous split point | alternatives_considered: positional last-word UUID parsing (fragile), special prefix keyword (verbose) | status: active

RELATIONSHIPS:
- SOURCE_TYPE: Script | SOURCE: x-post.js | REL: READS_FROM | TARGET_TYPE: DBTable | TARGET: social_posts
- SOURCE_TYPE: Script | SOURCE: x-post.js | REL: WRITES_TO | TARGET_TYPE: DBTable | TARGET: social_posts
- SOURCE_TYPE: Script | SOURCE: draft-x-post.js | REL: WRITES_TO | TARGET_TYPE: DBTable | TARGET: social_posts

DECISIONS:
- TITLE: OAuth 1.0a for X API signing | RATIONALE: Required by X v2 API for user-context actions (posting tweets). OAuth 2.0 bearer token is read-only and cannot post. | ALTERNATIVES: OAuth 2.0 bearer (read-only only)
- TITLE: No external npm dependencies | RATIONALE: Node.js built-ins (https, crypto, fs) are sufficient. Avoids npm install step, reduces attack surface on VPS. | ALTERNATIVES: axios for HTTP, oauth-1.0a package for signing
- TITLE: Pipe delimiter for edit-approve pattern | RATIONALE: Post text is free-form and may contain spaces; pipe is unambiguous split point unlikely to appear in post content. | ALTERNATIVES: Last-word UUID detection (fragile), keyword prefix (verbose)
---GRAPH_UPDATE_END---
```
