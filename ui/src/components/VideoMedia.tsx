import { useState, useEffect, useCallback } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface VideoJob {
  id: string;
  created_at: string;
  updated_at: string;
  source: string;
  source_ref: string | null;
  input_url: string;
  input_type: string;
  target_ratio: string;
  status: string;
  celery_task_id: string | null;
  error_message: string | null;
  progress_pct: number | null;
  output_minio_path: string | null;
  output_public_url: string | null;
  duration_secs: number | null;
  file_size_bytes: number | null;
  video_title: string | null;
  transcription: string | null;
}

interface ClientJob {
  id: string;
  from_number: string;
  description: string;
  status: string;
  approval_status: string | null;
  social_copy: string | null;
  hashtags: string | null;
  processed_minio_path: string | null;
  created_at: string;
  updated_at: string;
  telegram_chat_id: number | null;
  music_override: string;
  progress_pct: number | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_COLOURS: Record<string, string> = {
  queued:           "#6b7280",
  pending:          "#6b7280",
  downloading:      "#3b82f6",
  transcoding:      "#3b82f6",
  reframing:        "#8b5cf6",
  transcribing:     "#8b5cf6",
  captioning:       "#f59e0b",
  branding:         "#f59e0b",
  processing:       "#f59e0b",
  uploading:        "#10b981",
  generating_copy:  "#10b981",
  ready_for_review: "#06b6d4",
  approved:         "#059669",
  published:        "#10b981",
  rejected:         "#ef4444",
  failed:           "#ef4444",
  done:             "#10b981",
};

// Kanban columns for video_jobs (Pipeline A)
const KANBAN_COLS_A: { key: string; label: string; emoji: string }[] = [
  { key: "queued",           label: "Queued",          emoji: "⏳" },
  { key: "processing",       label: "Processing",      emoji: "⚙️" },
  { key: "ready_for_review", label: "Ready for Review", emoji: "👁️" },
  { key: "approved",         label: "Approved",        emoji: "✅" },
  { key: "published",        label: "Published",       emoji: "🚀" },
  { key: "failed",           label: "Failed",          emoji: "❌" },
];

// processing covers: downloading, transcoding, reframing, transcribing, captioning,
// branding, uploading, generating_copy
const PROCESSING_STATUSES = new Set([
  "downloading", "transcoding", "reframing", "transcribing",
  "captioning", "branding", "processing", "uploading", "generating_copy",
]);

function normaliseKanbanCol(status: string): string {
  if (PROCESSING_STATUSES.has(status)) return "processing";
  if (status === "preview_sent") return "ready_for_review";
  if (status === "done") return "published";
  return status;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const colour = STATUS_COLOURS[status] ?? "#6b7280";
  return (
    <span style={{
      background: colour + "22",
      color: colour,
      border: `1px solid ${colour}44`,
      borderRadius: 6,
      padding: "2px 8px",
      fontSize: 11,
      fontWeight: 600,
      textTransform: "uppercase" as const,
      letterSpacing: "0.04em",
      whiteSpace: "nowrap" as const,
    }}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function ProgressBar({ pct }: { pct: number }) {
  return (
    <div style={{
      background: "#1a1a2e", borderRadius: 4, height: 4,
      width: "100%", overflow: "hidden", marginTop: 6,
    }}>
      <div style={{
        width: `${Math.max(0, Math.min(100, pct))}%`,
        height: "100%",
        background: "linear-gradient(90deg, #00D4FF, #FF00AA)",
        borderRadius: 4,
        transition: "width 0.4s ease",
      }} />
    </div>
  );
}

// ── VideoJob Card ─────────────────────────────────────────────────────────────

function VideoJobCard({
  job,
  onClick,
}: {
  job: VideoJob;
  onClick: () => void;
}) {
  const colour = STATUS_COLOURS[job.status] ?? "#6b7280";
  
  // Get display title - use video_title, transcription excerpt, or fallback
  const displayTitle = job.video_title 
    || (job.transcription ? job.transcription.slice(0, 50) + "..." : null)
    || job.input_url;
  
  return (
    <div
      onClick={onClick}
      style={{
        background: "#0d0d1a",
        border: `1px solid ${colour}33`,
        borderRadius: 10,
        padding: 0,
        cursor: "pointer",
        transition: "border-color 0.15s, box-shadow 0.15s",
        overflow: "hidden",
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLDivElement).style.borderColor = colour + "88";
        (e.currentTarget as HTMLDivElement).style.boxShadow = `0 0 0 1px ${colour}22`;
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLDivElement).style.borderColor = colour + "33";
        (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
      }}
    >
      {/* Thumbnail */}
      {job.output_public_url ? (
        <div style={{
          height: 80,
          background: "#1a1a2e",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
        }}>
          <video
            src={job.output_public_url}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              opacity: 0.9,
            }}
            preload="metadata"
          />
          <div style={{
            position: "absolute",
            inset: 0,
            background: `linear-gradient(to bottom, transparent 60%, #0d0d1a 100%)`,
          }} />
          <div style={{
            position: "absolute",
            bottom: 6,
            right: 8,
            background: "rgba(0,0,0,0.7)",
            borderRadius: 4,
            padding: "2px 6px",
            fontSize: 10,
            color: "#9ca3af",
          }}>
            {job.duration_secs ? `${Math.round(job.duration_secs)}s` : "▶"}
          </div>
        </div>
      ) : (
        <div style={{
          height: 80,
          background: "#1a1a2e",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#4b5563",
          fontSize: 24,
        }}>
          🎬
        </div>
      )}

      {/* Content */}
      <div style={{ padding: "10px 12px" }}>
        {/* Title - truncated with ellipsis, tooltip on hover */}
        <div 
          style={{ 
            color: "white", 
            fontWeight: 600, 
            fontSize: 12, 
            marginBottom: 6, 
            lineHeight: 1.4,
            overflow: "hidden",
            textOverflow: "ellipsis",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            minHeight: 34,
          }}
          title={displayTitle || undefined}
        >
          {displayTitle || "Untitled"}
        </div>

        {/* Meta row */}
        <div style={{ 
          display: "flex", 
          justifyContent: "space-between", 
          alignItems: "center",
          fontSize: 10,
          color: "#6b7280",
        }}>
          <span style={{ 
            overflow: "hidden", 
            textOverflow: "ellipsis", 
            whiteSpace: "nowrap",
            maxWidth: "60%",
          }}>
            {job.source}
          </span>
          <span>
            {new Date(job.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
          </span>
        </div>

        {/* Progress bar (only when processing) */}
        {PROCESSING_STATUSES.has(job.status) && job.progress_pct != null && (
          <ProgressBar pct={job.progress_pct} />
        )}
      </div>
    </div>
  );
}

// ── VideoJob Detail Modal ────────────────────────────────────────────────────

function VideoJobDetail({
  job,
  supabaseUrl,
  headers,
  onClose,
  onRefresh,
}: {
  job: VideoJob;
  supabaseUrl: string;
  headers: Record<string, string>;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [acting, setActing] = useState<"approve" | "reject" | null>(null);

  async function handleApprove() {
    setActing("approve");
    await fetch(`${supabaseUrl}/rest/v1/video_jobs?id=eq.${job.id}`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({ status: "approved" }),
    });
    onRefresh();
    setActing(null);
  }

  async function handleReject() {
    setActing("reject");
    await fetch(`${supabaseUrl}/rest/v1/video_jobs?id=eq.${job.id}`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({ status: "rejected" }),
    });
    onRefresh();
    setActing(null);
  }

  return (
    <div style={{
      position: "fixed" as const,
      inset: 0,
      background: "rgba(0,0,0,0.85)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 1000,
      padding: 20,
    }} onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "#0d0d1a",
          border: "1px solid #1f2937",
          borderRadius: 16,
          width: "min(800px, 100%)",
          maxHeight: "90vh",
          overflowY: "auto" as const,
          display: "flex",
          flexDirection: "column" as const,
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          padding: "20px 24px",
          borderBottom: "1px solid #1f2937",
          position: "sticky" as const,
          top: 0,
          background: "#0d0d1a",
          zIndex: 10,
        }}>
          <div style={{ flex: 1, minWidth: 0, paddingRight: 16 }}>
            <h3 style={{ margin: 0, color: "white", fontSize: 16, fontWeight: 700 }}>
              {job.video_title || "Video Job"}
            </h3>
            <div style={{ color: "#6b7280", fontSize: 11, marginTop: 4 }}>
              {job.source} · {job.input_type} · Created {new Date(job.created_at).toLocaleString("en-GB")}
            </div>
          </div>
          <button onClick={onClose} style={{
            background: "transparent", border: "none", color: "#6b7280",
            fontSize: 24, cursor: "pointer", lineHeight: 1, padding: 4,
          }}>✕</button>
        </div>

