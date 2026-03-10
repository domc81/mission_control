# RENDER_CARD_SPEC.md — SVG Card Renderer

**Author:** Architect  
**Date:** 2026-03-09  
**Status:** Final  
**Task ID:** jx70ncjw0180n7553mzxszarfs82j72j  

---

## 1. Overview

`render-card.py` is a Python 3 stdlib-only script that:
1. Maps a template name to a Convex storage ID
2. Fetches the SVG template via a Convex-signed URL
3. Substitutes `{{PLACEHOLDER}}` values
4. Renders to PNG via `rsvg-convert`
5. Uploads the PNG to Supabase storage
6. Prints the public URL to stdout

No third-party packages. No side effects beyond the uploaded file.

---

## 2. File Layout

```
/root/.openclaw/workspace-cestra/scripts/render-card.py
```

---

## 3. Credentials

**File:** `/root/.dc81-supabase-credentials`  
**Format:** `KEY=VALUE` lines (env-style, no quotes, no `export`)

Required keys:
```
DC81_SUPABASE_URL=https://api-dc81.dc81.io
DC81_SUPABASE_ANON_KEY=<value>
```

**Parsing function (inline in script):**
```python
def parse_cred_file(path):
    creds = {}
    with open(path, 'r') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            key, _, value = line.partition('=')
            creds[key.strip()] = value.strip()
    return creds
```

Called once at startup. Fatal exit if file is missing or required keys absent.

---

## 4. Template Registry

Hardcoded dict in script. Keys are the `--template` argument values.

```python
TEMPLATES = {
    "blog-share-card":     "kg28h3a41d7042b3j6w4r0zsbs82ja07",
    "tip-insight-card":    "kg210708fnc038gzmyd5dctydx82kyxy",
    "stat-fact-card":      "kg29dm1fkfddv04x5h63zj3dj182k6bw",
    "announcement-card":   "kg21t0g2rt6m6twxdhqrafcskn82kat0",
    "quote-share-card":    "kg2fm0743grdxb5mgqqjp82pzx82k587",
}
```

If `--template` value is not in `TEMPLATES`: print usage error to stderr, exit 1.

---

## 5. CLI Argument Parsing

Use `argparse` (stdlib).

```
python3 render-card.py \
  --template <template-name> \
  --vars '<json-object>' \
  --slug <slug-string> \
  [--date YYYY-MM-DD]
```

| Argument | Required | Type | Description |
|----------|----------|------|-------------|
| `--template` | Yes | str | Template name key (must exist in TEMPLATES dict) |
| `--vars` | Yes | str | JSON object string of placeholder values |
| `--slug` | Yes | str | Used in output filename |
| `--date` | No | str | YYYY-MM-DD format; defaults to `date.today().isoformat()` |

**Validation:**
- `--template`: must be in `TEMPLATES` dict → else stderr + exit 1
- `--vars`: must parse as valid JSON object → else stderr + exit 1
- `--slug`: must be non-empty, strip whitespace → else stderr + exit 1
- `--date`: if provided, validate with `datetime.strptime(val, '%Y-%m-%d')` → else stderr + exit 1

---

## 6. Step-by-Step Execution

### Step 1 — Resolve Convex storage ID
```python
storage_id = TEMPLATES[args.template]
```

### Step 2 — Fetch signed URL from Convex

**Endpoint:** `POST https://exciting-warbler-274.eu-west-1.convex.cloud/api/query`

**Request:**
```
Method:  POST
Headers: Content-Type: application/json
Body:    {"path": "getFileUrl", "args": {"storageId": "<storage_id>"}}
```

**Implementation (urllib):**
```python
import urllib.request, json

convex_url = "https://exciting-warbler-274.eu-west-1.convex.cloud/api/query"
payload = json.dumps({"path": "getFileUrl", "args": {"storageId": storage_id}}).encode()
req = urllib.request.Request(convex_url, data=payload, headers={"Content-Type": "application/json"})
with urllib.request.urlopen(req, timeout=15) as resp:
    body = json.loads(resp.read())
signed_url = body["value"]
```

