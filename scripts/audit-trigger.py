#!/usr/bin/env python3
"""
audit-trigger.py — DC81 Audit Pipeline
Runs every minute via cron.

Pipeline:
  1. Query dc81_leads WHERE pipeline_stage = 'new' AND service_category = 'Free Digital Audit'
  2. For each new lead:
     a. Create audit_jobs row (status=queued)
     b. Run audit checks (PageSpeed, SSL, robots, sitemap, schema, social)
     c. Write audit_reports row with access_token
     d. Send email to lead with report link
     e. Update lead pipeline_stage = 'audit_sent'
     f. Update audit_jobs status = 'complete'

Report URL: https://dc81.io/audit-report?token=<access_token>
(The audit-report page is built in Phase 5 — for now the link shows raw JSON)
"""

import sys
import os
import json
import logging
import uuid
import asyncio
import httpx
import requests
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
LOG_DIR = Path("/root/.openclaw/workspace-cestra/logs")
LOG_DIR.mkdir(parents=True, exist_ok=True)
LOG_FILE = LOG_DIR / "audit-trigger.log"

logging.basicConfig(
    filename=str(LOG_FILE),
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%SZ",
)
log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Credentials
# ---------------------------------------------------------------------------
def load_credentials() -> dict:
    creds = {}
    for path in ["/root/.dc81-supabase-credentials", "/root/.dc81-audit-credentials"]:
        if os.path.exists(path):
            with open(path) as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        creds[k.strip()] = v.strip()
    return creds


# ---------------------------------------------------------------------------
# Supabase helpers
# ---------------------------------------------------------------------------
def sb_headers(creds: dict, use_service_role: bool = True) -> dict:
    key = creds["DC81_SUPABASE_SERVICE_ROLE_KEY"] if use_service_role else creds["DC81_SUPABASE_ANON_KEY"]
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }


def sb_get(creds: dict, path: str, params: str = "") -> list:
    url = f"{creds['DC81_SUPABASE_URL']}/rest/v1/{path}"
    if params:
        url += f"?{params}"
    r = requests.get(url, headers=sb_headers(creds), timeout=15)
    r.raise_for_status()
    return r.json()


def sb_post(creds: dict, path: str, data: dict) -> dict:
    r = requests.post(
        f"{creds['DC81_SUPABASE_URL']}/rest/v1/{path}",
        headers={**sb_headers(creds), "Prefer": "return=representation"},
        json=data,
        timeout=15,
    )
    r.raise_for_status()
    result = r.json()
    return result[0] if isinstance(result, list) else result


def sb_patch(creds: dict, path: str, match: str, data: dict) -> None:
    r = requests.patch(
        f"{creds['DC81_SUPABASE_URL']}/rest/v1/{path}?{match}",
        headers=sb_headers(creds),
        json=data,
        timeout=15,
    )
    r.raise_for_status()


# ---------------------------------------------------------------------------
# Audit checks (synchronous wrappers around async logic)
# ---------------------------------------------------------------------------
def rag(score: float, amber: float = 50.0, green: float = 80.0) -> str:
    if score >= green:
        return "green"
    elif score >= amber:
        return "amber"
    return "red"


async def check_pagespeed(url: str, api_key: str, strategy: str = "mobile") -> dict:
    params = {
        "url": url,
        "strategy": strategy.upper(),
        "key": api_key,
        "fields": "lighthouseResult.categories",
    }
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(
                "https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed",
                params=params,
            )
            if r.status_code == 200:
                cats = r.json().get("lighthouseResult", {}).get("categories", {})
                perf = (cats.get("performance", {}).get("score") or 0) * 100
                seo_s = (cats.get("seo", {}).get("score") or 0) * 100
                acc = (cats.get("accessibility", {}).get("score") or 0) * 100
                bp = (cats.get("best-practices", {}).get("score") or 0) * 100
                avg = (perf + seo_s + acc + bp) / 4
                return {
                    "section": "performance",
                    "label": f"PageSpeed {strategy}",
                    "status": rag(avg, 50, 75),
                    "value": round(avg, 1),
                    "message": f"{strategy.capitalize()}: Performance {perf:.0f}, SEO {seo_s:.0f}, Accessibility {acc:.0f}",
                }
            return {"section": "performance", "label": f"PageSpeed {strategy}", "status": "red", "value": 0, "message": f"API error {r.status_code}"}
    except Exception as e:
        return {"section": "performance", "label": f"PageSpeed {strategy}", "status": "red", "value": 0, "message": str(e)[:100]}


