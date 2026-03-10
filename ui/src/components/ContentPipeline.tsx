/**
 * ContentPipeline.tsx
 *
 * Content approval queue and published/failed post tracking.
 * Reads from Supabase `social_posts` table via REST API.
 *
 * Table columns (verified):
 *   id, platform, content, media_urls, status, scheduled_for,
 *   posted_at, platform_post_id, rejection_reason, created_at, updated_at
 *
 * Status values: pending_approval | approved | rejected | posted | failed
 *
 * Actions:
 *   APPROVE: PATCH status → "approved"
 *   REJECT:  PATCH status → "rejected", rejection_reason → <text>
 */

import { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SocialPost = {
  id: string;
  platform: string;
  content: string;
  media_urls: string[] | null;
  status: "pending_approval" | "approved" | "rejected" | "posted" | "failed";
  scheduled_for: string | null;
  posted_at: string | null;
  platform_post_id: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
};

type Props = {
  supabaseUrl: string;
  supabaseKey: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PLATFORM_EMOJI: Record<string, string> = {
  linkedin:       "💼",
  instagram:      "📸",
  facebook:       "👥",
  tiktok:         "🎵",
  googlebusiness: "🗺️",
  twitter:        "🐦",
  default:        "📣",
};

function platformEmoji(platform: string): string {
  return PLATFORM_EMOJI[platform.toLowerCase()] ?? PLATFORM_EMOJI.default;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60)  return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60)  return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24)    return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatScheduled(iso: string | null): string {
  if (!iso) return "Immediate";
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Hook: Supabase social_posts
// ---------------------------------------------------------------------------

function useSupabasePosts(supabaseUrl: string, supabaseKey: string) {
  const [posts, setPosts]       = useState<SocialPost[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  const headers = {
    "apikey":        supabaseKey,
    "Authorization": `Bearer ${supabaseKey}`,
    "Content-Type":  "application/json",
    "Prefer":        "return=representation",
  };

  const fetchPosts = useCallback(async () => {
    try {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/social_posts?select=*&order=created_at.desc&limit=100`,
        { headers }
      );
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data: SocialPost[] = await res.json();
      setPosts(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [supabaseUrl, supabaseKey]);

  useEffect(() => {
    fetchPosts();
    const interval = setInterval(fetchPosts, 30_000);
    return () => clearInterval(interval);
  }, [fetchPosts]);

  const approve = useCallback(async (id: string): Promise<boolean> => {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/social_posts?id=eq.${id}`,
      {
        method:  "PATCH",
        headers,
        body:    JSON.stringify({ status: "approved", updated_at: new Date().toISOString() }),
      }
    );
    if (res.ok) await fetchPosts();
    return res.ok;
  }, [supabaseUrl, supabaseKey]);

  const reject = useCallback(async (id: string, reason: string): Promise<boolean> => {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/social_posts?id=eq.${id}`,
      {
        method:  "PATCH",
        headers,
        body:    JSON.stringify({
          status:           "rejected",
          rejection_reason: reason,
          updated_at:       new Date().toISOString(),
        }),
      }
    );
    if (res.ok) await fetchPosts();
    return res.ok;
  }, [supabaseUrl, supabaseKey]);

  return { posts, loading, error, fetchPosts, approve, reject };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PostCard({
  post,
  onApprove,
  onReject,
}: {
  post: SocialPost;
  onApprove?: (id: string) => void;
  onReject?:  (id: string) => void;
}) {
  const [rejecting, setRejecting]     = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy]               = useState(false);

  async function handleApprove() {
    setBusy(true);
    await onApprove?.(post.id);
    setBusy(false);
  }

  async function handleReject() {
    if (!rejecting) { setRejecting(true); return; }
    if (!rejectReason.trim()) return;
    setBusy(true);
    await onReject?.(post.id, rejectReason.trim());
    setBusy(false);
    setRejecting(false);
    setRejectReason("");
  }

  return (
    <div className={`cp-post-card cp-post-card--${post.status}`}>
      <div className="cp-post-header">
        <span className="cp-post-platform">
          {platformEmoji(post.platform)} {post.platform}
        </span>
        <span className={`cp-status-badge cp-status-badge--${post.status}`}>
          {post.status.replace("_", " ")}
        </span>
        <span className="cp-post-age">{timeAgo(post.created_at)}</span>
      </div>

      <div className="cp-post-content">{post.content}</div>

      {post.media_urls && post.media_urls.length > 0 && (
        <div className="cp-post-media">
          {post.media_urls.map((url, i) => (
            <span key={i} className="cp-media-badge">📎 media {i + 1}</span>
          ))}
        </div>
      )}

      <div className="cp-post-meta">
        <span>Scheduled: {formatScheduled(post.scheduled_for)}</span>
        {post.posted_at && <span>Posted: {timeAgo(post.posted_at)}</span>}
        {post.platform_post_id && (
          <span className="cp-post-id">ID: {post.platform_post_id}</span>
        )}
      </div>

      {post.rejection_reason && (
        <div className="cp-rejection-reason">
          ⚠️ {post.rejection_reason}
        </div>
      )}

      {(onApprove || onReject) && (
        <div className="cp-post-actions">
          {onApprove && !rejecting && (
            <button
              className="cp-btn cp-btn--approve"
              onClick={handleApprove}
              disabled={busy}
            >
              {busy ? "…" : "✓ Approve"}
            </button>
          )}
          {onReject && (
            <>
              {rejecting ? (
                <div className="cp-reject-form">
                  <input
                    className="cp-reject-input"
                    placeholder="Rejection reason…"
                    value={rejectReason}
                    onChange={e => setRejectReason(e.target.value)}
                    autoFocus
                  />
                  <button
                    className="cp-btn cp-btn--reject"
                    onClick={handleReject}
                    disabled={busy || !rejectReason.trim()}
                  >
                    {busy ? "…" : "Confirm"}
                  </button>
                  <button
                    className="cp-btn cp-btn--cancel"
                    onClick={() => { setRejecting(false); setRejectReason(""); }}
                    disabled={busy}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  className="cp-btn cp-btn--reject"
                  onClick={() => setRejecting(true)}
                  disabled={busy}
                >
                  ✕ Reject
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ContentPipeline({ supabaseUrl, supabaseKey }: Props) {
  const { posts, loading, error, fetchPosts, approve, reject } = useSupabasePosts(supabaseUrl, supabaseKey);
  const [activeTab, setActiveTab] = useState<"pending" | "approved" | "posted" | "failed" | "rejected">("pending");

  const pending  = posts.filter(p => p.status === "pending_approval");
  const approved = posts.filter(p => p.status === "approved");
  const posted   = posts.filter(p => p.status === "posted");
  const failed   = posts.filter(p => p.status === "failed");
  const rejected = posts.filter(p => p.status === "rejected");

  const tabMap = { pending, approved, posted, failed, rejected };
  const activePosts = tabMap[activeTab];

  return (
    <section className="panel cp-panel">
      <div className="cp-header">
        <h2>Content Pipeline</h2>
        <button className="cp-refresh-btn" onClick={fetchPosts} title="Refresh">↻</button>
      </div>

      {/* Stats row */}
      <div className="cp-stats">
        <div className="cp-stat">
          <span className="cp-stat-value cp-stat-pending">{pending.length}</span>
          <span className="cp-stat-label">Pending</span>
        </div>
        <div className="cp-stat">
          <span className="cp-stat-value cp-stat-approved">{approved.length}</span>
          <span className="cp-stat-label">Approved</span>
        </div>
        <div className="cp-stat">
          <span className="cp-stat-value cp-stat-posted">{posted.length}</span>
          <span className="cp-stat-label">Posted</span>
        </div>
        <div className="cp-stat">
          <span className="cp-stat-value cp-stat-failed">{failed.length}</span>
          <span className="cp-stat-label">Failed</span>
        </div>
        <div className="cp-stat">
          <span className="cp-stat-value cp-stat-rejected">{rejected.length}</span>
          <span className="cp-stat-label">Rejected</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="cp-tabs">
        {(["pending", "approved", "posted", "failed", "rejected"] as const).map(tab => (
          <button
            key={tab}
            className={`cp-tab ${activeTab === tab ? "cp-tab--active" : ""}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
            {tabMap[tab].length > 0 && (
              <span className={`cp-tab-count ${tab === "pending" ? "cp-tab-count--urgent" : ""}`}>
                {tabMap[tab].length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading && <p className="empty-state">Loading posts…</p>}
      {error   && <p className="cp-error">⚠️ {error}</p>}

      {!loading && !error && (
        <div className="cp-posts-list">
          {activePosts.length === 0 ? (
            <p className="empty-state">No {activeTab} posts</p>
          ) : (
            activePosts.map(post => (
              <PostCard
                key={post.id}
                post={post}
                onApprove={activeTab === "pending" ? approve : undefined}
                onReject={activeTab === "pending"  ? reject  : undefined}
              />
            ))
          )}
        </div>
      )}
    </section>
  );
}

// Export pending count for badge use
export function usePendingCount(supabaseUrl: string, supabaseKey: string): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const headers = {
      "apikey":        supabaseKey,
      "Authorization": `Bearer ${supabaseKey}`,
      "Prefer":        "count=exact",
    };
    async function fetchCount() {
      try {
        const res = await fetch(
          `${supabaseUrl}/rest/v1/social_posts?status=eq.pending_approval&select=id`,
          { headers }
        );
        const contentRange = res.headers.get("Content-Range");
        if (contentRange) {
          const total = parseInt(contentRange.split("/")[1] ?? "0", 10);
          setCount(isNaN(total) ? 0 : total);
        } else {
          const data = await res.json();
          setCount(Array.isArray(data) ? data.length : 0);
        }
      } catch { /* silent */ }
    }
    fetchCount();
    const interval = setInterval(fetchCount, 30_000);
    return () => clearInterval(interval);
  }, [supabaseUrl, supabaseKey]);

  return count;
}

export default ContentPipeline;
