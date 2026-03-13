/**
 * BlogManager.tsx — Phase 6
 *
 * Manage blog_posts from Supabase in Mission Control.
 * Features:
 *  - List all posts (draft/review/published) with status filter
 *  - Click post → detail/edit panel
 *  - Inline status transitions: draft → review → published → draft
 *  - Edit title, excerpt, category, date, read_time (metadata only — content TBD via editor)
 *  - Full content editor (textarea — HTML)
 *  - New post creation
 *  - One-click publish / unpublish
 */

import { useState, useEffect, useCallback, useRef } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type PostStatus = "draft" | "review" | "published";

type BlogPost = {
  id: string;
  slug: string;
  title: string;
  date: string;
  category: string;
  excerpt: string;
  meta_title: string;
  meta_desc: string;
  read_time: string;
  keywords: string[];
  service_link: string;
  author: string;
  hero_icon: string;
  content: string;
  status: PostStatus;
  created_at: string;
  updated_at: string;
};

type PostDraft = Omit<BlogPost, "id" | "created_at" | "updated_at">;

type Props = {
  supabaseUrl: string;
  supabaseKey: string;  // anon key
  authToken: string;    // session JWT
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const STATUS_CFG: Record<PostStatus, { label: string; colour: string; next: PostStatus; nextLabel: string }> = {
  draft:     { label: "Draft",     colour: "#6b7280", next: "review",    nextLabel: "Submit for Review" },
  review:    { label: "Review",    colour: "#f59e0b", next: "published", nextLabel: "Publish" },
  published: { label: "Published", colour: "#22c55e", next: "draft",     nextLabel: "Unpublish" },
};

const CATEGORIES = ["SEO", "Web Development", "AI & Automation", "Case Study", "Business"];

const SERVICE_LINKS = [
  "/services/seo-consultancy",
  "/services/websites",
  "/services/custom-web-apps",
  "/services/ai-consultancy",
  "/services/ai-agents",
  "/services/app-development",
  "/contact",
];

const HERO_ICONS = ["Search", "Globe", "Brain", "MessageSquare", "Monitor", "ClipboardCheck", "Code", "BarChart"];

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

// ---------------------------------------------------------------------------
// Blank post template
// ---------------------------------------------------------------------------
function blankPost(): PostDraft {
  return {
    slug: "",
    title: "",
    date: new Date().toISOString().slice(0, 10),
    category: "SEO",
    excerpt: "",
    meta_title: "",
    meta_desc: "",
    read_time: "5 min",
    keywords: [],
    service_link: "/services/seo-consultancy",
    author: "Dominic Clauzel",
    hero_icon: "Globe",
    content: "<p></p>",
    status: "draft",
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function BlogManager({ supabaseUrl, supabaseKey, authToken }: Props) {
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<PostStatus | "all">("all");
  const [selectedPost, setSelectedPost] = useState<BlogPost | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [editDraft, setEditDraft] = useState<PostDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const keywordsRef = useRef<HTMLInputElement>(null);

  const headers = {
    apikey: supabaseKey,
    Authorization: `Bearer ${authToken}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };

  // ---------------------------------------------------------------------------
  // Fetch
  // ---------------------------------------------------------------------------
  const fetchPosts = useCallback(async () => {
    try {
      const r = await fetch(
        `${supabaseUrl}/rest/v1/blog_posts?select=id,slug,title,date,category,status,excerpt,read_time,updated_at,created_at&order=date.desc`,
        { headers }
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setPosts(await r.json());
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, [supabaseUrl, authToken]);

  useEffect(() => { fetchPosts(); }, [fetchPosts]);

  // ---------------------------------------------------------------------------
  // Select post (load full record)
  // ---------------------------------------------------------------------------
  const selectPost = async (post: BlogPost) => {
    setIsNew(false);
    setSaveMsg(null);
    // Fetch full post including content
    const r = await fetch(
      `${supabaseUrl}/rest/v1/blog_posts?id=eq.${post.id}&select=*&limit=1`,
      { headers }
    );
    const rows: BlogPost[] = await r.json();
    const full = rows[0] ?? post;
    setSelectedPost(full);
    setEditDraft({
      slug: full.slug,
      title: full.title,
      date: full.date,
      category: full.category,
      excerpt: full.excerpt,
      meta_title: full.meta_title,
      meta_desc: full.meta_desc,
      read_time: full.read_time,
      keywords: full.keywords ?? [],
      service_link: full.service_link,
      author: full.author,
      hero_icon: full.hero_icon,
      content: full.content,
      status: full.status,
    });
  };

  const startNew = () => {
    setSelectedPost(null);
    setIsNew(true);
    setSaveMsg(null);
    setEditDraft(blankPost());
  };

  // ---------------------------------------------------------------------------
  // Save (create or update)
  // ---------------------------------------------------------------------------
  const save = async () => {
    if (!editDraft) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      if (isNew) {
        const r = await fetch(`${supabaseUrl}/rest/v1/blog_posts`, {
          method: "POST",
          headers,
          body: JSON.stringify(editDraft),
        });
        if (!r.ok) throw new Error(await r.text());
        const created: BlogPost[] = await r.json();
        setSelectedPost(created[0]);
        setIsNew(false);
        setSaveMsg("✓ Post created");
      } else if (selectedPost) {
        const r = await fetch(`${supabaseUrl}/rest/v1/blog_posts?id=eq.${selectedPost.id}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify(editDraft),
        });
        if (!r.ok) throw new Error(await r.text());
        const updated: BlogPost[] = await r.json();
        setSelectedPost(updated[0]);
        setSaveMsg("✓ Saved");
      }
      await fetchPosts();
    } catch (e: unknown) {
      setSaveMsg(`✗ ${e instanceof Error ? e.message : "Save failed"}`);
    } finally {
      setSaving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Quick status transition
  // ---------------------------------------------------------------------------
  const transitionStatus = async (post: BlogPost, newStatus: PostStatus) => {
    try {
      await fetch(`${supabaseUrl}/rest/v1/blog_posts?id=eq.${post.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ status: newStatus }),
      });
      setPosts(prev => prev.map(p => p.id === post.id ? { ...p, status: newStatus } : p));
      if (selectedPost?.id === post.id) {
        setSelectedPost(prev => prev ? { ...prev, status: newStatus } : prev);
        setEditDraft(prev => prev ? { ...prev, status: newStatus } : prev);
      }
    } catch {
      // silent
    }
  };

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------
  const filtered = filterStatus === "all" ? posts : posts.filter(p => p.status === filterStatus);
  const counts = { draft: 0, review: 0, published: 0 };
  posts.forEach(p => { counts[p.status] = (counts[p.status] ?? 0) + 1; });

  // ---------------------------------------------------------------------------
  // Edit panel field helper
  // ---------------------------------------------------------------------------
  const field = (key: keyof PostDraft) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    setEditDraft(prev => prev ? { ...prev, [key]: e.target.value } : prev);
  };

  const inputStyle = {
    width: "100%", padding: "7px 10px", fontSize: "12px", borderRadius: "6px",
    border: "1px solid #374151", background: "#111827", color: "#f9fafb",
    outline: "none", boxSizing: "border-box" as const,
  };
  const labelStyle = { fontSize: "11px", color: "#6b7280", marginBottom: "3px", display: "block" };

  // ---------------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------------
  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "48px", color: "#9ca3af" }}>
        Loading posts…
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Edit / New panel
  // ---------------------------------------------------------------------------
  const EditPanel = () => {
    if (!editDraft) return null;
    const cfg = STATUS_CFG[editDraft.status];
    const postUrl = `https://dc81.io/blog/${editDraft.slug}`;

    return (
      <div style={{
        width: "460px", flexShrink: 0, borderLeft: "1px solid #1f2937",
        background: "#0d1117", overflowY: "auto", display: "flex", flexDirection: "column",
      }}>
        {/* Header */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #1f2937", display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: "11px", color: "#6b7280" }}>{isNew ? "New post" : "Editing"}</p>
            <p style={{ margin: "2px 0 0", fontSize: "13px", fontWeight: 600, color: "#f9fafb", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "300px" }}>
              {editDraft.title || "Untitled"}
            </p>
          </div>
          <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 9px", borderRadius: "8px", border: `1px solid ${cfg.colour}40`, color: cfg.colour }}>
            {cfg.label}
          </span>
          <button onClick={() => { setSelectedPost(null); setIsNew(false); setEditDraft(null); }} style={{ background: "none", border: "none", color: "#6b7280", cursor: "pointer", fontSize: "16px" }}>✕</button>
        </div>

        {/* Fields */}
        <div style={{ flex: 1, padding: "16px 20px", display: "flex", flexDirection: "column", gap: "12px", overflowY: "auto" }}>

          {/* Title + auto-slug */}
          <div>
            <label style={labelStyle}>Title *</label>
            <input
              style={inputStyle}
              value={editDraft.title}
              onChange={e => {
                const title = e.target.value;
                setEditDraft(prev => prev ? {
                  ...prev,
                  title,
                  slug: isNew ? slugify(title) : prev.slug,
                  meta_title: isNew ? `${title} | DC81` : prev.meta_title,
                } : prev);
              }}
              placeholder="Post title"
            />
          </div>

          <div>
            <label style={labelStyle}>Slug *</label>
            <input style={inputStyle} value={editDraft.slug} onChange={field("slug")} placeholder="url-friendly-slug" />
            {!isNew && editDraft.slug && (
              <a href={postUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: "10px", color: "#00d4ff", marginTop: "2px", display: "block" }}>
                {postUrl} ↗
              </a>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
            <div>
              <label style={labelStyle}>Date *</label>
              <input style={inputStyle} type="date" value={editDraft.date} onChange={field("date")} />
            </div>
            <div>
              <label style={labelStyle}>Read time</label>
              <input style={inputStyle} value={editDraft.read_time} onChange={field("read_time")} placeholder="8 min" />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
            <div>
              <label style={labelStyle}>Category</label>
              <select style={inputStyle} value={editDraft.category} onChange={field("category")}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Hero icon</label>
              <select style={inputStyle} value={editDraft.hero_icon} onChange={field("hero_icon")}>
                {HERO_ICONS.map(i => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label style={labelStyle}>Service link</label>
            <select style={inputStyle} value={editDraft.service_link} onChange={field("service_link")}>
              {SERVICE_LINKS.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>

          <div>
            <label style={labelStyle}>Excerpt *</label>
            <textarea style={{ ...inputStyle, height: "60px", resize: "vertical" }} value={editDraft.excerpt} onChange={field("excerpt")} placeholder="One-paragraph summary shown on blog listing" />
          </div>

          <div>
            <label style={labelStyle}>Meta title</label>
            <input style={inputStyle} value={editDraft.meta_title} onChange={field("meta_title")} placeholder="Title for search engines | DC81" />
            <p style={{ fontSize: "10px", color: editDraft.meta_title.length > 60 ? "#ef4444" : "#6b7280", margin: "2px 0 0" }}>
              {editDraft.meta_title.length}/60 chars
            </p>
          </div>

          <div>
            <label style={labelStyle}>Meta description</label>
            <textarea style={{ ...inputStyle, height: "52px", resize: "vertical" }} value={editDraft.meta_desc} onChange={field("meta_desc")} placeholder="Search result description (120-160 chars)" />
            <p style={{ fontSize: "10px", color: editDraft.meta_desc.length > 160 ? "#ef4444" : "#6b7280", margin: "2px 0 0" }}>
              {editDraft.meta_desc.length}/160 chars
            </p>
          </div>

          <div>
            <label style={labelStyle}>Keywords (comma-separated)</label>
            <input
              ref={keywordsRef}
              style={inputStyle}
              defaultValue={(editDraft.keywords ?? []).join(", ")}
              onBlur={e => setEditDraft(prev => prev ? { ...prev, keywords: e.target.value.split(",").map(k => k.trim()).filter(Boolean) } : prev)}
              placeholder="keyword one, keyword two"
            />
          </div>

          <div>
            <label style={labelStyle}>Content (HTML)</label>
            <textarea
              style={{ ...inputStyle, height: "220px", resize: "vertical", fontFamily: "monospace", fontSize: "11px" }}
              value={editDraft.content}
              onChange={field("content")}
              placeholder="<p>Write your post content here in HTML...</p>"
            />
          </div>

          <div>
            <label style={labelStyle}>Status</label>
            <select style={inputStyle} value={editDraft.status} onChange={field("status") as (e: React.ChangeEvent<HTMLSelectElement>) => void}>
              <option value="draft">Draft</option>
              <option value="review">Review</option>
              <option value="published">Published</option>
            </select>
          </div>
        </div>

        {/* Actions */}
        <div style={{ padding: "14px 20px", borderTop: "1px solid #1f2937", display: "flex", gap: "8px", alignItems: "center" }}>
          <button
            onClick={save}
            disabled={saving || !editDraft.title || !editDraft.slug}
            style={{
              flex: 1, padding: "8px", fontSize: "13px", fontWeight: 600, borderRadius: "8px", cursor: "pointer",
              border: "1px solid rgba(0,212,255,0.4)", background: "rgba(0,212,255,0.1)", color: "#00d4ff",
              opacity: (saving || !editDraft.title || !editDraft.slug) ? 0.5 : 1,
            }}
          >
            {saving ? "Saving…" : isNew ? "Create Post" : "Save Changes"}
          </button>

          {!isNew && selectedPost && editDraft.status !== "published" && (
            <button
              onClick={() => {
                setEditDraft(prev => prev ? { ...prev, status: "published" } : prev);
                if (selectedPost) transitionStatus(selectedPost, "published");
              }}
              style={{
                padding: "8px 14px", fontSize: "12px", fontWeight: 600, borderRadius: "8px", cursor: "pointer",
                border: "1px solid rgba(34,197,94,0.4)", background: "rgba(34,197,94,0.1)", color: "#22c55e",
              }}
            >
              🚀 Publish
            </button>
          )}
        </div>

        {saveMsg && (
          <p style={{ margin: "0 20px 12px", fontSize: "12px", color: saveMsg.startsWith("✓") ? "#22c55e" : "#f87171" }}>
            {saveMsg}
          </p>
        )}
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Post row
  // ---------------------------------------------------------------------------
  const PostRow = ({ post }: { post: BlogPost }) => {
    const cfg = STATUS_CFG[post.status];
    const isSelected = selectedPost?.id === post.id || (isNew && false);
    return (
      <tr
        onClick={() => selectPost(post)}
        style={{ borderBottom: "1px solid #1f2937", cursor: "pointer", background: isSelected ? "#1a2236" : "transparent" }}
      >
        <td style={{ padding: "12px 16px" }}>
          <div style={{ fontWeight: 600, color: "#f9fafb", fontSize: "13px" }}>{post.title}</div>
          <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "2px" }}>/blog/{post.slug}</div>
        </td>
        <td style={{ padding: "12px 16px" }}>
          <span style={{ fontSize: "11px", padding: "2px 8px", borderRadius: "8px", border: `1px solid ${cfg.colour}40`, color: cfg.colour, fontWeight: 600 }}>
            {cfg.label}
          </span>
        </td>
        <td style={{ padding: "12px 16px", fontSize: "12px", color: "#9ca3af" }}>{post.category}</td>
        <td style={{ padding: "12px 16px", fontSize: "12px", color: "#9ca3af", whiteSpace: "nowrap" }}>
          {new Date(post.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
        </td>
        <td style={{ padding: "12px 16px", fontSize: "11px", color: "#6b7280", whiteSpace: "nowrap" }}>
          {timeAgo(post.updated_at)}
        </td>
        <td style={{ padding: "12px 16px" }}>
          <button
            onClick={e => { e.stopPropagation(); transitionStatus(post, STATUS_CFG[post.status].next); }}
            style={{
              padding: "3px 10px", fontSize: "11px", borderRadius: "6px", cursor: "pointer",
              border: "1px solid #374151", background: "transparent", color: "#9ca3af",
              whiteSpace: "nowrap",
            }}
          >
            {STATUS_CFG[post.status].nextLabel}
          </button>
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
        <div style={{ padding: "14px 20px", borderBottom: "1px solid #1f2937", display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          {/* Counts */}
          <div style={{ display: "flex", gap: "16px" }}>
            {(Object.entries(counts) as [PostStatus, number][]).map(([s, n]) => {
              const cfg = STATUS_CFG[s];
              return (
                <div key={s} style={{ textAlign: "center" }}>
                  <p style={{ margin: "0 0 1px", fontSize: "18px", fontWeight: 700, color: cfg.colour }}>{n}</p>
                  <p style={{ margin: 0, fontSize: "10px", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em" }}>{cfg.label}</p>
                </div>
              );
            })}
          </div>

          <div style={{ marginLeft: "auto", display: "flex", gap: "6px", alignItems: "center" }}>
            {/* Status filter */}
            {([{ id: "all", label: "All", colour: "#9ca3af" }, ...Object.entries(STATUS_CFG).map(([id, c]) => ({ id, label: c.label, colour: c.colour }))] as const).map((s: any) => (
              <button key={s.id} onClick={() => setFilterStatus(s.id)}
                style={{
                  padding: "5px 10px", fontSize: "11px", borderRadius: "6px", cursor: "pointer",
                  border: `1px solid ${filterStatus === s.id ? s.colour : "#374151"}`,
                  background: filterStatus === s.id ? `${s.colour}20` : "transparent",
                  color: filterStatus === s.id ? s.colour : "#9ca3af",
                }}>
                {s.label}
              </button>
            ))}

            <button onClick={startNew} style={{
              padding: "6px 14px", fontSize: "12px", fontWeight: 600, borderRadius: "6px", cursor: "pointer",
              border: "1px solid rgba(0,212,255,0.4)", background: "rgba(0,212,255,0.1)", color: "#00d4ff",
            }}>
              + New Post
            </button>
            <button onClick={fetchPosts} style={{ padding: "5px 10px", fontSize: "13px", borderRadius: "6px", border: "1px solid #374151", background: "transparent", color: "#9ca3af", cursor: "pointer" }}>↻</button>
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
                {["Title / Slug", "Status", "Category", "Date", "Last updated", "Action"].map(h => (
                  <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: "11px", color: "#6b7280", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(post => <PostRow key={post.id} post={post} />)}
              {filtered.length === 0 && (
                <tr><td colSpan={6} style={{ padding: "40px", textAlign: "center", color: "#6b7280" }}>
                  {filterStatus === "all" ? "No posts yet." : `No ${filterStatus} posts`}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit panel */}
      {editDraft && <EditPanel />}
    </div>
  );
}