**Error handling:**
- `urllib.error.HTTPError` or `urllib.error.URLError` → stderr: `"Convex fetch failed: {e}"` → exit 1
- `body["value"]` missing or None → stderr: `"Convex returned no URL for storageId {storage_id}"` → exit 1

### Step 3 — Fetch SVG content

```python
with urllib.request.urlopen(signed_url, timeout=15) as resp:
    svg_content = resp.read().decode('utf-8')
```

**Error handling:**
- Any exception → stderr: `"SVG fetch failed: {e}"` → exit 1

### Step 4 — Substitute placeholders

```python
import re

vars_dict = json.loads(args.vars)  # already validated in arg parsing

def substitute(svg, vars_dict):
    def replacer(match):
        key = match.group(1)
        return vars_dict.get(key, "")   # missing keys → empty string
    return re.sub(r'\{\{([A-Z0-9_]+)\}\}', replacer, svg)

substituted_svg = substitute(svg_content, vars_dict)
```

**Regex pattern:** `\{\{([A-Z0-9_]+)\}\}` — matches uppercase alphanumeric + underscore placeholders only.

**Behaviour:** Every `{{KEY}}` in the SVG is replaced. Keys present in SVG but absent from `--vars` → replaced with `""` (empty string). No `{{...}}` tokens remain in the output SVG under any circumstances.

### Step 5 — Write substituted SVG to temp file

```python
import tempfile, os

tmp_dir = tempfile.mkdtemp()
tmp_svg = os.path.join(tmp_dir, "card.svg")
tmp_png = os.path.join(tmp_dir, "card.png")

with open(tmp_svg, 'w', encoding='utf-8') as f:
    f.write(substituted_svg)
```

Temp directory is created once. Both `tmp_svg` and `tmp_png` live in it.  
Cleanup: `shutil.rmtree(tmp_dir, ignore_errors=True)` in `finally` block (see §8).

### Step 6 — Render PNG via rsvg-convert

```python
import subprocess

result = subprocess.run(
    ["rsvg-convert", "-w", "1200", "-h", "630", "-f", "png", "-o", tmp_png, tmp_svg],
    capture_output=True
)
if result.returncode != 0:
    sys.stderr.write(f"rsvg-convert failed (exit {result.returncode}):\n")
    sys.stderr.write(result.stderr.decode('utf-8', errors='replace'))
    sys.exit(1)
```

**Output:** `tmp_png` is a 1200×630 PNG file.

**Error handling:**
- Non-zero exit code → stderr includes rsvg's own stderr output → exit 1
- `FileNotFoundError` (rsvg-convert not on PATH) → stderr: `"rsvg-convert not found on PATH"` → exit 1

### Step 7 — Construct filename and upload to Supabase

**Filename pattern:**
```python
filename = f"{args.template}-{args.date}-{args.slug}.png"
# Example: announcement-card-2026-03-09-dc81-launch.png
```

**Upload endpoint:**
```
POST {DC81_SUPABASE_URL}/storage/v1/object/social-media-assets/{filename}
```

**Implementation:**
```python
upload_url = f"{creds['DC81_SUPABASE_URL']}/storage/v1/object/social-media-assets/{filename}"

with open(tmp_png, 'rb') as f:
    png_bytes = f.read()

upload_req = urllib.request.Request(
    upload_url,
    data=png_bytes,
    headers={
        "Authorization": f"Bearer {creds['DC81_SUPABASE_ANON_KEY']}",
        "Content-Type": "image/png",
    },
    method="POST"
)
with urllib.request.urlopen(upload_req, timeout=30) as resp:
    _ = resp.read()   # consume response body
```

**Error handling:**
- `urllib.error.HTTPError` → stderr: `"Supabase upload failed: HTTP {e.code} {e.reason}\n{e.read().decode()}"` → exit 1
- `urllib.error.URLError` → stderr: `"Supabase upload failed: {e.reason}"` → exit 1

**Note on duplicate filenames:** If a file with the same name already exists in the bucket, Supabase will return 400. If upsert behaviour is needed in future, add `x-upsert: true` header. Out of scope for v1 — filename includes date and slug, collisions should be rare.

### Step 8 — Print public URL and exit

**Public URL pattern:**
```python
public_url = f"{creds['DC81_SUPABASE_URL']}/storage/v1/object/public/social-media-assets/{filename}"
print(public_url)
sys.exit(0)
```

