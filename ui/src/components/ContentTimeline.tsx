/**
 * ContentTimeline.tsx
 *
 * Visual calendar view of scheduled and recently posted social content.
 * Reads from Supabase `social_posts` — shows approved (scheduled) and posted entries.
 * Groups by day, sorted chronologically.
 */

import { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ScheduledPost = {
  id: string;
  platform: string;
  content: string;
  media_urls: string[] | null;
  status: "approved" | "posted" | "failed" | "scheduled";
  scheduled_for: string | null;
  posted_at: string | null;
  platform_post_id: string | null;
  created_at: string;
};

type GroupedDay = {
  dateLabel: string;
  dateKey: string;
  isToday: boolean;
  isTomorrow: boolean;
  posts: ScheduledPost[];
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
  x:              "𝕏",
  twitter:        "𝕏",
  tiktok:         "🎵",
  googlebusiness: "📍",
};

const PLATFORM_COLOUR: Record<string, string> = {
  linkedin:       "#0a66c2",
  instagram:      "#e1306c",
  facebook:       "#1877f2",
  x:              "#ffffff",
  twitter:        "#ffffff",
  tiktok:         "#69c9d0",
  googlebusiness: "#34a853",
};

const STATUS_COLOUR: Record<string, string> = {
  approved:  "#facc15",
  posted:    "#22c55e",
  failed:    "#ef4444",
  scheduled: "#facc15",
};

const STATUS_LABEL: Record<string, string> = {
  approved:  "Scheduled",
  scheduled: "Scheduled",
  posted:    "Posted",
  failed:    "Failed",
};

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/London",
    });
  } catch {
    return "—";
  }
}

function formatDayLabel(dateKey: string): string {
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/London" });
  const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString("sv-SE", { timeZone: "Europe/London" });
  if (dateKey === today) return "Today";
  if (dateKey === tomorrow) return "Tomorrow";
  return new Date(dateKey).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function getDateKey(iso: string): string {
  return new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Europe/London" });
}

function groupByDay(posts: ScheduledPost[]): GroupedDay[] {
  const map = new Map<string, ScheduledPost[]>();
  for (const post of posts) {
    const ts = post.scheduled_for || post.posted_at || post.created_at;
    const key = getDateKey(ts);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(post);
  }

  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/London" });
  const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString("sv-SE", { timeZone: "Europe/London" });

  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateKey, posts]) => ({
      dateKey,
      dateLabel: formatDayLabel(dateKey),
      isToday: dateKey === today,
      isTomorrow: dateKey === tomorrow,
      posts: posts.sort((a, b) => {
        const ta = a.scheduled_for || a.posted_at || a.created_at;
        const tb = b.scheduled_for || b.posted_at || b.created_at;
        return ta.localeCompare(tb);
      }),
    }));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ContentTimeline({ supabaseUrl, supabaseKey }: Props) {
  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchPosts = useCallback(async () => {
    try {
      // Fetch: approved/posted/failed from last 7 days + next 14 days
      const since = new Date(Date.now() - 7 * 86400000).toISOString();
      const until = new Date(Date.now() + 14 * 86400000).toISOString();

      const params = new URLSearchParams({
        "status": "in.(approved,posted,failed)",
        "or": `(scheduled_for.gte.${since},posted_at.gte.${since})`,
        "select": "id,platform,content,media_urls,status,scheduled_for,posted_at,platform_post_id,created_at",
        "order": "scheduled_for.asc.nullslast",
        "limit": "100",
      });

      const r = await fetch(`${supabaseUrl}/rest/v1/social_posts?${params}`, {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      });

      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data: ScheduledPost[] = await r.json();
      setPosts(data);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [supabaseUrl, supabaseKey]);

  useEffect(() => {
    fetchPosts();
    const interval = setInterval(fetchPosts, 60_000); // refresh every minute
    return () => clearInterval(interval);
  }, [fetchPosts]);

  const grouped = groupByDay(posts);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="timeline-loading">
        <div className="loading-spinner" />
        <p>Loading schedule…</p>
      </div>
    );
  }

  return (
    <div className="content-timeline">
      {/* Header */}
      <div className="timeline-header">
        <div className="timeline-header-left">
          <h2 className="section-title">Content Schedule</h2>
          <span className="timeline-count">
            {posts.filter(p => p.status === "approved" || p.status === "scheduled").length} scheduled
            {" · "}
            {posts.filter(p => p.status === "posted").length} posted (7d)
          </span>
        </div>
        <button className="timeline-refresh-btn" onClick={fetchPosts} title="Refresh">
          ↻
        </button>
      </div>

      {error && (
        <div className="timeline-error">⚠ {error}</div>
      )}

      {grouped.length === 0 && !error && (
        <div className="timeline-empty">
          <p>No scheduled or recent posts found.</p>
          <p className="timeline-empty-hint">Approve posts from the Content Queue to see them here.</p>
        </div>
      )}

      {/* Day groups */}
      <div className="timeline-days">
        {grouped.map(day => (
          <div key={day.dateKey} className={`timeline-day ${day.isToday ? "timeline-day--today" : ""}`}>
            <div className="timeline-day-header">
              <span className="timeline-day-label">{day.dateLabel}</span>
              {day.isToday && <span className="timeline-day-badge">Today</span>}
              {day.isTomorrow && <span className="timeline-day-badge timeline-day-badge--tomorrow">Tomorrow</span>}
              <span className="timeline-day-count">{day.posts.length} post{day.posts.length !== 1 ? "s" : ""}</span>
            </div>

            <div className="timeline-posts">
              {day.posts.map(post => {
                const ts = post.scheduled_for || post.posted_at;
                const isExpanded = expandedId === post.id;
                const statusColour = STATUS_COLOUR[post.status] || "#9ca3af";
                const platformColour = PLATFORM_COLOUR[post.platform] || "#6b7280";

                return (
                  <div
                    key={post.id}
                    className={`timeline-post ${isExpanded ? "timeline-post--expanded" : ""}`}
                    onClick={() => setExpandedId(isExpanded ? null : post.id)}
                  >
                    {/* Time column */}
                    <div className="timeline-post-time">
                      {formatTime(ts)}
                    </div>

                    {/* Platform badge */}
                    <div
                      className="timeline-post-platform"
                      style={{ color: platformColour }}
                      title={post.platform}
                    >
                      {PLATFORM_EMOJI[post.platform] || "📤"}
                    </div>

                    {/* Content preview */}
                    <div className="timeline-post-body">
                      <div className="timeline-post-preview">
                        {isExpanded
                          ? post.content
                          : post.content.length > 80
                            ? post.content.substring(0, 80) + "…"
                            : post.content}
                      </div>
                      {isExpanded && post.platform_post_id && (
                        <div className="timeline-post-meta">
                          Platform ID: {post.platform_post_id}
                        </div>
                      )}
                    </div>

                    {/* Status */}
                    <div
                      className="timeline-post-status"
                      style={{ color: statusColour }}
                    >
                      {STATUS_LABEL[post.status] || post.status}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