        {/* Video Player */}
        {job.output_public_url ? (
          <div style={{
            background: "#000",
            aspectRatio: "9/16",
            maxHeight: "50vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}>
            <video
              src={job.output_public_url}
              controls
              autoPlay
              style={{
                width: "100%",
                height: "100%",
                objectFit: "contain",
              }}
            />
          </div>
        ) : (
          <div style={{
            background: "#1a1a2e",
            aspectRatio: "9/16",
            maxHeight: "50vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#4b5563",
            fontSize: 48,
          }}>
            🎬
          </div>
        )}

        {/* Content */}
        <div style={{ padding: "20px 24px", flex: 1 }}>
          {/* Status + progress */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 8 }}>
              <StatusBadge status={job.status} />
              {job.progress_pct != null && job.progress_pct < 100 && (
                <span style={{ fontSize: 12, color: "#9ca3af" }}>{job.progress_pct}% complete</span>
              )}
              {job.duration_secs && (
                <span style={{ fontSize: 12, color: "#9ca3af" }}>· {Math.round(job.duration_secs)}s</span>
              )}
            </div>
            {job.progress_pct != null && job.progress_pct < 100 && <ProgressBar pct={job.progress_pct} />}
          </div>

          {/* Meta grid */}
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
            gap: "12px 20px", marginBottom: 20, fontSize: 12,
          }}>
            {[
              ["Job ID", job.id.slice(0, 8) + "…" + job.id.slice(-4)],
              ["Source", job.source],
              ["Target Ratio", job.target_ratio],
              ["Created", new Date(job.created_at).toLocaleString("en-GB")],
              ["Updated", new Date(job.updated_at).toLocaleString("en-GB")],
              ["File Size", job.file_size_bytes ? `${(job.file_size_bytes / 1024 / 1024).toFixed(1)} MB` : "—"],
            ].map(([k, v]) => (
              <div key={k as string}>
                <div style={{ color: "#6b7280", marginBottom: 2, fontSize: 10, textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>{k}</div>
                <div style={{ color: "#e5e7eb", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis" }}>{v}</div>
              </div>
            ))}
          </div>

          {/* Transcript */}
          {job.transcription && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ color: "#9ca3af", fontSize: 11, fontWeight: 600, marginBottom: 8, textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>
                Generated Caption / Transcript
              </div>
              <div style={{
                background: "#111827", borderRadius: 8, padding: "14px 16px",
                fontSize: 13, color: "#d1d5db", lineHeight: 1.6,
                maxHeight: 200, overflowY: "auto" as const,
              }}>
                {job.transcription}
              </div>
            </div>
          )}

          {/* Error */}
          {job.error_message && (
            <div style={{
              background: "#ef444411", border: "1px solid #ef444433",
              borderRadius: 8, padding: "12px 14px", marginBottom: 20,
              fontSize: 12, color: "#ef4444",
            }}>
              <strong>Error:</strong> {job.error_message}
            </div>
          )}

          {/* Actions */}
          {!["approved", "rejected", "failed", "published"].includes(job.status) && (
            <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
              <button
                onClick={handleApprove}
                disabled={acting !== null}
                style={{
                  flex: 1, background: "#05966922", border: "1px solid #059669",
                  color: "#10b981", borderRadius: 8, padding: "10px 0",
                  cursor: acting ? "not-allowed" : "pointer", fontWeight: 600, fontSize: 13,
                }}>
                {acting === "approve" ? "Approving…" : "✅ Approve for Publishing"}
              </button>
              <button
                onClick={handleReject}
                disabled={acting !== null}
                style={{
                  flex: 1, background: "#ef444411", border: "1px solid #ef4444",
                  color: "#ef4444", borderRadius: 8, padding: "10px 0",
                  cursor: acting ? "not-allowed" : "pointer", fontWeight: 600, fontSize: 13,
                }}>
                {acting === "reject" ? "Rejecting…" : "❌ Reject"}
              </button>
            </div>
          )}

          {/* Published state */}
          {job.status === "published" && job.output_public_url && (
            <div style={{
              background: "#05966911", border: "1px solid #05966944",
              borderRadius: 8, padding: "14px 16px", marginTop: 8,
              display: "flex", alignItems: "center", gap: 12,
            }}>
              <span style={{ fontSize: 20 }}>🚀</span>
              <div>
                <div style={{ color: "#10b981", fontWeight: 600, fontSize: 13 }}>Published</div>
                <a href={job.output_public_url} target="_blank" rel="noreferrer"
                  style={{ color: "#00D4FF", fontSize: 12, wordBreak: "break-all" as const }}>
                  View published video
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Kanban Board ──────────────────────────────────────────────────────────────

function KanbanBoard({
  jobs,
  supabaseUrl,
  headers,
  onRefresh,
}: {
  jobs: VideoJob[];
  supabaseUrl: string;
  headers: Record<string, string>;
  onRefresh: () => void;
}) {
  const [selected, setSelected] = useState<VideoJob | null>(null);

  // Group jobs by normalised kanban column
  const grouped: Record<string, VideoJob[]> = {};
  for (const col of KANBAN_COLS_A) grouped[col.key] = [];
  for (const job of jobs) {
    const col = normaliseKanbanCol(job.status);
    if (grouped[col]) grouped[col].push(job);
    else grouped["queued"].push(job);
  }

  return (
    <>
      <div style={{
        display: "grid",
        gridTemplateColumns: `repeat(${KANBAN_COLS_A.length}, minmax(200px, 1fr))`,
        gap: 12,
        overflowX: "auto" as const,
      }}>
        {KANBAN_COLS_A.map(col => {
          const colJobs = grouped[col.key] ?? [];
          const colour = STATUS_COLOURS[col.key] ?? "#6b7280";
          return (
            <div key={col.key} style={{
              background: "#0a0a14",
              border: `1px solid ${colour}22`,
              borderRadius: 12,
              padding: "12px 10px",
              minHeight: 120,
            }}>
              {/* Column header */}
              <div style={{
                display: "flex", justifyContent: "space-between",
                alignItems: "center", marginBottom: 12,
              }}>
                <span style={{ color: colour, fontWeight: 700, fontSize: 13 }}>
                  {col.emoji} {col.label}
                </span>
                <span style={{
                  background: colour + "22", color: colour,
                  borderRadius: 10, padding: "1px 7px", fontSize: 11, fontWeight: 700,
                }}>
                  {colJobs.length}
                </span>
              </div>

              {/* Cards */}
              <div style={{ display: "flex", flexDirection: "column" as const, gap: 8 }}>
                {colJobs.length === 0 && (
                  <div style={{ color: "#374151", fontSize: 12, textAlign: "center" as const, padding: "20px 0" }}>
                    Empty
                  </div>
                )}
                {colJobs.map(job => (
                  <VideoJobCard key={job.id} job={job} onClick={() => setSelected(job)} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Detail panel */}
      {selected && (
        <VideoJobDetail
          job={selected}
          supabaseUrl={supabaseUrl}
          headers={headers}
          onClose={() => setSelected(null)}
          onRefresh={() => { onRefresh(); setSelected(null); }}
        />
      )}
    </>
  );
}

// ── ClientJob List (Pipeline B) ───────────────────────────────────────────────

function ClientJobList({
  jobs,
  supabaseUrl,
  headers,
  onRefresh,
}: {
  jobs: ClientJob[];
  supabaseUrl: string;
  headers: Record<string, string>;
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [acting, setActing] = useState<{ id: string; action: "approve" | "reject" } | null>(null);

  async function handleAction(jobId: string, action: "approve" | "reject") {
    setActing({ id: jobId, action });
    await fetch(`${supabaseUrl}/rest/v1/client_jobs?id=eq.${jobId}`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({
        approval_status: action === "approve" ? "approved" : "rejected",
        status: action === "approve" ? "approved" : "rejected",
      }),
    });
    onRefresh();
    setActing(null);
  }

  if (jobs.length === 0) {
    return (
      <div style={{ color: "#4b5563", textAlign: "center" as const, padding: "48px 0", fontSize: 14 }}>
        No client jobs yet
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column" as const, gap: 10 }}>
      {jobs.map(job => {
        const isExpanded = expanded === job.id;
        const colour = STATUS_COLOURS[job.status] ?? "#6b7280";
        return (
          <div key={job.id} style={{
            background: "#0d0d1a",
            border: `1px solid ${colour}33`,
            borderRadius: 12,
            overflow: "hidden" as const,
          }}>
            {/* Card header — always visible */}
            <div
              onClick={() => setExpanded(isExpanded ? null : job.id)}
              style={{
                padding: "14px 18px",
                cursor: "pointer",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 12,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: "white", fontWeight: 600, fontSize: 14, marginBottom: 3 }}>
                  {job.description?.slice(0, 80) || "No description"}
                  {(job.description?.length ?? 0) > 80 ? "…" : ""}
                </div>
                <div style={{ color: "#6b7280", fontSize: 11 }}>
                  {job.from_number} · {new Date(job.created_at).toLocaleString("en-GB", {
                    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                  })}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column" as const, alignItems: "flex-end", gap: 6 }}>
                <StatusBadge status={job.status} />
                <span style={{ fontSize: 11, color: "#4b5563" }}>
                  music: {job.music_override ?? "auto"}
                </span>
              </div>
            </div>

            {/* Progress */}
            {job.progress_pct != null && job.progress_pct < 100 && (
              <div style={{ padding: "0 18px 10px" }}>
                <ProgressBar pct={job.progress_pct} />
              </div>
            )}

            {/* Expanded detail */}
            {isExpanded && (
              <div style={{
                borderTop: "1px solid #1f2937",
                padding: "16px 18px",
                background: "#0a0a14",
              }}>
                {/* Transcript / social copy */}
                {job.social_copy && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ color: "#9ca3af", fontSize: 11, fontWeight: 600, marginBottom: 6 }}>
                      SOCIAL COPY
                    </div>
                    <div style={{
                      background: "#111827", borderRadius: 8,
                      padding: "10px 14px", fontSize: 13, color: "#d1d5db", lineHeight: 1.5,
                    }}>
                      {job.social_copy}
                      {job.hashtags && (
                        <div style={{ color: "#00D4FF", marginTop: 6, fontSize: 12 }}>
                          {job.hashtags}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Meta */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px", fontSize: 12, marginBottom: 14 }}>
                  {[
                    ["Job ID", job.id.slice(0, 16) + "…"],
                    ["Chat ID", job.telegram_chat_id?.toString() ?? "—"],
                    ["Approval", job.approval_status ?? "pending"],
                    ["Updated", new Date(job.updated_at).toLocaleString("en-GB")],
                  ].map(([k, v]) => (
                    <div key={k as string}>
                      <div style={{ color: "#6b7280", marginBottom: 2 }}>{k}</div>
                      <div style={{ color: "#e5e7eb" }}>{v}</div>
                    </div>
                  ))}
                </div>

                {/* Approve / Reject */}
                {job.status === "preview_sent" && job.approval_status === "pending" && (
                  <div style={{ display: "flex", gap: 10 }}>
                    <button
                      onClick={() => handleAction(job.id, "approve")}
                      disabled={acting !== null}
                      style={{
                        flex: 1, background: "#05966922", border: "1px solid #059669",
                        color: "#10b981", borderRadius: 8, padding: "8px 0",
                        cursor: acting ? "not-allowed" : "pointer", fontWeight: 600, fontSize: 13,
                      }}>
                      {acting?.id === job.id && acting.action === "approve" ? "Approving…" : "✅ Approve"}
                    </button>
                    <button
                      onClick={() => handleAction(job.id, "reject")}
                      disabled={acting !== null}
                      style={{
                        flex: 1, background: "#ef444411", border: "1px solid #ef4444",
                        color: "#ef4444", borderRadius: 8, padding: "8px 0",
                        cursor: acting ? "not-allowed" : "pointer", fontWeight: 600, fontSize: 13,
                      }}>
                      {acting?.id === job.id && acting.action === "reject" ? "Rejecting…" : "❌ Reject"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function VideoMedia({
  supabaseUrl,
  supabaseKey,
}: {
  supabaseUrl: string;
  supabaseKey: string;
}) {
  const [videoJobs, setVideoJobs] = useState<VideoJob[]>([]);
  const [clientJobs, setClientJobs] = useState<ClientJob[]>([]);
  const [tab, setTab] = useState<"kanban" | "client" | "brands">("kanban");
  const [lastPoll, setLastPoll] = useState<Date | null>(null);
  const [pollError, setPollError] = useState(false);

  const headers: Record<string, string> = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    "Content-Type": "application/json",
  };

  const fetchVideoJobs = useCallback(async () => {
    try {
      const r = await fetch(
        `${supabaseUrl}/rest/v1/video_jobs?order=created_at.desc&limit=100`,
        { headers }
      );
      if (r.ok) {
        setVideoJobs(await r.json());
        setLastPoll(new Date());
        setPollError(false);
      } else {
        setPollError(true);
      }
    } catch {
      setPollError(true);
    }
  }, [supabaseUrl, supabaseKey]);

  const fetchClientJobs = useCallback(async () => {
    try {
      const r = await fetch(
        `${supabaseUrl}/rest/v1/client_jobs?order=created_at.desc&limit=100`,
        { headers }
      );
      if (r.ok) setClientJobs(await r.json());
    } catch {
      // silent
    }
  }, [supabaseUrl, supabaseKey]);

  const refreshAll = useCallback(() => {
    fetchVideoJobs();
    fetchClientJobs();
  }, [fetchVideoJobs, fetchClientJobs]);

  useEffect(() => {
    refreshAll();
    // 5s polling
    const t = setInterval(refreshAll, 5000);
    return () => clearInterval(t);
  }, [refreshAll]);

  // Stats
  const vjActive = videoJobs.filter(j => PROCESSING_STATUSES.has(j.status) || j.status === "queued").length;
  const vjApproved = videoJobs.filter(j => j.status === "approved" || j.status === "done").length;
  const vjFailed = videoJobs.filter(j => j.status === "failed").length;
  const cjPending = clientJobs.filter(j => j.status === "preview_sent" && j.approval_status === "pending").length;

  return (
    <div style={{ padding: "0 0 48px 0" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: 24, fontWeight: 700, color: "#00D4FF", margin: 0 }}>
            🎬 Video Pipeline
          </h2>
          <p style={{ color: "#6b7280", fontSize: 13, marginTop: 4, margin: 0 }}>
            Pipeline A (YouTube → Kanban) + Pipeline B (Client uploads) · 5s live polling
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {pollError && (
            <span style={{ fontSize: 11, color: "#ef4444" }}>⚠ Poll error</span>
          )}
          {lastPoll && (
            <span style={{ fontSize: 11, color: "#4b5563" }}>
              ↻ {lastPoll.toLocaleTimeString("en-GB")}
            </span>
          )}
          <button
            onClick={refreshAll}
            style={{
              background: "transparent", border: "1px solid #1f2937",
              color: "#9ca3af", borderRadius: 6, padding: "4px 10px",
              cursor: "pointer", fontSize: 12,
            }}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginBottom: 24 }}>
        {[
          { label: "Total (A)", value: videoJobs.length, colour: "#00D4FF" },
          { label: "Active (A)", value: vjActive, colour: "#f59e0b" },
          { label: "Approved (A)", value: vjApproved, colour: "#059669" },
          { label: "Failed (A)", value: vjFailed, colour: "#ef4444" },
          { label: "Awaiting ✅ (B)", value: cjPending, colour: "#06b6d4" },
        ].map(s => (
          <div key={s.label} style={{
            background: "#0d0d1a",
            border: `1px solid ${s.colour}33`,
            borderRadius: 10,
            padding: "12px 14px",
          }}>
            <div style={{ fontSize: 26, fontWeight: 700, color: s.colour }}>{s.value}</div>
            <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {([
          { key: "kanban", label: "📋 Kanban (Pipeline A)" },
          { key: "client", label: `📥 Client Uploads (${clientJobs.length})` },
          { key: "brands", label: "🎨 Brand Kits" },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            background: tab === t.key ? "#00D4FF22" : "transparent",
            border: `1px solid ${tab === t.key ? "#00D4FF" : "#1f2937"}`,
            color: tab === t.key ? "#00D4FF" : "#9ca3af",
            borderRadius: 8, padding: "6px 16px", cursor: "pointer",
            fontSize: 13, fontWeight: 600,
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Kanban (Pipeline A — video_jobs) ── */}
      {tab === "kanban" && (
        <KanbanBoard
          jobs={videoJobs}
          supabaseUrl={supabaseUrl}
          headers={headers}
          onRefresh={refreshAll}
        />
      )}

      {/* ── Client Uploads (Pipeline B — client_jobs) ── */}
      {tab === "client" && (
        <ClientJobList
          jobs={clientJobs}
          supabaseUrl={supabaseUrl}
          headers={headers}
          onRefresh={fetchClientJobs}
        />
      )}

      {/* ── Brand Kits ── */}
      {tab === "brands" && (
        <BrandKitInline supabaseUrl={supabaseUrl} headers={headers} />
      )}
    </div>
  );
}

// ── Inline Brand Kit Manager (kept here to avoid extra import) ────────────────

interface BrandKit {
  id: string;
  client_number: string;
  client_name: string;
  primary_colour: string;
  secondary_colour: string;
  instagram_handle: string;
  music_track: string;
  intro_outro_enabled: boolean;
  telegram_user_id: string | null;
}

function BrandKitInline({
  supabaseUrl,
  headers,
}: {
  supabaseUrl: string;
  headers: Record<string, string>;
}) {
  const [kits, setKits] = useState<BrandKit[]>([]);
  const [editing, setEditing] = useState<BrandKit | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`${supabaseUrl}/rest/v1/brand_kits?order=client_name.asc`, { headers })
      .then(r => r.ok ? r.json() : [])
      .then(setKits);
  }, []);

  async function save(kit: BrandKit) {
    setSaving(true);
    const { id, ...patch } = kit;
    await fetch(`${supabaseUrl}/rest/v1/brand_kits?id=eq.${id}`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify(patch),
    });
    const r = await fetch(`${supabaseUrl}/rest/v1/brand_kits?order=client_name.asc`, { headers });
    if (r.ok) setKits(await r.json());
    setEditing(null);
    setSaving(false);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column" as const, gap: 10 }}>
      {kits.map(kit => (
        <div key={kit.id} style={{
          background: "#0d0d1a", border: "1px solid #1f2937",
          borderRadius: 12, padding: "14px 18px",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <div>
            <div style={{ color: "white", fontWeight: 600, fontSize: 14 }}>{kit.client_name}</div>
            <div style={{ color: "#6b7280", fontSize: 12 }}>{kit.client_number} · {kit.instagram_handle}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 20, height: 20, borderRadius: "50%",
              background: kit.primary_colour, border: "2px solid #374151",
            }} />
            <button onClick={() => setEditing({ ...kit })} style={{
              background: "#1f2937", border: "1px solid #374151",
              color: "#9ca3af", borderRadius: 6, padding: "4px 12px",
              cursor: "pointer", fontSize: 12,
            }}>Edit</button>
          </div>
        </div>
      ))}

      {editing && (
        <div style={{
          position: "fixed" as const, inset: 0,
          background: "rgba(0,0,0,0.75)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
        }} onClick={() => setEditing(null)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: "#0d0d1a", border: "1px solid #1f2937",
            borderRadius: 16, padding: "28px 32px", width: "min(480px, 95vw)",
          }}>
            <h3 style={{ margin: "0 0 20px", color: "#00D4FF" }}>Edit Brand Kit</h3>
            {(["client_name", "client_number", "instagram_handle", "primary_colour", "secondary_colour", "music_track"] as const).map(field => (
              <div key={field} style={{ marginBottom: 12 }}>
                <label style={{ display: "block", color: "#9ca3af", fontSize: 12, marginBottom: 4 }}>
                  {field.replace(/_/g, " ").toUpperCase()}
                </label>
                <input
                  value={(editing as any)[field] ?? ""}
                  onChange={e => setEditing({ ...editing, [field]: e.target.value })}
                  style={{
                    width: "100%", background: "#111827", border: "1px solid #374151",
                    color: "white", borderRadius: 6, padding: "6px 10px",
                    fontSize: 13, boxSizing: "border-box" as const,
                  }}
                />
              </div>
            ))}
            <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
              <input
                type="checkbox"
                id="ioe"
                checked={editing.intro_outro_enabled}
                onChange={e => setEditing({ ...editing, intro_outro_enabled: e.target.checked })}
              />
              <label htmlFor="ioe" style={{ color: "#9ca3af", fontSize: 13 }}>
                Intro/Outro Enabled
              </label>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => save(editing)} disabled={saving} style={{
                flex: 1, background: "#00D4FF22", border: "1px solid #00D4FF",
                color: "#00D4FF", borderRadius: 8, padding: "8px 0",
                cursor: saving ? "not-allowed" : "pointer", fontWeight: 600, fontSize: 13,
              }}>
                {saving ? "Saving…" : "Save"}
              </button>
              <button onClick={() => setEditing(null)} style={{
                flex: 1, background: "transparent", border: "1px solid #374151",
                color: "#9ca3af", borderRadius: 8, padding: "8px 0",
                cursor: "pointer", fontSize: 13,
              }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