Output to stdout is the URL only — no extra text — so callers can capture it cleanly.

---

## 7. Temp File Cleanup

All temp file operations are wrapped in try/finally:

```python
import shutil

tmp_dir = None
try:
    tmp_dir = tempfile.mkdtemp()
    # ... all steps ...
finally:
    if tmp_dir:
        shutil.rmtree(tmp_dir, ignore_errors=True)
```

Cleanup runs on both success and failure paths. `ignore_errors=True` ensures cleanup never masks the real error.

---

## 8. Full Control Flow

```
parse args
  → validate template, vars JSON, slug, date
  → exit 1 on any validation failure

parse_cred_file('/root/.dc81-supabase-credentials')
  → exit 1 if file missing or keys absent

tmp_dir = tempfile.mkdtemp()
try:
  fetch_signed_url(storage_id)        → exit 1 on failure
  fetch_svg(signed_url)               → exit 1 on failure
  substituted = substitute(svg, vars) → always succeeds (missing keys → "")
  write substituted_svg to tmp_svg
  rsvg-convert tmp_svg → tmp_png      → exit 1 on failure
  upload tmp_png to Supabase          → exit 1 on failure
  print public_url
  exit 0
finally:
  shutil.rmtree(tmp_dir, ignore_errors=True)
```

---

## 9. Error Output Standards

All errors go to stderr. Format: one-line summary + detail where available.

| Failure point | stderr message |
|---|---|
| Unknown template | `Error: unknown template '{name}'. Valid templates: blog-share-card, tip-insight-card, stat-fact-card, announcement-card, quote-share-card` |
| Invalid --vars JSON | `Error: --vars is not valid JSON: {parse_error}` |
| Empty --slug | `Error: --slug must not be empty` |
| Invalid --date | `Error: --date must be YYYY-MM-DD format` |
| Missing cred file | `Error: credential file not found: /root/.dc81-supabase-credentials` |
| Missing cred key | `Error: missing required credential: {key}` |
| Convex HTTP error | `Convex fetch failed: HTTP {code} {reason}` |
| Convex URL missing | `Convex returned no URL for storageId {id}` |
| SVG fetch error | `SVG fetch failed: {e}` |
| rsvg-convert not found | `rsvg-convert not found on PATH` |
| rsvg-convert non-zero | `rsvg-convert failed (exit {N}):\n{rsvg stderr}` |
| Supabase HTTP error | `Supabase upload failed: HTTP {code} {reason}\n{body}` |
| Supabase URL error | `Supabase upload failed: {reason}` |

---

## 10. Security Constraints

- Credential values must never appear in stderr output, stdout, or log lines
- `DC81_SUPABASE_ANON_KEY` is used only in the `Authorization` header; never concatenated into error messages
- Temp files contain only SVG/PNG data — no credentials
- Temp directory is cleaned up in `finally` regardless of exit path

---

## 11. Dependency Map

```
render-card.py
  READS:   /root/.dc81-supabase-credentials
  CALLS:   https://exciting-warbler-274.eu-west-1.convex.cloud/api/query (getFileUrl)
  FETCHES: Convex-signed SVG URL (ephemeral)
  EXECS:   rsvg-convert (subprocess)
  WRITES:  Supabase storage bucket: social-media-assets/{filename}
  OUTPUT:  public URL to stdout
```

---

## 12. Explicit Assumptions

1. **`rsvg-convert` is on PATH** at `/usr/bin/rsvg-convert` or equivalent. Script uses `rsvg-convert` without absolute path — if PATH is restricted in the calling environment, the invoker must ensure it's reachable.
2. **Convex `getFileUrl` returns a `value` key** at the top level of the JSON response. If the Convex response schema changes (e.g., `result.value`), the fetch logic must be updated.
3. **Supabase `social-media-assets` bucket is public** — the public URL pattern works without authentication. If the bucket is private, the public URL will 403 and a signed URL will be needed instead.
4. **`DC81_SUPABASE_URL` does not have a trailing slash** — the script constructs paths with a leading `/`. If the credential value has a trailing slash, double-slash in URLs will occur.
5. **Placeholder syntax is strictly `{{UPPER_CASE}}`** — the regex `\{\{([A-Z0-9_]+)\}\}` only matches uppercase. If templates ever use lowercase placeholders, the regex must be updated.
6. **SVG content is UTF-8** — fetched SVG is decoded as UTF-8. If templates use a different encoding, decoding will fail.
7. **No retry logic** — each network call is single-attempt. Transient failures require re-invocation. Retry logic is out of scope for v1.
8. **`--slug` is caller-sanitised** — the script does not sanitise slug for URL safety. Caller (Cestra) is responsible for providing a slug with no spaces or special characters. The script only checks non-empty.