async def check_ssl(url: str) -> dict:
    https_url = url if url.startswith("https://") else url.replace("http://", "https://")
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
            r = await client.get(https_url)
            if str(r.url).startswith("https://") and r.status_code < 400:
                return {"section": "technical", "label": "SSL/HTTPS", "status": "green", "value": True, "message": "HTTPS valid and accessible"}
            return {"section": "technical", "label": "SSL/HTTPS", "status": "red", "value": False, "message": "HTTPS not accessible"}
    except Exception as e:
        return {"section": "technical", "label": "SSL/HTTPS", "status": "red", "value": False, "message": str(e)[:100]}


async def check_robots(url: str) -> dict:
    base = url.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{base}/robots.txt")
            if r.status_code == 200:
                return {"section": "technical", "label": "robots.txt", "status": "green", "value": True, "message": "robots.txt found"}
            return {"section": "technical", "label": "robots.txt", "status": "amber", "value": False, "message": "robots.txt missing"}
    except Exception as e:
        return {"section": "technical", "label": "robots.txt", "status": "red", "value": False, "message": str(e)[:100]}


async def check_sitemap(url: str) -> dict:
    base = url.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{base}/sitemap.xml")
            if r.status_code == 200:
                count = r.text.count("<loc>")
                return {"section": "technical", "label": "Sitemap", "status": "green", "value": count, "message": f"sitemap.xml found ({count} URLs)"}
            return {"section": "technical", "label": "Sitemap", "status": "amber", "value": 0, "message": "sitemap.xml missing"}
    except Exception as e:
        return {"section": "technical", "label": "Sitemap", "status": "red", "value": 0, "message": str(e)[:100]}


async def check_schema_markup(url: str) -> dict:
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            r = await client.get(url)
            has_schema = "application/ld+json" in r.text
            has_local = "LocalBusiness" in r.text or "Organization" in r.text
            if has_local:
                return {"section": "technical", "label": "Structured Data", "status": "green", "value": True, "message": "Schema markup found (LocalBusiness/Organization)"}
            elif has_schema:
                return {"section": "technical", "label": "Structured Data", "status": "amber", "value": True, "message": "Schema markup found (no LocalBusiness type)"}
            return {"section": "technical", "label": "Structured Data", "status": "red", "value": False, "message": "No schema markup found"}
    except Exception as e:
        return {"section": "technical", "label": "Structured Data", "status": "red", "value": False, "message": str(e)[:100]}


async def check_mobile(url: str) -> dict:
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            r = await client.get(url, headers={"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15"})
            has_viewport = "viewport" in r.text
            if has_viewport and r.status_code < 400:
                return {"section": "technical", "label": "Mobile Ready", "status": "green", "value": True, "message": "Mobile viewport meta tag found"}
            return {"section": "technical", "label": "Mobile Ready", "status": "red", "value": False, "message": "No mobile viewport meta tag"}
    except Exception as e:
        return {"section": "technical", "label": "Mobile Ready", "status": "red", "value": False, "message": str(e)[:100]}


async def check_social_profiles(social_handles: dict) -> dict:
    platform_urls = {
        "linkedin": f"https://www.linkedin.com/company/{social_handles.get('linkedin', '')}",
        "instagram": f"https://www.instagram.com/{social_handles.get('instagram', '').lstrip('@')}",
        "facebook": f"https://www.facebook.com/{social_handles.get('facebook', '')}",
        "x": f"https://x.com/{social_handles.get('x', '').lstrip('@')}",
    }
    found = 0
    total = 0
    details = []
    async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
        for platform, url in platform_urls.items():
            handle = social_handles.get(platform, "")
            if not handle:
                continue
            total += 1
            try:
                r = await client.head(url)
                if r.status_code < 400:
                    found += 1
                    details.append(f"{platform}: ✓")
                else:
                    details.append(f"{platform}: ✗ ({r.status_code})")
            except Exception:
                details.append(f"{platform}: ✗ (error)")

    if total == 0:
        return {"section": "social", "label": "Social Profiles", "status": "amber", "value": 0, "message": "No social handles provided"}
    pct = (found / total) * 100
    return {
        "section": "social",
        "label": "Social Profiles",
        "status": rag(pct, 25, 75),
        "value": round(pct, 0),
        "message": f"{found}/{total} profiles accessible: {', '.join(details)}",
    }


