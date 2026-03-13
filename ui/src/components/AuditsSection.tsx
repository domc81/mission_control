/**
 * AuditsSection.tsx
 *
 * Phase 5 — Audits Section for Mission Control.
 * Reads audit_jobs + audit_reports from Supabase.
 * Features:
 *   - Job list with status filter (queued/running/complete/failed)
 *   - Click job → detail panel: input data, lead info, report score, section breakdown, top issues
 *   - Link through to lead in the CRM
 *   - Tier 2 trigger button (creates Convex task, pings agent)
 */

import { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type JobStatus = "queued" | "running" | "complete" | "failed";

type AuditJob = {
  id: string;
  lead_id: string | null;
  status: JobStatus;
  progress: Record<string, unknown> | null;
  created_at: string;
  completed_at: string | null;
  error_message: string | null;
  updated_at: string;
  input_data: {
    domain?: string;
    company_name?: string;
    name?: string;
    email?: string;
    keywords?: string[];
    location?: string;
    gbp_name?: string;
    social_handles?: Record<string, string>;
  } | null;
};

type ReportSection = { score: number; rag: string; checks?: Array<{ label: string; status: string; message: string }> };

type AuditReport = {
  id: string;
  job_id: string;
  lead_id: string | null;
  tier: number;
  overall_score: number;
  access_token: string;
  report_url: string | null;
  created_at: string;
  report_json: {
    domain?: string;
    scanned_at?: string;
    overall_rag?: string;
    sections?: Record<string, ReportSection>;
    top_issues?: Array<{ label: string; status: string; message: string }>;
  } | null;
};

type Props = {
  supabaseUrl: string;
  supabaseKey: string;   // anon key
  authToken: string;     // session JWT
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const STATUS_CONFIG: Record<JobStatus, { label: string; colour: string; dot: string }> = {
  queued:   { label: "Queued",   colour: "#6b7280", dot: "#6b7280" },
  running:  { label: "Running",  colour: "#f59e0b", dot: "#f59e0b" },
  complete: { label: "Complete", colour: "#22c55e", dot: "#22c55e" },
  failed:   { label: "Failed",   colour: "#ef4444", dot: "#ef4444" },
};

const RAG_COLOUR: Record<string, string> = {
  green: "#22c55e", amber: "#f59e0b", red: "#ef4444",
};

const SECTION_LABELS: Record<string, string> = {
  performance: "Performance",
  technical:   "Technical SEO",
  social:      "Social Media",
  gbp:         "Google Business Profile",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function AuditsSection({ supabaseUrl, supabaseKey, authToken }: Props) {
  const [jobs, setJobs] = useState<AuditJob[]>([]);
  const [reports, setReports] = useState<Record<string, AuditReport>>({});  // keyed by job_id
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<AuditJob | null>(null);
  const [filterStatus, setFilterStatus] = useState<JobStatus | "all">("all");
  const [triggeringTier2, setTriggeringTier2] = useState(false);
  const [tier2Message, setTier2Message] = useState<string | null>(null);

  const headers = {
    apikey: supabaseKey,
    Authorization: `Bearer ${authToken}`,
    "Content-Type": "application/json",
  };

  // ---------------------------------------------------------------------------
  // Fetch jobs
  // ---------------------------------------------------------------------------
  const fetchJobs = useCallback(async () => {
    try {
      const r = await fetch(
        `${supabaseUrl}/rest/v1/audit_jobs?select=*&order=created_at.desc&limit=100`,
        { headers }
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data: AuditJob[] = await r.json();
      setJobs(data);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load audit jobs");
    } finally {
      setLoading(false);
    }
  }, [supabaseUrl, authToken]);

  // ---------------------------------------------------------------------------
  // Fetch reports for complete jobs
  // ---------------------------------------------------------------------------
  const fetchReports = useCallback(async (jobIds: string[]) => {
    if (!jobIds.length) return;
    try {
      const ids = jobIds.map(id => `"${id}"`).join(",");
      const r = await fetch(
        `${supabaseUrl}/rest/v1/audit_reports?job_id=in.(${ids})&select=*`,
        { headers }
      );
      if (!r.ok) return;
      const data: AuditReport[] = await r.json();
      const map: Record<string, AuditReport> = {};
      data.forEach(rep => { if (rep.job_id) map[rep.job_id] = rep; });
      setReports(prev => ({ ...prev, ...map }));
    } catch {
      // silent
    }
  }, [supabaseUrl, authToken]);

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 15_000);
    return () => clearInterval(interval);
  }, [fetchJobs]);

  // Fetch reports whenever jobs update
  useEffect(() => {
    const completeIds = jobs.filter(j => j.status === "complete").map(j => j.id);
    fetchReports(completeIds);
  }, [jobs, fetchReports]);

  // ---------------------------------------------------------------------------
  // Trigger Tier 2 deep-dive
  // ---------------------------------------------------------------------------
  const triggerTier2 = async (job: AuditJob) => {
    setTriggeringTier2(true);
    setTier2Message(null);
    try {
      // Create Convex task and assign to Architect
      const taskRes = await fetch("https://exciting-warbler-274.eu-west-1.convex.cloud/api/mutation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: "createTask:createTask",
          args: {
            title: `Tier 2 Deep-Dive Audit: ${job.input_data?.company_name || job.input_data?.domain || job.id}`,
            description: `Full deep-dive audit for lead ${job.lead_id}.\nDomain: ${job.input_data?.domain}\nKeywords: ${(job.input_data?.keywords || []).join(", ")}\nLocation: ${job.input_data?.location}\nTier 1 job: ${job.id}`,
            priority: "high",
            status: "todo",
            assignees: ["j971h03xhjd0691m22yg2dfw6s81m5fz"],  // Architect
          },
        }),
      });
      if (!taskRes.ok) throw new Error(`Convex ${taskRes.status}`);
      setTier2Message("✓ Tier 2 task created — Architect will pick it up on next heartbeat");
    } catch (e: unknown) {
      setTier2Message(`✗ ${e instanceof Error ? e.message : "Failed"}`);
    } finally {
      setTriggeringTier2(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------
  const filteredJobs = filterStatus === "all" ? jobs : jobs.filter(j => j.status === filterStatus);
  const counts = Object.fromEntries(
    (["queued", "running", "complete", "failed"] as JobStatus[]).map(s => [s, jobs.filter(j => j.status === s).length])
  );

  const selectedReport = selectedJob ? reports[selectedJob.id] ?? null : null;

  // ---------------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------------
  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "48px", color: "#9ca3af" }}>
        <div className="loading-spinner" style={{ marginRight: "12px" }} />
        Loading audits…
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Detail panel
  // ---------------------------------------------------------------------------
  const DetailPanel = () => {
    if (!selectedJob) return null;
    const job = selectedJob;
    const report = selectedReport;
    const cfg = STATUS_CONFIG[job.status] ?? STATUS_CONFIG.queued;
    const rag = (report?.report_json?.overall_rag ?? "amber") as string;

    return (
      <div style={{
        width: "400px", flexShrink: 0, borderLeft: "1px solid #1f2937",
        background: "#0d1117", overflowY: "auto", display: "flex", flexDirection: "column",
      }}>
        {/* Header */}
        <div style={{ padding: "20px", borderBottom: "1px solid #1f2937" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <h3 style={{ margin: "0 0 4px", fontSize: "16px", fontWeight: 600, color: "#f9fafb" }}>
                {job.input_data?.company_name || job.input_data?.domain || "Audit Job"}
              </h3>
              <p style={{ margin: 0, fontSize: "12px", color: "#9ca3af" }}>
                {job.input_data?.email} · {job.input_data?.domain}
              </p>
            </div>
            <button onClick={() => setSelectedJob(null)} style={{ background: "none", border: "none", color: "#6b7280", cursor: "pointer", fontSize: "18px" }}>✕</button>
          </div>
          <div style={{ marginTop: "10px", display: "flex", gap: "8px", alignItems: "center" }}>
            <span style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", fontWeight: 600, color: cfg.colour }}>
              <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: cfg.dot }} />
              {cfg.label}
            </span>
            <span style={{ color: "#4b5563", fontSize: "11px" }}>·</span>
            <span style={{ fontSize: "11px", color: "#6b7280" }}>Tier {selectedReport?.tier ?? 1}</span>
            <span style={{ color: "#4b5563", fontSize: "11px" }}>·</span>
            <span style={{ fontSize: "11px", color: "#6b7280" }}>{formatDate(job.created_at)}</span>
          </div>
        </div>

        {/* Report score */}
        {report && (
          <div style={{ padding: "16px 20px", borderBottom: "1px solid #1f2937" }}>
            <p style={{ margin: "0 0 10px", fontSize: "11px", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.08em" }}>Result</p>
            <div style={{ display: "flex", alignItems: "baseline", gap: "6px", marginBottom: "12px" }}>
              <span style={{ fontSize: "48px", fontWeight: 800, lineHeight: 1, color: RAG_COLOUR[rag] ?? "#f59e0b" }}>
                {report.overall_score}
              </span>
              <span style={{ fontSize: "16px", color: "#6b7280" }}>/100</span>
            </div>

            {/* Section scores */}
            {report.report_json?.sections && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "12px" }}>
                {Object.entries(report.report_json.sections).map(([key, sec]) => (
                  <span key={key} style={{
                    fontSize: "11px", padding: "3px 10px", borderRadius: "10px",
                    background: `${RAG_COLOUR[sec.rag] ?? "#6b7280"}15`,
                    color: RAG_COLOUR[sec.rag] ?? "#6b7280",
                    border: `1px solid ${RAG_COLOUR[sec.rag] ?? "#6b7280"}30`,
                  }}>
                    {SECTION_LABELS[key] ?? key}: {sec.score}
                  </span>
                ))}
              </div>
            )}

            {/* Top issues */}
            {report.report_json?.top_issues && report.report_json.top_issues.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <p style={{ margin: "0 0 4px", fontSize: "11px", color: "#6b7280" }}>Top issues</p>
                {report.report_json.top_issues.slice(0, 4).map((issue, i) => (
                  <div key={i} style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
                    <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: RAG_COLOUR[issue.status] ?? "#6b7280", marginTop: "5px", flexShrink: 0 }} />
                    <p style={{ margin: 0, fontSize: "12px", color: "#d1d5db", lineHeight: 1.5 }}>{issue.message}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Report link */}
            {report.report_url && (
              <a
                href={report.report_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: "inline-block", marginTop: "12px", fontSize: "12px", color: "#00d4ff", textDecoration: "none" }}
              >
                View full report →
              </a>
            )}
          </div>
        )}

        {/* No report yet */}
        {!report && job.status !== "failed" && (
          <div style={{ padding: "16px 20px", borderBottom: "1px solid #1f2937" }}>
            <p style={{ fontSize: "13px", color: "#6b7280" }}>
              {job.status === "complete" ? "Report data not found" : "Audit in progress…"}
            </p>
          </div>
        )}

        {/* Error message */}
        {job.status === "failed" && job.error_message && (
          <div style={{ padding: "16px 20px", borderBottom: "1px solid #1f2937" }}>
            <p style={{ margin: "0 0 6px", fontSize: "11px", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.08em" }}>Error</p>
            <p style={{ margin: 0, fontSize: "12px", color: "#f87171", fontFamily: "monospace" }}>{job.error_message}</p>
          </div>
        )}

        {/* Audit input data */}
        {job.input_data && (
          <div style={{ padding: "16px 20px", borderBottom: "1px solid #1f2937" }}>
            <p style={{ margin: "0 0 10px", fontSize: "11px", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.08em" }}>Audit inputs</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "5px", fontSize: "12px" }}>
              {[
                ["Domain", job.input_data.domain],
                ["Location", job.input_data.location],
                ["GBP name", job.input_data.gbp_name],
                ["Keywords", job.input_data.keywords?.join(", ")],
                ["Social", job.input_data.social_handles ? Object.entries(job.input_data.social_handles).map(([k,v]) => `${k}: ${v}`).join(", ") : undefined],
              ].filter(([, v]) => v).map(([label, value]) => (
                <div key={label as string} style={{ display: "flex", gap: "8px" }}>
                  <span style={{ color: "#6b7280", width: "68px", flexShrink: 0 }}>{label}</span>
                  <span style={{ color: "#d1d5db" }}>{value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Lead link */}
        {job.lead_id && (
          <div style={{ padding: "16px 20px", borderBottom: "1px solid #1f2937" }}>
            <p style={{ margin: "0 0 6px", fontSize: "11px", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.08em" }}>Linked lead</p>
            <p style={{ margin: 0, fontSize: "12px", color: "#9ca3af", fontFamily: "monospace" }}>{job.lead_id}</p>
          </div>
        )}

        {/* Tier 2 trigger */}
        {job.status === "complete" && (
          <div style={{ padding: "16px 20px" }}>
            <p style={{ margin: "0 0 8px", fontSize: "11px", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.08em" }}>Tier 2 deep-dive</p>
            <p style={{ margin: "0 0 10px", fontSize: "12px", color: "#9ca3af" }}>
              Trigger a full technical deep-dive audit via Architect agent. Includes Core Web Vitals analysis, backlink audit, competitor gap analysis, and structured recommendations report.
            </p>
            <button
              onClick={() => triggerTier2(job)}
              disabled={triggeringTier2}
              style={{
                padding: "8px 16px", fontSize: "12px", fontWeight: 600, borderRadius: "8px", cursor: "pointer",
                border: "1px solid rgba(139,92,246,0.5)", background: "rgba(139,92,246,0.15)", color: "#a78bfa",
                opacity: triggeringTier2 ? 0.5 : 1,
              }}
            >
              {triggeringTier2 ? "Triggering…" : "🔬 Trigger Tier 2 Audit"}
            </button>
            {tier2Message && (
              <p style={{ margin: "8px 0 0", fontSize: "12px", color: tier2Message.startsWith("✓") ? "#22c55e" : "#f87171" }}>
                {tier2Message}
              </p>
            )}
          </div>
        )}
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Job row
  // ---------------------------------------------------------------------------
  const JobRow = ({ job }: { job: AuditJob }) => {
    const cfg = STATUS_CONFIG[job.status] ?? STATUS_CONFIG.queued;
    const report = reports[job.id];
    const isSelected = selectedJob?.id === job.id;
    const rag = (report?.report_json?.overall_rag ?? null) as string | null;

    return (
      <tr
        onClick={() => setSelectedJob(job)}
        style={{
          borderBottom: "1px solid #1f2937", cursor: "pointer",
          background: isSelected ? "#1a2236" : "transparent",
        }}
      >
        <td style={{ padding: "12px 16px" }}>
          <div style={{ fontWeight: 600, color: "#f9fafb", fontSize: "13px" }}>
            {job.input_data?.company_name || job.input_data?.domain || "—"}
          </div>
          <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "2px" }}>{job.input_data?.email}</div>
        </td>
        <td style={{ padding: "12px 16px" }}>
          <div style={{ fontSize: "12px", color: "#9ca3af" }}>{job.input_data?.domain || "—"}</div>
        </td>
        <td style={{ padding: "12px 16px" }}>
          <span style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", fontWeight: 600, color: cfg.colour, width: "max-content" }}>
            <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: cfg.dot }} />
            {cfg.label}
          </span>
        </td>
        <td style={{ padding: "12px 16px" }}>
          {report ? (
            <span style={{ fontSize: "14px", fontWeight: 700, color: RAG_COLOUR[rag ?? "amber"] ?? "#f59e0b" }}>
              {report.overall_score}
            </span>
          ) : (
            <span style={{ fontSize: "12px", color: "#4b5563" }}>—</span>
          )}
        </td>
        <td style={{ padding: "12px 16px", fontSize: "12px", color: "#6b7280", whiteSpace: "nowrap" }}>
          {timeAgo(job.created_at)}
        </td>
        <td style={{ padding: "12px 16px" }}>
          {job.status === "complete" && (
            <span style={{ fontSize: "10px", padding: "2px 7px", borderRadius: "6px", border: "1px solid rgba(139,92,246,0.4)", color: "#a78bfa" }}>Tier 1</span>
          )}
        </td>
      </tr>
    );
  };

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------
  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* Main */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Toolbar */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #1f2937", display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
          {/* Stats */}
          <div style={{ display: "flex", gap: "20px", fontSize: "13px" }}>
            {(["complete", "running", "queued", "failed"] as JobStatus[]).map(s => {
              const cfg = STATUS_CONFIG[s];
              return (
                <div key={s} style={{ textAlign: "center" }}>
                  <p style={{ margin: "0 0 1px", fontSize: "20px", fontWeight: 700, color: cfg.colour }}>{counts[s] ?? 0}</p>
                  <p style={{ margin: 0, fontSize: "10px", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em" }}>{cfg.label}</p>
                </div>
              );
            })}
          </div>

          {/* Filter */}
          <div style={{ marginLeft: "auto", display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {([{ id: "all", label: "All", colour: "#9ca3af" }, ...Object.entries(STATUS_CONFIG).map(([id, cfg]) => ({ id, label: cfg.label, colour: cfg.colour }))] as const).map((s: any) => (
              <button
                key={s.id}
                onClick={() => setFilterStatus(s.id)}
                style={{
                  padding: "5px 12px", fontSize: "11px", borderRadius: "6px", cursor: "pointer",
                  border: `1px solid ${filterStatus === s.id ? s.colour : "#374151"}`,
                  background: filterStatus === s.id ? `${s.colour}20` : "transparent",
                  color: filterStatus === s.id ? s.colour : "#9ca3af",
                }}
              >
                {s.label}
              </button>
            ))}
            <button onClick={fetchJobs} style={{ padding: "5px 10px", fontSize: "13px", borderRadius: "6px", border: "1px solid #374151", background: "transparent", color: "#9ca3af", cursor: "pointer" }}>↻</button>
          </div>
        </div>

        {error && (
          <div style={{ margin: "12px 20px", padding: "10px 14px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "8px", color: "#f87171", fontSize: "13px" }}>
            ⚠ {error}
          </div>
        )}

        {/* Table */}
        <div style={{ flex: 1, overflow: "auto", padding: "0 20px 20px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #1f2937" }}>
                {["Company / Contact", "Domain", "Status", "Score", "Created", "Tier"].map(h => (
                  <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: "11px", color: "#6b7280", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredJobs.map(job => <JobRow key={job.id} job={job} />)}
              {filteredJobs.length === 0 && (
                <tr><td colSpan={6} style={{ padding: "40px", textAlign: "center", color: "#6b7280" }}>
                  {filterStatus === "all" ? "No audit jobs yet. Leads submitted via dc81.io/free-audit will appear here." : `No ${filterStatus} jobs`}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail panel */}
      <DetailPanel />
    </div>
  );
}