---

## 13. Example Invocations

```bash
# Announcement card
python3 render-card.py \
  --template announcement-card \
  --vars '{"HEADLINE_LINE_1":"DC81 is live","HEADLINE_LINE_2":"","SUBTEXT_LINE_1":"AI agents for small business","SUBTEXT_LINE_2":"dc81.io"}' \
  --slug dc81-launch \
  --date 2026-03-09

# Blog share card
python3 render-card.py \
  --template blog-share-card \
  --vars '{"CATEGORY":"AI","CATEGORY_WIDTH":"60","TITLE_LINE_1":"How we built","TITLE_LINE_2":"an autonomous","TITLE_LINE_3":"agent squad","DATE":"9 Mar 2026","READ_TIME":"5 min read"}' \
  --slug autonomous-agent-squad

# Quote card (no date needed in vars, script handles --date default)
python3 render-card.py \
  --template quote-share-card \
  --vars '{"QUOTE_LINE_1":"Move fast,","QUOTE_LINE_2":"break nothing,","QUOTE_LINE_3":"automate","QUOTE_LINE_4":"everything.","AUTHOR":"Dominic Clauzel","SOURCE":"DC81"}' \
  --slug dc81-quote-01
```

Expected stdout (one line):
```
https://api-dc81.dc81.io/storage/v1/object/public/social-media-assets/announcement-card-2026-03-09-dc81-launch.png
```

---

## GRAPH_UPDATE

```
---GRAPH_UPDATE_START---
ENTITIES:
- TYPE: Script | NAME: render-card.py | file_path: scripts/render-card.py | script_type: rendering | description: Fetches SVG template from Convex, substitutes placeholders, renders to PNG via rsvg-convert, uploads to Supabase storage, returns public URL
- TYPE: Decision | NAME: stdlib-only Python for render-card.py | rationale: No npm/pip install step required on VPS; urllib + subprocess + tempfile cover all needs | alternatives_considered: requests (HTTP), Pillow (image processing), cairosvg (SVG render) | status: active
- TYPE: Decision | NAME: rsvg-convert subprocess for SVG-to-PNG | rationale: Already installed on VPS (v2.58.0), high-fidelity SVG rendering, no Python deps | alternatives_considered: cairosvg Python package (pip dep), Inkscape CLI (heavier) | status: active
- TYPE: Decision | NAME: Missing placeholder → empty string | rationale: Prevents broken {{...}} tokens appearing in rendered output; caller is responsible for providing all values; graceful degradation preferred over hard failure | alternatives_considered: Fail on missing placeholder (strict mode), warn but continue | status: active

RELATIONSHIPS:
- SOURCE_TYPE: Script | SOURCE: render-card.py | REL: READS_FROM | TARGET_TYPE: DBTable | TARGET: social_posts
- SOURCE_TYPE: Script | SOURCE: render-card.py | REL: CALLS | TARGET_TYPE: APIRoute | TARGET: getFileUrl

DECISIONS:
- TITLE: stdlib-only Python | RATIONALE: No pip install required on VPS; urllib/subprocess/tempfile fully sufficient. | ALTERNATIVES: requests, cairosvg, Pillow
- TITLE: rsvg-convert for SVG-to-PNG | RATIONALE: Already installed v2.58.0, no Python package dep, high-fidelity rendering. | ALTERNATIVES: cairosvg (pip), Inkscape CLI
- TITLE: Missing placeholder → empty string | RATIONALE: Graceful degradation; no broken tokens in output; caller controls var completeness. | ALTERNATIVES: Strict failure on missing key
---GRAPH_UPDATE_END---
```