async def run_audit(lead: dict, api_key_pagespeed: str) -> dict:
    """Run all audit checks and return structured report data."""
    url = lead.get("website_url", "")
    social = lead.get("social_handles") or {}

    results = await asyncio.gather(
        check_pagespeed(url, api_key_pagespeed, "mobile"),
        check_pagespeed(url, api_key_pagespeed, "desktop"),
        check_ssl(url),
        check_robots(url),
        check_sitemap(url),
        check_schema_markup(url),
        check_mobile(url),
        check_social_profiles(social),
        return_exceptions=True,
    )

    checks = []
    for r in results:
        if isinstance(r, Exception):
            checks.append({"section": "technical", "label": "Check", "status": "red", "value": 0, "message": str(r)[:100]})
        else:
            checks.append(r)

    # Section scores
    section_map: dict[str, list] = {}
    for c in checks:
        section_map.setdefault(c["section"], []).append(c)

    section_scores = {}
    for section, items in section_map.items():
        score_vals = [{"green": 100, "amber": 50, "red": 0}[i["status"]] for i in items]
        section_scores[section] = sum(score_vals) / len(score_vals)

    overall = (
        section_scores.get("technical", 0) * 0.40 +
        section_scores.get("performance", 0) * 0.35 +
        section_scores.get("social", 0) * 0.25
    )

    # Top issues (reds first, then ambers)
    issues = sorted(
        [c for c in checks if c["status"] in ("red", "amber")],
        key=lambda x: (0 if x["status"] == "red" else 1),
    )[:5]

    return {
        "domain": urlparse(url).netloc or url,
        "scanned_at": datetime.now(timezone.utc).isoformat(),
        "overall_score": round(overall),
        "overall_rag": rag(overall, 50, 75),
        "sections": {
            section: {
                "score": round(score),
                "rag": rag(score, 50, 75),
                "checks": [c for c in checks if c["section"] == section],
            }
            for section, score in section_scores.items()
        },
        "top_issues": issues,
        "lead": {
            "name": lead.get("name", ""),
            "company": lead.get("company_name", ""),
            "location": lead.get("audit_location", ""),
            "keywords": lead.get("audit_keywords", []),
            "gbp_name": lead.get("audit_gbp_name", ""),
        },
    }


