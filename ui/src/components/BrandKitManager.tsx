/**
 * BrandKitManager — VP-4
 * Full CRUD UI for the brand_kits Supabase table.
 * Wired into App.tsx as a sub-tab under the Video nav section.
 *
 * Props: supabaseUrl + supabaseKey (same pattern as VideoMedia)
 */
import { useState, useEffect, useCallback } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface BrandKit {
  id: string;
  created_at?: string;
  client_name: string;
  client_number: string;
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

const EMPTY_KIT: Omit<BrandKit, "id" | "created_at"> = {
  client_name: "",
  client_number: "",
  primary_colour: "#00D4FF",
  secondary_colour: "#FF00AA",
  instagram_handle: "@",
  music_track: "upbeat_1",
  intro_outro_enabled: true,
  telegram_user_id: null,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function ColourSwatch({ colour, size = 20 }: { colour: string; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: colour, border: "2px solid #374151",
      flexShrink: 0,
    }} title={colour} />
  );
}

function Field({
  label, children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{
        display: "block", color: "#9ca3af",
        fontSize: 11, fontWeight: 600, marginBottom: 5,
        textTransform: "uppercase" as const, letterSpacing: "0.06em",
      }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "#111827",
  border: "1px solid #374151",
  color: "white",
  borderRadius: 7,
  padding: "7px 11px",
  fontSize: 13,
  boxSizing: "border-box",
  outline: "none",
};

// ── Edit / Create Modal ───────────────────────────────────────────────────────

function BrandKitModal({
  kit,
  musicTracks,
  onSave,
  onClose,
  saving,
}: {
  kit: Partial<BrandKit> & { id?: string };
  musicTracks: MusicTrack[];
  onSave: (kit: Partial<BrandKit> & { id?: string }) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<Partial<BrandKit> & { id?: string }>(kit);
  const isNew = !kit.id;

  const set = (field: keyof BrandKit, value: unknown) =>
    setForm(f => ({ ...f, [field]: value }));

  return (
    <div
      style={{
        position: "fixed" as const, inset: 0,
        background: "rgba(0,0,0,0.8)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "#0d0d1a",
          border: "1px solid #1f2937",
          borderRadius: 16,
          padding: "28px 32px",
          width: "min(520px, 95vw)",
          maxHeight: "90vh",
          overflowY: "auto" as const,
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
          <h3 style={{ margin: 0, color: "#00D4FF", fontSize: 18, fontWeight: 700 }}>
            {isNew ? "➕ New Brand Kit" : `✏️ Edit — ${form.client_name || "Brand Kit"}`}
          </h3>
          <button onClick={onClose} style={{
            background: "transparent", border: "none",
            color: "#6b7280", fontSize: 20, cursor: "pointer",
          }}>✕</button>
        </div>

        {/* Form fields */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
          <div style={{ gridColumn: "1 / -1" }}>
            <Field label="Client Name">
              <input
                style={inputStyle}
                value={form.client_name ?? ""}
                onChange={e => set("client_name", e.target.value)}
                placeholder="DC81"
                autoFocus
              />
            </Field>
          </div>

          <Field label="Client Number / Phone">
            <input
              style={inputStyle}
              value={form.client_number ?? ""}
              onChange={e => set("client_number", e.target.value)}
              placeholder="+447700000000"
            />
          </Field>

          <Field label="Instagram Handle">
            <input
              style={inputStyle}
              value={form.instagram_handle ?? ""}
              onChange={e => set("instagram_handle", e.target.value)}
              placeholder="@dc81.io"
            />
          </Field>

          <Field label="Primary Colour">
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="color"
                value={form.primary_colour ?? "#00D4FF"}
                onChange={e => set("primary_colour", e.target.value)}
                style={{ width: 40, height: 32, border: "none", borderRadius: 4, cursor: "pointer", background: "none" }}
              />
              <input
                style={{ ...inputStyle, flex: 1 }}
                value={form.primary_colour ?? ""}
                onChange={e => set("primary_colour", e.target.value)}
                placeholder="#00D4FF"
              />
            </div>
          </Field>

          <Field label="Secondary Colour">
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="color"
                value={form.secondary_colour ?? "#FF00AA"}
                onChange={e => set("secondary_colour", e.target.value)}
                style={{ width: 40, height: 32, border: "none", borderRadius: 4, cursor: "pointer", background: "none" }}
              />
              <input
                style={{ ...inputStyle, flex: 1 }}
                value={form.secondary_colour ?? ""}
                onChange={e => set("secondary_colour", e.target.value)}
                placeholder="#FF00AA"
              />
            </div>
          </Field>

          <Field label="Music Track">
            <select
              style={{ ...inputStyle }}
              value={form.music_track ?? "upbeat_1"}
              onChange={e => set("music_track", e.target.value)}
            >
              {musicTracks.length === 0 && (
                <option value={form.music_track ?? "upbeat_1"}>
                  {form.music_track ?? "upbeat_1"}
                </option>
              )}
              {musicTracks.map(mt => (
                <option key={mt.track_key} value={mt.track_key}>
                  {mt.display_name} ({mt.mood})
                </option>
              ))}
            </select>
          </Field>

          <Field label="Telegram User ID">
            <input
              style={inputStyle}
              value={form.telegram_user_id ?? ""}
              onChange={e => set("telegram_user_id", e.target.value || null)}
              placeholder="Optional"
            />
          </Field>

          <div style={{ gridColumn: "1 / -1" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={form.intro_outro_enabled ?? true}
                onChange={e => set("intro_outro_enabled", e.target.checked)}
                style={{ width: 16, height: 16, accentColor: "#00D4FF" }}
              />
              <span style={{ color: "#d1d5db", fontSize: 13 }}>
                Enable intro / outro cards
              </span>
            </label>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
          <button
            onClick={() => onSave(form)}
            disabled={saving || !form.client_name?.trim()}
            style={{
              flex: 1,
              background: saving ? "#1f2937" : "#00D4FF22",
              border: `1px solid ${saving ? "#374151" : "#00D4FF"}`,
              color: saving ? "#6b7280" : "#00D4FF",
              borderRadius: 8, padding: "9px 0",
              cursor: saving || !form.client_name?.trim() ? "not-allowed" : "pointer",
              fontWeight: 700, fontSize: 14,
              transition: "all 0.15s",
            }}
          >
            {saving ? "Saving…" : isNew ? "Create Brand Kit" : "Save Changes"}
          </button>
          <button
            onClick={onClose}
            style={{
              background: "transparent", border: "1px solid #374151",
              color: "#9ca3af", borderRadius: 8, padding: "9px 18px",
              cursor: "pointer", fontSize: 14,
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Delete Confirm Dialog ─────────────────────────────────────────────────────

function DeleteConfirm({
  kit,
  onConfirm,
  onCancel,
  deleting,
}: {
  kit: BrandKit;
  onConfirm: () => void;
  onCancel: () => void;
  deleting: boolean;
}) {
  return (
    <div style={{
      position: "fixed" as const, inset: 0,
      background: "rgba(0,0,0,0.8)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 1010,
    }}>
      <div style={{
        background: "#0d0d1a",
        border: "1px solid #ef444433",
        borderRadius: 14,
        padding: "28px 32px",
        width: "min(400px, 90vw)",
        textAlign: "center" as const,
      }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>🗑️</div>
        <h3 style={{ color: "#ef4444", margin: "0 0 10px", fontSize: 17 }}>
          Delete Brand Kit?
        </h3>
        <p style={{ color: "#9ca3af", fontSize: 13, margin: "0 0 22px" }}>
          This will permanently remove <strong style={{ color: "white" }}>{kit.client_name}</strong>.
          This cannot be undone.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          <button
            onClick={onConfirm}
            disabled={deleting}
            style={{
              background: "#ef444422", border: "1px solid #ef4444",
              color: "#ef4444", borderRadius: 8, padding: "8px 22px",
              cursor: deleting ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 13,
            }}
          >
            {deleting ? "Deleting…" : "Yes, Delete"}
          </button>
          <button onClick={onCancel} style={{
            background: "transparent", border: "1px solid #374151",
            color: "#9ca3af", borderRadius: 8, padding: "8px 22px",
            cursor: "pointer", fontSize: 13,
          }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function BrandKitManager({
  supabaseUrl,
  supabaseKey,
}: {
  supabaseUrl: string;
  supabaseKey: string;
}) {
  const [kits, setKits] = useState<BrandKit[]>([]);
  const [musicTracks, setMusicTracks] = useState<MusicTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal state
  const [editTarget, setEditTarget] = useState<(Partial<BrandKit> & { id?: string }) | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BrandKit | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const headers: Record<string, string> = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };

  // ── Fetch ───────────────────────────────────────────────────────────────────

  const fetchKits = useCallback(async () => {
    try {
      const r = await fetch(
        `${supabaseUrl}/rest/v1/brand_kits?order=client_name.asc`,
        { headers }
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setKits(await r.json());
      setError(null);
    } catch (e) {
      setError(`Failed to load brand kits: ${e}`);
    } finally {
      setLoading(false);
    }
  }, [supabaseUrl, supabaseKey]);

  const fetchMusicTracks = useCallback(async () => {
    try {
      const r = await fetch(
        `${supabaseUrl}/rest/v1/music_tracks?order=mood.asc`,
        { headers }
      );
      if (r.ok) setMusicTracks(await r.json());
    } catch {
      // music tracks are optional; fail silently
    }
  }, [supabaseUrl, supabaseKey]);

  useEffect(() => {
    fetchKits();
    fetchMusicTracks();
  }, [fetchKits, fetchMusicTracks]);

  // ── CRUD ────────────────────────────────────────────────────────────────────

  async function handleSave(form: Partial<BrandKit> & { id?: string }) {
    setSaving(true);
    try {
      const { id, created_at, ...payload } = form as BrandKit;
      if (id) {
        // UPDATE
        const r = await fetch(
          `${supabaseUrl}/rest/v1/brand_kits?id=eq.${id}`,
          { method: "PATCH", headers, body: JSON.stringify(payload) }
        );
        if (!r.ok) throw new Error(await r.text());
      } else {
        // CREATE
        const r = await fetch(
          `${supabaseUrl}/rest/v1/brand_kits`,
          { method: "POST", headers, body: JSON.stringify(payload) }
        );
        if (!r.ok) throw new Error(await r.text());
      }
      await fetchKits();
      setEditTarget(null);
    } catch (e) {
      setError(`Save failed: ${e}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(kit: BrandKit) {
    setDeleting(true);
    try {
      const r = await fetch(
        `${supabaseUrl}/rest/v1/brand_kits?id=eq.${kit.id}`,
        { method: "DELETE", headers: { ...headers, Prefer: "return=minimal" } }
      );
      if (!r.ok) throw new Error(await r.text());
      await fetchKits();
      setDeleteTarget(null);
    } catch (e) {
      setError(`Delete failed: ${e}`);
    } finally {
      setDeleting(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: "0 0 48px" }}>

      {/* Header */}
      <div style={{
        display: "flex", justifyContent: "space-between",
        alignItems: "flex-start", marginBottom: 24,
      }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: "#00D4FF", margin: 0 }}>
            🎨 Brand Kit Manager
          </h2>
          <p style={{ color: "#6b7280", fontSize: 13, marginTop: 4, marginBottom: 0 }}>
            Manage client branding — colours, music, intro/outro, Instagram handle
          </p>
        </div>
        <button
          onClick={() => setEditTarget({ ...EMPTY_KIT })}
          style={{
            background: "#00D4FF22", border: "1px solid #00D4FF",
            color: "#00D4FF", borderRadius: 8, padding: "8px 18px",
            cursor: "pointer", fontWeight: 700, fontSize: 13,
            display: "flex", alignItems: "center", gap: 6,
          }}
        >
          ➕ New Brand Kit
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div style={{
          background: "#ef444411", border: "1px solid #ef444433",
          borderRadius: 8, padding: "10px 14px", marginBottom: 16,
          color: "#ef4444", fontSize: 13,
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={{
            background: "none", border: "none", color: "#ef4444",
            cursor: "pointer", fontSize: 16,
          }}>✕</button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ color: "#6b7280", textAlign: "center" as const, padding: "48px 0", fontSize: 14 }}>
          Loading brand kits…
        </div>
      )}

      {/* Empty state */}
      {!loading && kits.length === 0 && !error && (
        <div style={{
          color: "#4b5563", textAlign: "center" as const, padding: "60px 0", fontSize: 14,
          border: "1px dashed #1f2937", borderRadius: 12,
        }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🎨</div>
          <div>No brand kits yet.</div>
          <div style={{ marginTop: 4, fontSize: 12, color: "#374151" }}>
            Click <strong style={{ color: "#00D4FF" }}>New Brand Kit</strong> to create the first one.
          </div>
        </div>
      )}

      {/* Stats row */}
      {kits.length > 0 && (
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
          gap: 10, marginBottom: 20,
        }}>
          {[
            { label: "Total Kits", value: kits.length, colour: "#00D4FF" },
            {
              label: "Intro/Outro On",
              value: kits.filter(k => k.intro_outro_enabled).length,
              colour: "#10b981",
            },
            {
              label: "Telegram Linked",
              value: kits.filter(k => k.telegram_user_id).length,
              colour: "#8b5cf6",
            },
          ].map(s => (
            <div key={s.label} style={{
              background: "#0d0d1a", border: `1px solid ${s.colour}33`,
              borderRadius: 10, padding: "12px 14px",
            }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: s.colour }}>{s.value}</div>
              <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Kit cards grid */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
        gap: 14,
      }}>
        {kits.map(kit => (
          <div
            key={kit.id}
            style={{
              background: "#0d0d1a",
              border: "1px solid #1f2937",
              borderRadius: 14,
              overflow: "hidden" as const,
              transition: "border-color 0.15s",
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLDivElement).style.borderColor = "#374151";
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLDivElement).style.borderColor = "#1f2937";
            }}
          >
            {/* Colour bar */}
            <div style={{
              height: 6,
              background: `linear-gradient(90deg, ${kit.primary_colour}, ${kit.secondary_colour})`,
            }} />

            <div style={{ padding: "16px 18px" }}>
              {/* Name + handle */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                <div>
                  <div style={{ color: "white", fontWeight: 700, fontSize: 15 }}>
                    {kit.client_name}
                  </div>
                  <div style={{ color: "#00D4FF", fontSize: 12, marginTop: 2 }}>
                    {kit.instagram_handle}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <ColourSwatch colour={kit.primary_colour} />
                  <ColourSwatch colour={kit.secondary_colour} />
                </div>
              </div>

              {/* Details grid */}
              <div style={{
                display: "grid", gridTemplateColumns: "1fr 1fr",
                gap: "6px 12px", fontSize: 12, marginBottom: 14,
              }}>
                {[
                  ["Phone", kit.client_number || "—"],
                  ["Music", kit.music_track],
                  ["Intro/Outro", kit.intro_outro_enabled ? "✅ On" : "❌ Off"],
                  ["Telegram", kit.telegram_user_id ? `#${kit.telegram_user_id}` : "—"],
                ].map(([k, v]) => (
                  <div key={k as string}>
                    <div style={{ color: "#6b7280", marginBottom: 1 }}>{k}</div>
                    <div style={{ color: "#d1d5db" }}>{v}</div>
                  </div>
                ))}
              </div>

              {/* Actions */}
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => setEditTarget({ ...kit })}
                  style={{
                    flex: 1,
                    background: "#1f2937", border: "1px solid #374151",
                    color: "#d1d5db", borderRadius: 7, padding: "7px 0",
                    cursor: "pointer", fontSize: 12, fontWeight: 600,
                  }}
                >
                  ✏️ Edit
                </button>
                <button
                  onClick={() => setDeleteTarget(kit)}
                  style={{
                    background: "#ef444411", border: "1px solid #ef444433",
                    color: "#ef4444", borderRadius: 7, padding: "7px 12px",
                    cursor: "pointer", fontSize: 12,
                  }}
                >
                  🗑️
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Edit / Create modal */}
      {editTarget && (
        <BrandKitModal
          kit={editTarget}
          musicTracks={musicTracks}
          onSave={handleSave}
          onClose={() => setEditTarget(null)}
          saving={saving}
        />
      )}

      {/* Delete confirm */}
      {deleteTarget && (
        <DeleteConfirm
          kit={deleteTarget}
          onConfirm={() => handleDelete(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
          deleting={deleting}
        />
      )}
    </div>
  );
}

export default BrandKitManager;
