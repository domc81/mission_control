/**
 * LeadsCRM.tsx
 *
 * Pipeline CRM for dc81_leads from Supabase.
 * Stages: new → audit_sent → nurture → qualified → client → closed
 * Features: pipeline kanban, lead detail panel, stage move, notes (via message field)
 */

import { useState, useEffect, useCallback, useRef } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type PipelineStage = "new" | "audit_sent" | "nurture" | "qualified" | "client" | "closed";

type Lead = {
  id: string;
  name: string;
  email: string;
  phone?: string;
  company_name?: string;
  website_url?: string;
  message?: string;
  source_page?: string;
  service_category?: string;
  audit_keywords?: string[];
  audit_gbp_name?: string;
  audit_location?: string;
  social_handles?: Record<string, string>;
  gdpr_consent?: boolean;
  gdpr_marketing_consent?: boolean;
  pipeline_stage: PipelineStage;
  created_at: string;
  updated_at?: string;
};

type AuditReport = {
  id: string;
  overall_score: number;
  access_token: string;
  report_url?: string;
  created_at: string;
  report_json?: {
    overall_rag?: string;
    top_issues?: Array<{ label: string; status: string; message: string }>;
    sections?: Record<string, { score: number; rag: string }>;
  };
};

type Props = {
  supabaseUrl: string;
  supabaseKey: string;   // anon key (stays as apikey header)
  authToken: string;     // session JWT (Authorization: Bearer)
};

