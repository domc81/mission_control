/**
 * ContentCalendar.tsx — Phase 7
 *
 * Weekly / monthly content calendar for social_posts.
 * - Toggle between week and month view
 * - Platform colour coding
 * - Click any day → post list panel on the right
 * - 5-3-2 content mix tracker (rolling 10-post window)
 * - "Today" button, prev/next navigation
 * - Posts pulled from Supabase social_posts, refreshed every 30s
 */

import { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type PostStatus = "pending_approval" | "approved" | "posted" | "rejected" | "scheduled";

type SocialPost = {
  id: string;
  platform: string;
  content: string;
  status: PostStatus;
  content_type: "curated" | "original" | "personal" | null;
  scheduled_for: string | null;
  posted_at: string | null;
  created_at: string;
};

type Props = {
  supabaseUrl: string;
  supabaseKey: string;  // anon key
  authToken: string;    // session JWT
};

// ---------------------------------------------------------------------------
// Platform colours
// ---------------------------------------------------------------------------
const PLATFORM_COLOUR: Record<string, { bg: string; text: string; dot: string }> = {
  x:         { bg: "rgba(0,0,0,0.8)",          text: "#fff",    dot: "#e7e9ea" },
  twitter:   { bg: "rgba(0,0,0,0.8)",          text: "#fff",    dot: "#e7e9ea" },
  linkedin:  { bg: "rgba(10,102,194,0.85)",     text: "#fff",    dot: "#0a66c2" },
  instagram: { bg: "rgba(193,53,132,0.85)",     text: "#fff",    dot: "#c13584" },
  facebook:  { bg: "rgba(24,119,242,0.85)",     text: "#fff",    dot: "#1877f2" },
  tiktok:    { bg: "rgba(0,0,0,0.8)",          text: "#fff",    dot: "#69c9d0" },
};

const platformColour = (p: string) =>
  PLATFORM_COLOUR[p.toLowerCase()] ?? { bg: "rgba(107,114,128,0.8)", text: "#fff", dot: "#6b7280" };

const STATUS_COLOUR: Record<string, string> = {
  posted:           "#22c55e",
  approved:         "#3b82f6",
  scheduled:        "#8b5cf6",
  pending_approval: "#f59e0b",
  rejected:         "#ef4444",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfWeek(d: Date): Date {
  const day = d.getDay(); // 0=Sun
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((day + 6) % 7)); // Monday-based
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function formatMonthYear(d: Date): string {
  return d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

function formatWeekRange(start: Date): string {
  const end = addDays(start, 6);
  const s = start.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const e = end.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return `${s} – ${e}`;
}

function dayLabel(d: Date): string {
  return d.toLocaleDateString("en-GB", { weekday: "short" });
}

function dateNum(d: Date): number {
  return d.getDate();
}

/** Return the date key (YYYY-MM-DD) for a post */
function postDateKey(post: SocialPost): string | null {
  const ts = post.posted_at ?? post.scheduled_for ?? post.created_at;
  if (!ts) return null;
  return ts.slice(0, 10);
}

// ---------------------------------------------------------------------------
// 5-3-2 Mix analysis — rolling last 10 posts
// ---------------------------------------------------------------------------
type MixCount = { curated: number; original: number; personal: number; untagged: number; total: number };

function computeMix(posts: SocialPost[]): MixCount {
  const last10 = [...posts]
    .sort((a, b) => (b.posted_at ?? b.created_at) > (a.posted_at ?? a.created_at) ? 1 : -1)
    .slice(0, 10);
  const mix: MixCount = { curated: 0, original: 0, personal: 0, untagged: 0, total: last10.length };
  last10.forEach(p => {
    const t = p.content_type;
    if (t === "curated" || t === "original" || t === "personal") mix[t]++;
    else mix.untagged++;
  });
  return mix;
}

// ---------------------------------------------------------------------------
// DayCell — single day in the calendar grid
// ---------------------------------------------------------------------------
type DayCellProps = {
  date: Date;
  posts: SocialPost[];
  isToday: boolean;
  isCurrentMonth: boolean;
  isSelected: boolean;
  compact: boolean;
  onClick: (date: Date) => void;
};

function DayCell({ date, posts, isToday, isCurrentMonth, isSelected, compact, onClick }: DayCellProps) {
  const MAX_DOTS = compact ? 3 : 4;
  const visible = posts.slice(0, MAX_DOTS);
  const overflow = posts.length - MAX_DOTS;

  return (
    <div
      onClick={() => onClick(date)}
      style={{
        minHeight: compact ? "52px" : "80px",
        padding: "6px",
        borderRadius: "6px",
        cursor: "pointer",
        background: isSelected ? "rgba(0,212,255,0.08)" : "transparent",
        border: `1px solid ${isSelected ? "rgba(0,212,255,0.3)" : isToday ? "rgba(0,212,255,0.2)" : "#1f2937"}`,
        opacity: isCurrentMonth ? 1 : 0.35,
        transition: "background 0.12s, border-color 0.12s",
        position: "relative",
      }}
    >
      {/* Date number */}
      <div style={{
        fontSize: "11px", fontWeight: isToday ? 700 : 400,
        color: isToday ? "#00d4ff" : isCurrentMonth ? "#d1d5db" : "#4b5563",
        marginBottom: "4px", lineHeight: 1,
      }}>
        {isToday ? (
          <span style={{ background: "#00d4ff", color: "#000", borderRadius: "50%", width: "18px", height: "18px", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "10px", fontWeight: 700 }}>
            {dateNum(date)}
          </span>
        ) : dateNum(date)}
      </div>

      {/* Post dots / pills */}
      <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
        {visible.map(post => {
          const col = platformColour(post.platform);
          return (
            <div key={post.id} style={{
              fontSize: "9px", padding: "1px 4px", borderRadius: "3px",
              background: col.bg, color: col.text,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              maxWidth: "100%", lineHeight: "14px",
            }}>
              {post.platform.charAt(0).toUpperCase() + post.platform.slice(1, compact ? 2 : 4)}
            </div>
          );
        })}
        {overflow > 0 && (
          <div style={{ fontSize: "9px", color: "#6b7280", lineHeight: "13px" }}>+{overflow} more</div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function ContentCalendar({ supabaseUrl, supabaseKey, authToken }: Props) {
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"week" | "month">("month");
  const [cursor, setCursor] = useState(() => new Date()); // anchor date for current view
  const [selectedDate, setSelectedDate] = useState<string | null>(() => isoDate(new Date()));

  const headers = {
    apikey: supabaseKey,
    Authorization: `Bearer ${authToken}`,
    "Content-Type": "application/json",
  };

  // ---------------------------------------------------------------------------
  // Fetch all posts (no date filter — calendar needs full range for navigation)
  // ---------------------------------------------------------------------------
  const fetchPosts = useCallback(async () => {
    try {
      const r = await fetch(
        `${supabaseUrl}/rest/v1/social_posts?select=id,platform,content,status,content_type,scheduled_for,posted_at,created_at&order=created_at.desc&limit=500`,
        { headers }
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setPosts(await r.json());
    } catch (e) {
      console.error("ContentCalendar fetch:", e);
    } finally {
      setLoading(false);
    }
  }, [supabaseUrl, authToken]);

  useEffect(() => { fetchPosts(); }, [fetchPosts]);
  useEffect(() => {
    const t = setInterval(fetchPosts, 30_000);
    return () => clearInterval(t);
  }, [fetchPosts]);

  // ---------------------------------------------------------------------------
  // Build posts-by-date index
  // ---------------------------------------------------------------------------
  const byDate: Record<string, SocialPost[]> = {};
  posts.forEach(post => {
    const key = postDateKey(post);
    if (!key) return;
    if (!byDate[key]) byDate[key] = [];
    byDate[key].push(post);
  });

  const postsForDate = (key: string) => byDate[key] ?? [];

  // ---------------------------------------------------------------------------
  // Build calendar grid days
  // ---------------------------------------------------------------------------
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let gridDays: Date[] = [];
  let headerLabel = "";

  if (viewMode === "week") {
    const mon = startOfWeek(cursor);
    gridDays = Array.from({ length: 7 }, (_, i) => addDays(mon, i));
    headerLabel = formatWeekRange(mon);
  } else {
    // Month: fill complete weeks (Mon–Sun grid)
    const first = startOfMonth(cursor);
    const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const startPad = startOfWeek(first);
    // End on the Sunday of the last week
    const endSun = addDays(startOfWeek(last), 6);
    let d = new Date(startPad);
    while (d <= endSun) {
      gridDays.push(new Date(d));
      d = addDays(d, 1);
    }
    headerLabel = formatMonthYear(cursor);
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------
  const navigate = (dir: -1 | 1) => {
    const next = new Date(cursor);
    if (viewMode === "week") {
      next.setDate(next.getDate() + dir * 7);
    } else {
      next.setMonth(next.getMonth() + dir);
    }
    setCursor(next);
  };

  const goToday = () => {
    setCursor(new Date());
    setSelectedDate(isoDate(new Date()));
  };

  // ---------------------------------------------------------------------------
  // Selected day posts
  // ---------------------------------------------------------------------------
  const selectedPosts = selectedDate ? postsForDate(selectedDate) : [];

  // ---------------------------------------------------------------------------
  // 5-3-2 Mix
  // ---------------------------------------------------------------------------
  const postedPosts = posts.filter(p => p.status === "posted");
  const mix = computeMix(postedPosts);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "48px", color: "#9ca3af" }}>
        Loading calendar…
      </div>
    );
  }

  const WEEK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const cols = viewMode === "week" ? 7 : 7;
  const compact = viewMode === "month";

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* Main calendar */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>

        {/* Toolbar */}
        <div style={{ padding: "14px 20px", borderBottom: "1px solid #1f2937", display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          {/* Nav */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button onClick={() => navigate(-1)} style={{ padding: "5px 10px", fontSize: "14px", borderRadius: "6px", border: "1px solid #374151", background: "transparent", color: "#9ca3af", cursor: "pointer" }}>‹</button>
            <button onClick={() => navigate(1)}  style={{ padding: "5px 10px", fontSize: "14px", borderRadius: "6px", border: "1px solid #374151", background: "transparent", color: "#9ca3af", cursor: "pointer" }}>›</button>
            <span style={{ fontSize: "15px", fontWeight: 600, color: "#f9fafb", minWidth: "180px" }}>{headerLabel}</span>
            <button onClick={goToday} style={{ padding: "4px 10px", fontSize: "11px", borderRadius: "6px", border: "1px solid #374151", background: "transparent", color: "#9ca3af", cursor: "pointer" }}>Today</button>
          </div>

          {/* View toggle */}
          <div style={{ display: "flex", gap: "4px", marginLeft: "auto" }}>
            {(["week", "month"] as const).map(v => (
              <button key={v} onClick={() => setViewMode(v)} style={{
                padding: "5px 12px", fontSize: "11px", borderRadius: "6px", cursor: "pointer",
                border: `1px solid ${viewMode === v ? "#00d4ff" : "#374151"}`,
                background: viewMode === v ? "rgba(0,212,255,0.1)" : "transparent",
                color: viewMode === v ? "#00d4ff" : "#9ca3af",
                textTransform: "capitalize",
              }}>
                {v}
              </button>
            ))}
            <button onClick={fetchPosts} style={{ padding: "5px 10px", fontSize: "13px", borderRadius: "6px", border: "1px solid #374151", background: "transparent", color: "#9ca3af", cursor: "pointer" }}>↻</button>
          </div>
        </div>

        {/* 5-3-2 Mix bar */}
        <div style={{ padding: "10px 20px", borderBottom: "1px solid #1f2937", display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
          <span style={{ fontSize: "11px", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.08em" }}>5-3-2 Mix (last {mix.total})</span>
          {[
            { label: "Curated", target: 5, actual: mix.curated, colour: "#3b82f6" },
            { label: "Original", target: 3, actual: mix.original, colour: "#8b5cf6" },
            { label: "Personal", target: 2, actual: mix.personal, colour: "#22c55e" },
          ].map(({ label, target, actual, colour }) => {
            const pct = mix.total ? Math.round((actual / mix.total) * 100) : 0;
            const targetPct = Math.round((target / 10) * 100);
            const onTarget = Math.abs(pct - targetPct) <= 10;
            return (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: colour, flexShrink: 0 }} />
                <span style={{ fontSize: "11px", color: "#9ca3af" }}>{label}</span>
                <span style={{ fontSize: "12px", fontWeight: 700, color: onTarget ? colour : "#f59e0b" }}>{actual}</span>
                <span style={{ fontSize: "10px", color: "#4b5563" }}>/ {target}</span>
              </div>
            );
          })}
          {mix.untagged > 0 && (
            <span style={{ fontSize: "10px", color: "#f59e0b" }}>
              {mix.untagged} untagged — tag in Content section
            </span>
          )}
          <span style={{ fontSize: "10px", color: "#4b5563", marginLeft: "auto" }}>
            {postedPosts.length} posts published total
          </span>
        </div>

        {/* Platform legend */}
        <div style={{ padding: "8px 20px", borderBottom: "1px solid #1f2937", display: "flex", gap: "10px", flexWrap: "wrap" }}>
          {Object.entries(PLATFORM_COLOUR).filter(([k]) => !["twitter"].includes(k)).map(([platform, col]) => (
            <div key={platform} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <span style={{ width: "8px", height: "8px", borderRadius: "2px", background: col.dot }} />
              <span style={{ fontSize: "10px", color: "#6b7280", textTransform: "capitalize" }}>{platform}</span>
            </div>
          ))}
          {/* Status legend */}
          <div style={{ marginLeft: "auto", display: "flex", gap: "10px" }}>
            {Object.entries(STATUS_COLOUR).map(([s, c]) => (
              <div key={s} style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: c }} />
                <span style={{ fontSize: "10px", color: "#4b5563" }}>{s.replace("_", " ")}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Calendar grid */}
        <div style={{ flex: 1, overflow: "auto", padding: "12px 20px 20px" }}>
          {/* Day headers */}
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: "4px", marginBottom: "4px" }}>
            {WEEK_DAYS.map(d => (
              <div key={d} style={{ fontSize: "10px", color: "#6b7280", textAlign: "center", padding: "4px 0", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                {d}
              </div>
            ))}
          </div>
          {/* Day cells */}
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: "4px" }}>
            {gridDays.map(day => {
              const key = isoDate(day);
              const dayPosts = postsForDate(key);
              const isThisMonth = day.getMonth() === cursor.getMonth();
              return (
                <DayCell
                  key={key}
                  date={day}
                  posts={dayPosts}
                  isToday={isoDate(day) === isoDate(today)}
                  isCurrentMonth={viewMode === "week" ? true : isThisMonth}
                  isSelected={selectedDate === key}
                  compact={compact}
                  onClick={d => setSelectedDate(isoDate(d))}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* Day detail panel */}
      <div style={{ width: "320px", flexShrink: 0, borderLeft: "1px solid #1f2937", background: "#0d1117", overflowY: "auto", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #1f2937" }}>
          <p style={{ margin: 0, fontSize: "11px", color: "#6b7280" }}>
            {selectedDate
              ? new Date(selectedDate + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
              : "Select a day"}
          </p>
          <p style={{ margin: "4px 0 0", fontSize: "16px", fontWeight: 600, color: "#f9fafb" }}>
            {selectedPosts.length} {selectedPosts.length === 1 ? "post" : "posts"}
          </p>
        </div>

        <div style={{ flex: 1, padding: "12px 16px", display: "flex", flexDirection: "column", gap: "10px" }}>
          {selectedPosts.length === 0 ? (
            <p style={{ fontSize: "13px", color: "#4b5563", textAlign: "center", padding: "24px 0" }}>
              Nothing scheduled for this day
            </p>
          ) : (
            selectedPosts.map(post => {
              const col = platformColour(post.platform);
              const statusCol = STATUS_COLOUR[post.status] ?? "#6b7280";
              const time = post.posted_at ?? post.scheduled_for;
              return (
                <div key={post.id} style={{
                  borderRadius: "8px", border: "1px solid #1f2937",
                  background: "#111827", overflow: "hidden",
                }}>
                  {/* Platform bar */}
                  <div style={{ background: col.bg, padding: "6px 10px", display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ fontSize: "11px", fontWeight: 600, color: col.text, textTransform: "capitalize" }}>
                      {post.platform}
                    </span>
                    <span style={{ marginLeft: "auto", fontSize: "10px", color: col.text, opacity: 0.7 }}>
                      {time ? new Date(time).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : ""}
                    </span>
                  </div>
                  {/* Content */}
                  <div style={{ padding: "10px" }}>
                    <p style={{ margin: "0 0 8px", fontSize: "12px", color: "#d1d5db", lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                      {post.content}
                    </p>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: statusCol }} />
                      <span style={{ fontSize: "10px", color: "#6b7280", textTransform: "capitalize" }}>
                        {post.status.replace("_", " ")}
                      </span>
                      {post.content_type && (
                        <span style={{
                          fontSize: "10px", padding: "1px 6px", borderRadius: "6px",
                          background: post.content_type === "curated" ? "rgba(59,130,246,0.15)" : post.content_type === "personal" ? "rgba(34,197,94,0.15)" : "rgba(139,92,246,0.15)",
                          color: post.content_type === "curated" ? "#3b82f6" : post.content_type === "personal" ? "#22c55e" : "#8b5cf6",
                        }}>
                          {post.content_type}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
