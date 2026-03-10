#!/usr/bin/env python3

import argparse
import json
import re
import sys
import tempfile
import os
import shutil
import subprocess
import urllib.request
import urllib.error
from datetime import datetime

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

TEMPLATES = {
    "blog-share-card":   "kg28h3a41d7042b3j6w4r0zsbs82ja07",
    "tip-insight-card":  "kg210708fnc038gzmyd5dctydx82kyxy",
    "stat-fact-card":    "kg29dm1fkfddv04x5h63zj3dj182k6bw",
    "announcement-card": "kg21t0g2rt6m6twxdhqrafcskn82kat0",
    "quote-share-card":  "kg2fm0743grdxb5mgqqjp82pzx82k587",
}

def substitute(svg, vars_dict):
    def replacer(match):
        key = match.group(1)
        return vars_dict.get(key, "")
    return re.sub(r'\{\{([A-Z0-9_]+)\}\}', replacer, svg)

def main():
    parser = argparse.ArgumentParser(description='Render SVG card to PNG and upload to Supabase')
    parser.add_argument('--template', required=True, help='Template name')
    parser.add_argument('--vars', required=True, help='JSON object string of placeholder values')
    parser.add_argument('--slug', required=True, help='Slug string for filename')
    parser.add_argument('--date', help='Date in YYYY-MM-DD format')

    args = parser.parse_args()

    # Validate template
    if args.template not in TEMPLATES:
        valid = ', '.join(TEMPLATES.keys())
        sys.stderr.write(f"Error: unknown template '{args.template}'. Valid templates: {valid}\n")
        sys.exit(1)

    # Validate vars JSON
    try:
        vars_dict = json.loads(args.vars)
    except json.JSONDecodeError as e:
        sys.stderr.write(f"Error: --vars is not valid JSON: {e}\n")
        sys.exit(1)

    # Validate slug
    slug = args.slug.strip()
    if not slug:
        sys.stderr.write("Error: --slug must not be empty\n")
        sys.exit(1)

    # Validate date
    if args.date:
        try:
            datetime.strptime(args.date, '%Y-%m-%d')
        except ValueError:
            sys.stderr.write("Error: --date must be YYYY-MM-DD format\n")
            sys.exit(1)
    else:
        args.date = datetime.today().strftime('%Y-%m-%d')

    # Parse creds
    try:
        creds = parse_cred_file('/root/.dc81-supabase-credentials')
        supabase_url = creds['DC81_SUPABASE_URL'].rstrip('/')
        supabase_key = creds['DC81_SUPABASE_ANON_KEY']
    except KeyError as e:
        sys.stderr.write(f"Error: missing required credential: {e.args[0]}\n")
        sys.exit(1)
    except FileNotFoundError:
        sys.stderr.write("Error: credential file not found: /root/.dc81-supabase-credentials\n")
        sys.exit(1)

    tmp_dir = None
    try:
        # Fetch signed URL from Convex
        convex_url = "https://exciting-warbler-274.eu-west-1.convex.cloud/api/query"
        payload = json.dumps({"path": "getFileUrl", "args": {"storageId": TEMPLATES[args.template]}}).encode()
        req = urllib.request.Request(convex_url, data=payload, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                body = json.loads(resp.read())
                signed_url = body.get("value")
                if not signed_url:
                    sys.stderr.write(f"Convex returned no URL for storageId {TEMPLATES[args.template]}\n")
                    sys.exit(1)
        except urllib.error.HTTPError as e:
            sys.stderr.write(f"Convex fetch failed: HTTP {e.code} {e.reason}\n")
            sys.exit(1)
        except urllib.error.URLError as e:
            sys.stderr.write(f"Convex fetch failed: {e.reason}\n")
            sys.exit(1)
        except json.JSONDecodeError as e:
            sys.stderr.write(f"Convex fetch failed: invalid JSON response: {e}\n")
            sys.exit(1)

        # Fetch SVG
        try:
            with urllib.request.urlopen(signed_url, timeout=15) as resp:
                svg_content = resp.read().decode('utf-8')
        except urllib.error.HTTPError as e:
            sys.stderr.write(f"SVG fetch failed: HTTP {e.code} {e.reason}\n")
            sys.exit(1)
        except urllib.error.URLError as e:
            sys.stderr.write(f"SVG fetch failed: {e.reason}\n")
            sys.exit(1)

        # Substitute
        substituted_svg = substitute(svg_content, vars_dict)

        tmp_dir = tempfile.mkdtemp()
        tmp_svg = os.path.join(tmp_dir, "card.svg")
        tmp_png = os.path.join(tmp_dir, "card.png")

        with open(tmp_svg, 'w', encoding='utf-8') as f:
            f.write(substituted_svg)

        # Render PNG
        try:
            result = subprocess.run(
                ["rsvg-convert", "-w", "1200", "-h", "630", "-f", "png", "-o", tmp_png, tmp_svg],
                capture_output=True
            )
            if result.returncode != 0:
                sys.stderr.write(f"rsvg-convert failed (exit {result.returncode}):\n")
                sys.stderr.write(result.stderr.decode('utf-8', errors='replace'))
                sys.exit(1)
        except FileNotFoundError:
            sys.stderr.write("rsvg-convert not found on PATH\n")
            sys.exit(1)

        # Construct filename
        filename = f"{args.template}-{args.date}-{slug}.png"

        # Upload to Supabase
        upload_url = f"{supabase_url}/storage/v1/object/social-media-assets/{filename}"
        try:
            with open(tmp_png, 'rb') as f:
                png_bytes = f.read()
            upload_req = urllib.request.Request(
                upload_url,
                data=png_bytes,
                headers={
                    "Authorization": f"Bearer {supabase_key}",
                    "Content-Type": "image/png",
                },
                method="POST"
            )
            with urllib.request.urlopen(upload_req, timeout=30) as resp:
                _ = resp.read()  # consume
        except urllib.error.HTTPError as e:
            body = e.read().decode('utf-8', errors='replace')
            sys.stderr.write(f"Supabase upload failed: HTTP {e.code} {e.reason}\n{body}\n")
            sys.exit(1)
        except urllib.error.URLError as e:
            sys.stderr.write(f"Supabase upload failed: {e.reason}\n")
            sys.exit(1)

        # Print URL
        public_url = f"{supabase_url}/storage/v1/object/public/social-media-assets/{filename}"
        print(public_url)
        sys.exit(0)

    finally:
        if tmp_dir:
            shutil.rmtree(tmp_dir, ignore_errors=True)

if __name__ == "__main__":
    main()