// ---------------------------------------------------------------------------
// Pipeline config
// ---------------------------------------------------------------------------
const STAGES: { id: PipelineStage; label: string; colour: string }[] = [
  { id: "new",        label: "New",        colour: "#6b7280" },
  { id: "audit_sent", label: "Audit Sent", colour: "#3b82f6" },
  { id: "nurture",    label: "Nurture",    colour: "#f59e0b" },
  { id: "qualified",  label: "Qualified",  colour: "#8b5cf6" },
  { id: "client",     label: "Client",     colour: "#22c55e" },
  { id: "closed",     label: "Closed",     colour: "#ef4444" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function stageColour(stage: PipelineStage): string {
  return STAGES.find(s => s.id === stage)?.colour ?? "#6b7280";
}

const RAG_COLOUR: Record<string, string> = {
  green: "#22c55e", amber: "#f59e0b", red: "#ef4444",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function LeadsCRM({ supabaseUrl, supabaseKey, authToken }: Props) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [auditReport, setAuditReport] = useState<AuditReport | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [movingStage, setMovingStage] = useState(false);
  const [view, setView] = useState<"pipeline" | "table">("pipeline");
  const [filterStage, setFilterStage] = useState<PipelineStage | "all">("all");

  // apikey must always be the anon key; Authorization carries the session JWT
  const headers = {
    apikey: supabaseKey,
    Authorization: `Bearer ${authToken}`,
    "Content-Type": "application/json",
  };

  // ---------------------------------------------------------------------------
  // Fetch leads
  // ---------------------------------------------------------------------------
  const fetchLeads = useCallback(async () => {
    try {
      const r = await fetch(
        `${supabaseUrl}/rest/v1/dc81_leads?select=*&order=created_at.desc&limit=200`,
        { headers }
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data: Lead[] = await r.json();
      setLeads(data);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load leads");
    } finally {
      setLoading(false);
    }
  }, [supabaseUrl, supabaseKey]);

  useEffect(() => {
    fetchLeads();
    const interval = setInterval(fetchLeads, 30_000);
    return () => clearInterval(interval);
  }, [fetchLeads]);

  // ---------------------------------------------------------------------------
  // Fetch audit report for selected lead
  // ---------------------------------------------------------------------------
  const fetchAuditReport = useCallback(async (leadId: string) => {
    setLoadingReport(true);
    setAuditReport(null);
    try {
      const r = await fetch(
        `${supabaseUrl}/rest/v1/audit_reports?lead_id=eq.${leadId}&order=created_at.desc&limit=1&select=id,overall_score,access_token,report_url,created_at,report_json`,
        { headers }
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const rows = await r.json();
      setAuditReport(rows[0] ?? null);
    } catch {
      setAuditReport(null);
    } finally {
      setLoadingReport(false);
    }
  }, [supabaseUrl, supabaseKey]);

  const handleSelectLead = (lead: Lead) => {
    setSelectedLead(lead);
    fetchAuditReport(lead.id);
  };

  // ---------------------------------------------------------------------------
  // Move stage
  // ---------------------------------------------------------------------------
  const moveStage = async (leadId: string, stage: PipelineStage) => {
    setMovingStage(true);
    try {
      await fetch(
        `${supabaseUrl}/rest/v1/dc81_leads?id=eq.${leadId}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({ pipeline_stage: stage }),
        }
      );
      setLeads(prev => prev.map(l => l.id === leadId ? { ...l, pipeline_stage: stage } : l));
      if (selectedLead?.id === leadId) {
        setSelectedLead(prev => prev ? { ...prev, pipeline_stage: stage } : prev);
      }
    } catch {
      // silent — refresh will catch it
    } finally {
      setMovingStage(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Drag handlers
  // ---------------------------------------------------------------------------
  const handleDragStart = useCallback((e: React.DragEvent, leadId: string) => {
    dragLeadId.current = leadId;
    e.dataTransfer.effectAllowed = "move";
    // Ghost image: use the card element itself
    (e.currentTarget as HTMLElement).style.opacity = "0.5";
  }, []);

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    (e.currentTarget as HTMLElement).style.opacity = "1";
    dragLeadId.current = null;
    setDragOverStage(null);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, stage: PipelineStage) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverStage(stage);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent, stage: PipelineStage) => {
    // Only clear if leaving the column entirely (not just entering a child)
    const related = e.relatedTarget as Node | null;
    if (!(e.currentTarget as HTMLElement).contains(related)) {
      setDragOverStage(prev => prev === stage ? null : prev);
    }
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent, stage: PipelineStage) => {
    e.preventDefault();
    setDragOverStage(null);
    const id = dragLeadId.current;
    if (!id) return;
    const lead = leads.find(l => l.id === id);
    if (!lead || lead.pipeline_stage === stage) return;
    await moveStage(id, stage);
  }, [leads, moveStage]);

  // ---------------------------------------------------------------------------
  // Derived data
  // ---------------------------------------------------------------------------
  const filteredLeads = filterStage === "all" ? leads : leads.filter(l => l.pipeline_stage === filterStage);
  const byStage = (stage: PipelineStage) => leads.filter(l => l.pipeline_stage === stage);

  // ---------------------------------------------------------------------------
  // Render — loading
  // ---------------------------------------------------------------------------
  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "48px", color: "#9ca3af" }}>
        <div className="loading-spinner" style={{ marginRight: "12px" }} />
        Loading leads…
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render — detail panel (right side when lead selected)
  // ---------------------------------------------------------------------------
  const DetailPanel = () => {
    if (!selectedLead) return null;
    const lead = selectedLead;
    const col = stageColour(lead.pipeline_stage);

    return (
      <div style={{
        width: "380px", flexShrink: 0, borderLeft: "1px solid #1f2937",
        background: "#0d1117", overflowY: "auto", display: "flex", flexDirection: "column",
      }}>
        {/* Header */}
        <div style={{ padding: "20px", borderBottom: "1px solid #1f2937" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <h3 style={{ margin: "0 0 4px", fontSize: "16px", fontWeight: 600, color: "#f9fafb" }}>
                {lead.company_name || lead.name}
              </h3>
              <p style={{ margin: 0, fontSize: "13px", color: "#9ca3af" }}>{lead.name} · {lead.email}</p>
            </div>
            <button onClick={() => setSelectedLead(null)} style={{ background: "none", border: "none", color: "#6b7280", cursor: "pointer", fontSize: "18px" }}>✕</button>
          </div>

          {/* Stage badge */}
          <div style={{ marginTop: "12px" }}>
            <span style={{ fontSize: "11px", padding: "3px 10px", borderRadius: "10px", border: `1px solid ${col}40`, color: col, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              {STAGES.find(s => s.id === lead.pipeline_stage)?.label}
            </span>
          </div>
        </div>

        {/* Stage mover */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #1f2937" }}>
          <p style={{ margin: "0 0 8px", fontSize: "11px", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.08em" }}>Move stage</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {STAGES.map(s => (
              <button
                key={s.id}
                onClick={() => moveStage(lead.id, s.id)}
                disabled={movingStage || s.id === lead.pipeline_stage}
                style={{
                  padding: "4px 10px", fontSize: "11px", borderRadius: "6px", cursor: "pointer",
                  border: `1px solid ${s.id === lead.pipeline_stage ? s.colour : "#374151"}`,
                  background: s.id === lead.pipeline_stage ? `${s.colour}20` : "transparent",
                  color: s.id === lead.pipeline_stage ? s.colour : "#9ca3af",
                  fontWeight: s.id === lead.pipeline_stage ? 600 : 400,
                  opacity: movingStage ? 0.5 : 1,
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Contact details */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #1f2937" }}>
          <p style={{ margin: "0 0 10px", fontSize: "11px", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.08em" }}>Contact</p>
          <div style={{ fontSize: "13px", display: "flex", flexDirection: "column", gap: "6px" }}>
            {[
              ["Email", lead.email],
              ["Phone", lead.phone || "—"],
              ["Website", lead.website_url || "—"],
              ["Location", lead.audit_location || "—"],
              ["Source", lead.source_page || "—"],
              ["Submitted", timeAgo(lead.created_at)],
            ].map(([label, value]) => (
              <div key={label} style={{ display: "flex", gap: "8px" }}>
                <span style={{ color: "#6b7280", width: "64px", flexShrink: 0 }}>{label}</span>
                <span style={{ color: "#d1d5db", wordBreak: "break-all" }}>
                  {label === "Website" && value !== "—"
                    ? <a href={value} target="_blank" rel="noopener noreferrer" style={{ color: "#00d4ff" }}>{value}</a>
                    : value}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Audit details */}
        {(lead.audit_keywords?.length || lead.audit_gbp_name) && (
          <div style={{ padding: "16px 20px", borderBottom: "1px solid #1f2937" }}>
            <p style={{ margin: "0 0 10px", fontSize: "11px", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.08em" }}>Audit request</p>
            <div style={{ fontSize: "13px", display: "flex", flexDirection: "column", gap: "6px" }}>
              {lead.audit_gbp_name && (
                <div style={{ display: "flex", gap: "8px" }}>
                  <span style={{ color: "#6b7280", width: "64px" }}>GBP</span>
                  <span style={{ color: "#d1d5db" }}>{lead.audit_gbp_name}</span>
                </div>
              )}
              {lead.audit_keywords?.length ? (
                <div style={{ display: "flex", gap: "8px" }}>
                  <span style={{ color: "#6b7280", width: "64px" }}>Keywords</span>
                  <span style={{ color: "#d1d5db" }}>{lead.audit_keywords.join(", ")}</span>
                </div>
              ) : null}
              {lead.social_handles && Object.keys(lead.social_handles).length > 0 && (
                <div style={{ display: "flex", gap: "8px" }}>
                  <span style={{ color: "#6b7280", width: "64px" }}>Social</span>
                  <span style={{ color: "#d1d5db" }}>
                    {Object.entries(lead.social_handles).map(([k, v]) => `${k}: ${v}`).join(", ")}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Audit report */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #1f2937" }}>
          <p style={{ margin: "0 0 10px", fontSize: "11px", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.08em" }}>Audit report</p>
          {loadingReport ? (
            <p style={{ fontSize: "13px", color: "#6b7280" }}>Loading…</p>
          ) : auditReport ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{
                  fontSize: "28px", fontWeight: 800,
                  color: RAG_COLOUR[auditReport.report_json?.overall_rag ?? "amber"] ?? "#f59e0b",
                }}>
                  {auditReport.overall_score}
                </span>
                <span style={{ fontSize: "12px", color: "#9ca3af" }}>/100 · {timeAgo(auditReport.created_at)}</span>
              </div>
              {auditReport.report_json?.sections && (
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  {Object.entries(auditReport.report_json.sections).map(([key, sec]) => (
                    <span key={key} style={{
                      fontSize: "11px", padding: "2px 8px", borderRadius: "8px",
                      background: `${RAG_COLOUR[sec.rag] ?? "#6b7280"}15`,
                      color: RAG_COLOUR[sec.rag] ?? "#6b7280",
                      border: `1px solid ${RAG_COLOUR[sec.rag] ?? "#6b7280"}30`,
                    }}>
                      {key}: {sec.score}
                    </span>
                  ))}
                </div>
              )}
              {auditReport.report_url && (
                <a
                  href={auditReport.report_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: "12px", color: "#00d4ff", textDecoration: "none" }}
                >
                  View full report →
                </a>
              )}
            </div>
          ) : (
            <p style={{ fontSize: "13px", color: "#6b7280" }}>No audit report yet</p>
          )}
        </div>

        {/* Message/notes */}
        {lead.message && (
          <div style={{ padding: "16px 20px" }}>
            <p style={{ margin: "0 0 8px", fontSize: "11px", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.08em" }}>Notes</p>
            <p style={{ margin: 0, fontSize: "13px", color: "#d1d5db", lineHeight: 1.6 }}>{lead.message}</p>
          </div>
        )}
      </div>
    );
  };

    // Drag state — tracked in a ref to avoid re-renders while dragging
  const dragLeadId = useRef<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<PipelineStage | null>(null);

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------
  const totalLeads = leads.length;
  const newCount = leads.filter(l => l.pipeline_stage === "new").length;
  const qualifiedCount = leads.filter(l => l.pipeline_stage === "qualified").length;
  const clientCount = leads.filter(l => l.pipeline_stage === "client").length;

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* Main area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Toolbar */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #1f2937", display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: "16px", fontSize: "13px" }}>
            {[
              { label: "Total", value: totalLeads, colour: "#9ca3af" },
              { label: "New", value: newCount, colour: "#3b82f6" },
              { label: "Qualified", value: qualifiedCount, colour: "#8b5cf6" },
              { label: "Clients", value: clientCount, colour: "#22c55e" },
            ].map(({ label, value, colour }) => (
              <div key={label} style={{ textAlign: "center" }}>
                <p style={{ margin: "0 0 1px", fontSize: "18px", fontWeight: 700, color: colour }}>{value}</p>
                <p style={{ margin: 0, fontSize: "11px", color: "#6b7280" }}>{label}</p>
              </div>
            ))}
          </div>

          <div style={{ marginLeft: "auto", display: "flex", gap: "8px", alignItems: "center" }}>
            {/* View toggle */}
            {(["pipeline", "table"] as const).map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                style={{
                  padding: "6px 12px", fontSize: "12px", borderRadius: "6px", cursor: "pointer",
                  border: "1px solid",
                  borderColor: view === v ? "#00d4ff" : "#374151",
                  background: view === v ? "rgba(0,212,255,0.1)" : "transparent",
                  color: view === v ? "#00d4ff" : "#9ca3af",
                }}
              >
                {v === "pipeline" ? "🗂 Pipeline" : "📋 Table"}
              </button>
            ))}
            <button onClick={fetchLeads} style={{ padding: "6px 10px", fontSize: "14px", borderRadius: "6px", border: "1px solid #374151", background: "transparent", color: "#9ca3af", cursor: "pointer" }}>↻</button>
          </div>
        </div>

        {error && (
          <div style={{ margin: "12px 20px", padding: "10px 14px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "8px", color: "#f87171", fontSize: "13px" }}>
            ⚠ {error}
          </div>
        )}

        {/* Pipeline view */}
        {view === "pipeline" && (
          <div style={{ flex: 1, overflowX: "auto", overflowY: "hidden", padding: "16px 20px" }}>
            <div style={{ display: "flex", gap: "12px", height: "100%", minWidth: "max-content" }}>
              {STAGES.map(stage => {
                const stageLeads = byStage(stage.id);
                const isDragTarget = dragOverStage === stage.id;
                return (
                  <div
                    key={stage.id}
                    style={{ width: "220px", flexShrink: 0, display: "flex", flexDirection: "column" }}
                    onDragOver={e => handleDragOver(e, stage.id)}
                    onDragLeave={e => handleDragLeave(e, stage.id)}
                    onDrop={e => handleDrop(e, stage.id)}
                  >
                    {/* Column header */}
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
                      <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: stage.colour, flexShrink: 0 }} />
                      <span style={{ fontSize: "12px", fontWeight: 600, color: "#d1d5db" }}>{stage.label}</span>
                      <span style={{ marginLeft: "auto", fontSize: "11px", color: "#6b7280", background: "#1f2937", padding: "1px 7px", borderRadius: "10px" }}>{stageLeads.length}</span>
                    </div>
                    {/* Drop zone */}
                    <div style={{
                      flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "8px",
                      borderRadius: "8px", padding: "4px",
                      border: isDragTarget ? `2px dashed ${stage.colour}` : "2px solid transparent",
                      background: isDragTarget ? `${stage.colour}08` : "transparent",
                      transition: "border-color 0.15s, background 0.15s",
                      minHeight: "80px",
                    }}>
                      {stageLeads.map(lead => {
                        const col = stageColour(lead.pipeline_stage);
                        const isSelected = selectedLead?.id === lead.id;
                        return (
                          <div
                            key={lead.id}
                            draggable
                            onDragStart={e => handleDragStart(e, lead.id)}
                            onDragEnd={handleDragEnd}
                            onClick={() => handleSelectLead(lead)}
                            style={{
                              padding: "12px", borderRadius: "8px",
                              cursor: "grab",
                              background: isSelected ? "#1a2236" : "#111827",
                              border: `1px solid ${isSelected ? col : "#1f2937"}`,
                              transition: "border-color 0.15s, background 0.15s",
                              userSelect: "none",
                            }}
                          >
                            <p style={{ margin: "0 0 2px", fontSize: "13px", fontWeight: 600, color: "#f9fafb" }}>
                              {lead.company_name || lead.name}
                            </p>
                            <p style={{ margin: "0 0 6px", fontSize: "12px", color: "#9ca3af" }}>{lead.email}</p>
                            {lead.website_url && (
                              <p style={{ margin: "0 0 6px", fontSize: "11px", color: "#6b7280", wordBreak: "break-all" }}>{lead.website_url}</p>
                            )}
                            <p style={{ margin: 0, fontSize: "11px", color: "#4b5563" }}>{timeAgo(lead.created_at)}</p>
                          </div>
                        );
                      })}
                      {stageLeads.length === 0 && (
                        <p style={{ fontSize: "12px", color: "#4b5563", textAlign: "center", padding: "20px 0" }}>
                          {isDragTarget ? "Drop here" : "Empty"}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Table view */}
        {view === "table" && (
          <div style={{ flex: 1, overflow: "auto", padding: "0 20px 20px" }}>
            {/* Stage filter */}
            <div style={{ display: "flex", gap: "6px", padding: "12px 0", flexWrap: "wrap" }}>
              {([{ id: "all", label: "All", colour: "#9ca3af" }, ...STAGES] as const).map((s: any) => (
                <button
                  key={s.id}
                  onClick={() => setFilterStage(s.id)}
                  style={{
                    padding: "4px 10px", fontSize: "11px", borderRadius: "6px", cursor: "pointer",
                    border: `1px solid ${filterStage === s.id ? s.colour : "#374151"}`,
                    background: filterStage === s.id ? `${s.colour}20` : "transparent",
                    color: filterStage === s.id ? s.colour : "#9ca3af",
                  }}
                >
                  {s.label} {s.id !== "all" ? `(${byStage(s.id as PipelineStage).length})` : `(${totalLeads})`}
                </button>
              ))}
            </div>

            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #1f2937" }}>
                  {["Company / Name", "Email", "Website", "Stage", "Source", "Created"].map(h => (
                    <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontSize: "11px", color: "#6b7280", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredLeads.map(lead => {
                  const col = stageColour(lead.pipeline_stage);
                  const isSelected = selectedLead?.id === lead.id;
                  return (
                    <tr
                      key={lead.id}
                      onClick={() => handleSelectLead(lead)}
                      style={{ borderBottom: "1px solid #1f2937", cursor: "pointer", background: isSelected ? "#1a2236" : "transparent" }}
                    >
                      <td style={{ padding: "10px 12px" }}>
                        <div style={{ fontWeight: 600, color: "#f9fafb" }}>{lead.company_name || lead.name}</div>
                        {lead.company_name && <div style={{ fontSize: "11px", color: "#9ca3af" }}>{lead.name}</div>}
                      </td>
                      <td style={{ padding: "10px 12px", color: "#d1d5db" }}>{lead.email}</td>
                      <td style={{ padding: "10px 12px" }}>
                        {lead.website_url
                          ? <a href={lead.website_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{ color: "#00d4ff", fontSize: "12px" }}>{lead.website_url.replace(/^https?:\/\//, "")}</a>
                          : <span style={{ color: "#4b5563" }}>—</span>}
                      </td>
                      <td style={{ padding: "10px 12px" }}>
                        <span style={{ fontSize: "11px", padding: "2px 8px", borderRadius: "8px", border: `1px solid ${col}40`, color: col, fontWeight: 600 }}>
                          {STAGES.find(s => s.id === lead.pipeline_stage)?.label}
                        </span>
                      </td>
                      <td style={{ padding: "10px 12px", fontSize: "12px", color: "#9ca3af" }}>{lead.source_page || "—"}</td>
                      <td style={{ padding: "10px 12px", fontSize: "12px", color: "#9ca3af", whiteSpace: "nowrap" }}>{timeAgo(lead.created_at)}</td>
                    </tr>
                  );
                })}
                {filteredLeads.length === 0 && (
                  <tr><td colSpan={6} style={{ padding: "32px", textAlign: "center", color: "#6b7280" }}>No leads</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail panel */}
      <DetailPanel />
    </div>
  );
}
