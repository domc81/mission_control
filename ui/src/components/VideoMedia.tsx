import { useState, useEffect } from "react";

interface ClientJob {
  id: string;
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

interface MusicTrack {
  id: string;
  track_key: string;
  display_name: string;
  mood: string;
}

const STATUS_COLOURS: Record<string, string> = {
  pending:       "#6b7280",
  downloading:   "#3b82f6",
  transcoding:   "#3b82f6",
  reframing:     "#8b5cf6",
  transcribing:  "#8b5cf6",
  captioning:    "#f59e0b",
  branding:      "#f59e0b",
  processing:    "#f59e0b",
  uploading:     "#10b981",
  preview_sent:  "#10b981",
  approved:      "#059669",
  rejected:      "#ef4444",
  failed:        "#ef4444",
};

function StatusBadge({ status }: { status: string }) {
  const colour = STATUS_COLOURS[status] ?? "#6b7280";
  return (
    <span style={{
      background: colour + "22",
      color: colour,
      border: `1px solid ${colour}44`,
      borderRadius: 6,
      padding: "2px 8px",
      fontSize: 12,
      fontWeight: 600,
      textTransform: "uppercase",
      letterSpacing: "0.05em",
    }}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function ProgressBar({ pct }: { pct: number }) {
  return (
    <div style={{ background: "#1a1a2e", borderRadius: 4, height: 4, width: "100%", overflow: "hidden" }}>
      <div style={{
        width: `${pct}%`,
        height: "100%",
        background: "linear-gradient(90deg, #00D4FF, #FF00AA)",
        borderRadius: 4,
        transition: "width 0.4s ease",
      }} />
    </div>
  );
}

export function VideoMedia({ supabaseUrl, supabaseKey }: { supabaseUrl: string; supabaseKey: string }) {
  const [jobs, setJobs] = useState<ClientJob[]>([]);
  const [brandKits, setBrandKits] = useState<BrandKit[]>([]);
  const [musicTracks, setMusicTracks] = useState<MusicTrack[]>([]);
  const [tab, setTab] = useState<"jobs" | "brands">("jobs");
  const [editingKit, setEditingKit] = useState<BrandKit | null>(null);
  const [saving, setSaving] = useState(false);
  const [jobFilter, setJobFilter] = useState<"all" | "active" | "approved" | "failed">("all");

  const headers = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    "Content-Type": "application/json",
  };

  async function fetchJobs() {
    const r = await fetch(
      `${supabaseUrl}/rest/v1/client_jobs?order=created_at.desc&limit=50`,
      { headers }
    );
    if (r.ok) setJobs(await r.json());
  }

  async function fetchBrandKits() {
    const r = await fetch(`${supabaseUrl}/rest/v1/brand_kits?order=client_name.asc`, { headers });
    if (r.ok) setBrandKits(await r.json());
  }

  async function fetchMusicTracks() {
    const r = await fetch(`${supabaseUrl}/rest/v1/music_tracks?order=mood.asc`, { headers });
    if (r.ok) setMusicTracks(await r.json());
  }

  useEffect(() => {
    fetchJobs();
    fetchBrandKits();
    fetchMusicTracks();
    const t = setInterval(fetchJobs, 5000);
    return () => clearInterval(t);
  }, []);

  async function saveBrandKit(kit: BrandKit) {
    setSaving(true);
    const { id, created_at, ...patch } = kit as any;
    const r = await fetch(
      `${supabaseUrl}/rest/v1/brand_kits?id=eq.${kit.id}`,
      { method: "PATCH", headers: { ...headers, Prefer: "return=representation" }, body: JSON.stringify(patch) }
    );
    if (r.ok) {
      await fetchBrandKits();
      setEditingKit(null);
    }
    setSaving(false);
  }

  const filteredJobs = jobs.filter(j => {
    if (jobFilter === "active") return !["approved", "rejected", "failed", "preview_sent"].includes(j.status);
    if (jobFilter === "approved") return j.approval_status === "approved";
    if (jobFilter === "failed") return j.status === "failed";
    return true;
  });

  const activeCount = jobs.filter(j => !["approved", "rejected", "failed", "preview_sent"].includes(j.status)).length;

  return (
    <div style={{ padding: "0 0 40px 0" }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 24, fontWeight: 700, color: "#00D4FF", margin: 0 }}>
          🎬 Video & Media
        </h2>
        <p style={{ color: "#6b7280", fontSize: 14, marginTop: 4 }}>
          Pipeline B — client video processing, brand kits, approval queue
        </p>
      </div>

      {/* Stats row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
        {[
          { label: "Total Jobs", value: jobs.length, colour: "#00D4FF" },
          { label: "Active", value: activeCount, colour: "#f59e0b" },
          { label: "Approved", value: jobs.filter(j => j.approval_status === "approved").length, colour: "#10b981" },
          { label: "Failed", value: jobs.filter(j => j.status === "failed").length, colour: "#ef4444" },
        ].map(s => (
          <div key={s.label} style={{
            background: "#0d0d1a",
            border: `1px solid ${s.colour}33`,
            borderRadius: 10,
            padding: "14px 18px",
          }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: s.colour }}>{s.value}</div>
            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {(["jobs", "brands"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            background: tab === t ? "#00D4FF22" : "transparent",
            border: `1px solid ${tab === t ? "#00D4FF" : "#1f2937"}`,
            color: tab === t ? "#00D4FF" : "#9ca3af",
            borderRadius: 8, padding: "6px 16px", cursor: "pointer",
            fontSize: 13, fontWeight: 600, textTransform: "capitalize",
          }}>
            {t === "jobs" ? "🎬 Job Queue" : "🎨 Brand Kits"}
          </button>
        ))}
      </div>

      {/* ── Job Queue ── */}
      {tab === "jobs" && (
        <div>
          {/* Filter bar */}
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            {(["all", "active", "approved", "failed"] as const).map(f => (
              <button key={f} onClick={() => setJobFilter(f)} style={{
                background: jobFilter === f ? "#1f2937" : "transparent",
                border: `1px solid ${jobFilter === f ? "#374151" : "#1f2937"}`,
                color: jobFilter === f ? "white" : "#6b7280",
                borderRadius: 6, padding: "4px 12px", cursor: "pointer",
                fontSize: 12, textTransform: "capitalize",
              }}>
                {f}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {filteredJobs.length === 0 && (
              <div style={{ color: "#4b5563", textAlign: "center", padding: "40px 0" }}>
                No jobs found
              </div>
            )}
            {filteredJobs.map(job => (
              <div key={job.id} style={{
                background: "#0d0d1a",
                border: "1px solid #1f2937",
                borderRadius: 12,
                padding: "16px 20px",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <div>
                    <div style={{ color: "white", fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
                      {job.description?.slice(0, 80) || "No description"}
                    </div>
                    <div style={{ color: "#6b7280", fontSize: 11, fontFamily: "monospace" }}>
                      {job.id.slice(0, 8)}… · {new Date(job.created_at).toLocaleString("en-GB")}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontSize: 11, color: "#6b7280" }}>
                      music: <span style={{ color: "#9ca3af" }}>{job.music_override ?? "auto"}</span>
                    </span>
                    <StatusBadge status={job.status} />
                  </div>
                </div>

                {job.progress_pct !== null && job.progress_pct < 100 && (
                  <div style={{ marginBottom: 8 }}>
                    <ProgressBar pct={job.progress_pct ?? 0} />
                  </div>
                )}

                {job.social_copy && (
                  <div style={{
                    background: "#111827",
                    borderRadius: 8,
                    padding: "10px 14px",
                    marginTop: 10,
                    fontSize: 13,
                    color: "#d1d5db",
                    lineHeight: 1.5,
                  }}>
                    <div style={{ marginBottom: 4 }}>{job.social_copy}</div>
                    {job.hashtags && (
                      <div style={{ color: "#00D4FF", fontSize: 12 }}>{job.hashtags}</div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Brand Kits ── */}
      {tab === "brands" && (
        <div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {brandKits.map(kit => (
              <div key={kit.id} style={{
                background: "#0d0d1a",
                border: "1px solid #1f2937",
                borderRadius: 12,
                padding: "16px 20px",
              }}>
                {editingKit?.id === kit.id ? (
                  /* Edit form */
                  <div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                      {[
                        { key: "client_name", label: "Client Name" },
                        { key: "instagram_handle", label: "Instagram Handle" },
                        { key: "primary_colour", label: "Primary Colour" },
                        { key: "secondary_colour", label: "Secondary Colour" },
                        { key: "client_number", label: "Phone Number" },
                      ].map(({ key, label }) => (
                        <div key={key}>
                          <label style={{ fontSize: 11, color: "#6b7280", display: "block", marginBottom: 4 }}>
                            {label}
                          </label>
                          <input
                            value={(editingKit as any)[key] ?? ""}
                            onChange={e => setEditingKit({ ...editingKit, [key]: e.target.value } as BrandKit)}
                            style={{
                              background: "#111827", border: "1px solid #374151",
                              borderRadius: 6, padding: "6px 10px", color: "white",
                              fontSize: 13, width: "100%", boxSizing: "border-box",
                            }}
                          />
                        </div>
                      ))}
                      <div>
                        <label style={{ fontSize: 11, color: "#6b7280", display: "block", marginBottom: 4 }}>
                          Music Track
                        </label>
                        <select
                          value={editingKit.music_track ?? "upbeat_1"}
                          onChange={e => setEditingKit({ ...editingKit, music_track: e.target.value })}
                          style={{
                            background: "#111827", border: "1px solid #374151",
                            borderRadius: 6, padding: "6px 10px", color: "white",
                            fontSize: 13, width: "100%",
                          }}
                        >
                          {musicTracks.map(t => (
                            <option key={t.track_key} value={t.track_key}>
                              {t.display_name} ({t.mood})
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => saveBrandKit(editingKit)} disabled={saving} style={{
                        background: "#00D4FF22", border: "1px solid #00D4FF",
                        color: "#00D4FF", borderRadius: 6, padding: "6px 16px",
                        cursor: "pointer", fontSize: 13, fontWeight: 600,
                      }}>
                        {saving ? "Saving…" : "Save"}
                      </button>
                      <button onClick={() => setEditingKit(null)} style={{
                        background: "transparent", border: "1px solid #374151",
                        color: "#9ca3af", borderRadius: 6, padding: "6px 16px",
                        cursor: "pointer", fontSize: 13,
                      }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  /* View row */
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                      {/* Colour swatches */}
                      <div style={{ display: "flex", gap: 6 }}>
                        <div style={{
                          width: 28, height: 28, borderRadius: 6,
                          background: kit.primary_colour, border: "1px solid #374151",
                          title: kit.primary_colour,
                        }} title={kit.primary_colour} />
                        <div style={{
                          width: 28, height: 28, borderRadius: 6,
                          background: kit.secondary_colour ?? "#FF00AA", border: "1px solid #374151",
                        }} title={kit.secondary_colour ?? ""} />
                      </div>
                      <div>
                        <div style={{ color: "white", fontWeight: 600, fontSize: 14 }}>
                          {kit.client_name}
                        </div>
                        <div style={{ color: "#6b7280", fontSize: 12, marginTop: 2 }}>
                          {kit.instagram_handle} · {kit.client_number}
                          {kit.telegram_user_id && ` · TG:${kit.telegram_user_id}`}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ fontSize: 12, color: "#9ca3af" }}>
                        🎵 {musicTracks.find(t => t.track_key === kit.music_track)?.display_name ?? kit.music_track}
                      </span>
                      <span style={{
                        fontSize: 11, color: kit.intro_outro_enabled ? "#10b981" : "#6b7280",
                      }}>
                        {kit.intro_outro_enabled ? "✅ Intro/outro" : "⬜ No cards"}
                      </span>
                      <button onClick={() => setEditingKit(kit)} style={{
                        background: "transparent", border: "1px solid #374151",
                        color: "#9ca3af", borderRadius: 6, padding: "4px 12px",
                        cursor: "pointer", fontSize: 12,
                      }}>
                        Edit
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