# ---------------------------------------------------------------------------
# Email
# ---------------------------------------------------------------------------
def send_report_email(creds: dict, lead: dict, report_url: str, overall_score: int, overall_rag: str) -> None:
    api_key = creds["RESEND_API_KEY"]
    name = lead.get("name", "there").split()[0]
    company = lead.get("company_name", "your business")
    domain = lead.get("website_url", "your website")

    rag_colour = {"green": "#22c55e", "amber": "#f59e0b", "red": "#ef4444"}.get(overall_rag, "#6b7280")
    rag_label = {"green": "Good", "amber": "Needs attention", "red": "Action required"}.get(overall_rag, "")

    html = f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0e1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0e1a;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#111827;border:1px solid #1f2937;border-radius:12px;overflow:hidden;max-width:600px;width:100%;">
        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#00d4ff20,#7c3aed20);padding:32px 40px;border-bottom:1px solid #1f2937;">
            <p style="margin:0 0 4px;font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:0.1em;">DC81 Ltd</p>
            <h1 style="margin:0;font-size:24px;font-weight:700;color:#f9fafb;">Your free digital audit is ready</h1>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px 40px;">
            <p style="margin:0 0 24px;color:#d1d5db;font-size:15px;line-height:1.6;">
              Hi {name},<br><br>
              We've completed your free digital presence audit for <strong style="color:#f9fafb;">{company}</strong>.
              Here's a quick summary of what we found.
            </p>

            <!-- Score card -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#1f2937;border-radius:10px;margin-bottom:28px;">
              <tr>
                <td style="padding:24px;text-align:center;">
                  <p style="margin:0 0 8px;font-size:13px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.08em;">Overall score</p>
                  <p style="margin:0;font-size:56px;font-weight:800;color:{rag_colour};">{overall_score}</p>
                  <p style="margin:4px 0 0;font-size:14px;color:{rag_colour};font-weight:600;">{rag_label}</p>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 24px;color:#d1d5db;font-size:15px;line-height:1.6;">
              Your full report includes a breakdown of your website health, local SEO, and social media presence — with specific recommendations for what to fix first.
            </p>

            <!-- CTA -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
              <tr>
                <td align="center">
                  <a href="{report_url}"
                     style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#00d4ff,#7c3aed);color:#fff;text-decoration:none;font-weight:700;font-size:15px;border-radius:8px;">
                    View your full report →
                  </a>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 8px;color:#6b7280;font-size:13px;line-height:1.6;">
              Or copy this link: <span style="color:#00d4ff;">{report_url}</span>
            </p>

            <hr style="border:none;border-top:1px solid #1f2937;margin:28px 0;">

            <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.6;">
              If you have any questions about your results or want to talk through what to prioritise, 
              just reply to this email or get in touch at 
              <a href="mailto:hello@dc81.io" style="color:#00d4ff;">hello@dc81.io</a>.
              <br><br>
              — Dominic Clauzel, DC81 Ltd
            </p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:20px 40px;border-top:1px solid #1f2937;background:#0d1117;">
            <p style="margin:0;font-size:12px;color:#4b5563;text-align:center;">
              DC81 Ltd · Newcastle upon Tyne · 
              <a href="https://dc81.io/privacy" style="color:#4b5563;">Privacy Policy</a> · 
              You received this because you requested a free audit at dc81.io
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""

    r = requests.post(
        "https://api.resend.com/emails",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={
            "from": "Dominic at DC81 <noreply@dc81.io>",
            "to": [lead["email"]],
            "subject": f"Your free digital audit — {company} scored {overall_score}/100",
            "html": html,
        },
        timeout=30,
    )
    r.raise_for_status()
    result = r.json()
    log.info(f"Email sent to {lead['email']} — Resend ID: {result.get('id')}")


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------
def main():
    creds = load_credentials()
    if not creds.get("DC81_SUPABASE_URL"):
        log.error("Missing Supabase credentials")
        sys.exit(1)

    # Fetch new audit leads
    try:
        leads = sb_get(
            creds,
            "dc81_leads",
            "pipeline_stage=eq.new&service_category=eq.Free Digital Audit&select=*",
        )
    except Exception as e:
        log.error(f"Failed to fetch leads: {e}")
        sys.exit(1)

    if not leads:
        log.debug("No new audit leads — idle")
        return

    log.info(f"Found {len(leads)} new audit lead(s)")

    for lead in leads:
        lead_id = lead["id"]
        email = lead.get("email", "")
        company = lead.get("company_name") or lead.get("name", "Unknown")
        log.info(f"Processing lead {lead_id} — {email} — {company}")

        # Mark as in-progress immediately to prevent double-processing
        try:
            sb_patch(creds, "dc81_leads", f"id=eq.{lead_id}", {"pipeline_stage": "audit_sent"})
        except Exception as e:
            log.error(f"Failed to lock lead {lead_id}: {e}")
            continue

        job_row = None
        try:
            # Create audit_jobs row
            job_row = sb_post(creds, "audit_jobs", {
                "lead_id": lead_id,
                "status": "running",
                "input_data": {
                    "website_url": lead.get("website_url", ""),
                    "company_name": company,
                    "location": lead.get("audit_location", ""),
                    "keywords": lead.get("audit_keywords", []),
                    "gbp_name": lead.get("audit_gbp_name", ""),
                    "social_handles": lead.get("social_handles", {}),
                },
            })
            job_id = job_row["id"]
            log.info(f"Audit job created: {job_id}")

            # Run audit
            report_data = asyncio.run(run_audit(lead, creds.get("GOOGLE_PAGESPEED_API_KEY", "")))
            overall_score = report_data["overall_score"]
            overall_rag = report_data["overall_rag"]

            # Generate access token
            access_token = str(uuid.uuid4())
            report_url = f"https://dc81.io/audit-report/{access_token}"

            # Write report
            sb_post(creds, "audit_reports", {
                "job_id": job_id,
                "lead_id": lead_id,
                "tier": 1,
                "report_json": report_data,
                "overall_score": overall_score,
                "access_type": "public",
                "access_token": access_token,
                "report_url": report_url,
            })
            log.info(f"Report written — score: {overall_score} — token: {access_token}")

            # Send email
            send_report_email(creds, lead, report_url, overall_score, overall_rag)

            # Mark job complete
            sb_patch(creds, "audit_jobs", f"id=eq.{job_id}", {
                "status": "complete",
                "completed_at": datetime.now(timezone.utc).isoformat(),
            })
            log.info(f"Lead {lead_id} — pipeline complete ✓")

        except Exception as e:
            log.error(f"Pipeline failed for lead {lead_id}: {e}")
            # Revert lead stage so it can be retried
            try:
                sb_patch(creds, "dc81_leads", f"id=eq.{lead_id}", {"pipeline_stage": "new"})
            except Exception:
                pass
            if job_row:
                try:
                    sb_patch(creds, "audit_jobs", f"id=eq.{job_row['id']}", {
                        "status": "failed",
                        "error_message": str(e)[:500],
                    })
                except Exception:
                    pass


if __name__ == "__main__":
    main()
