/**
 * ContentCalendar.tsx — Phase 7
 *
 * Monthly/weekly content calendar for social_posts.
 * - Monthly grid: each day cell shows platform colour dots + post count
 * - Weekly strip: 7-day view with full post cards per day
 * - Click a day → day detail panel (all posts for that day)
 * - 5-3-2 mix indicator for the visible period
 * - Platform colour coding throughout
 * - Reads from Supabase social_posts via authenticated session
 */

import { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type PostStatus = "pending_approval" | "approved" | "scheduled" | "posted" | "rejected" | "failed";

type SocialPost = {
  id: string;
  platform: string;
  content: string;
  status: PostStatus;
  scheduled_for: string | null;
  posted_at: string | null;
  created_at: string;
  media_urls: string[] | null;
};

type Props = {
  supabaseUrl: string;
  supabaseKey: string;
  authToken: string;
};

// ---------------------------------------------------------------------------
// Platform config
// ---------------------------------------------------------------------------
const PLATFORM_CFG: Record<string, { colour: string; label: string; abbr: string }> = {
  x:         { colour: "#1a1a1a", label: "X",         abbr: "X"  },
  linkedin:  { colour: "#0077b5", label: "LinkedIn",  abbr: "Li" },
  instagram: { colour: "#e1306c", label: "Instagram", abbr: "IG" },
  facebook:  { colour: "#1877f2", label: "Facebook",  abbr: "Fb" },
  tiktok:    { colour: "#010101", label: "TikTok",    abbr: "Tt" },
};
const platformColour = (p: string) => PLATFORM_CFG[p]?.colour ?? "#6b7280";
const platformLabel  = (p: string) => PLATFORM_CFG[p]?.label  ?? p;
const platformAbbr   = (p: string) => PLATFORM_CFG[p]?.abbr   ?? p.slice(0,2).toUpperCase();

const STATUS_STYLE: Record<string, { dot: string; label: string }> = {
  posted:           { dot: "#22c55e", label: "Posted"   },
  scheduled:        { dot: "#3b82f6", label: "Scheduled" },
  pending_approval: { dot: "#f59e0b", label: "Pending"  },
  approved:         { dot: "#a78bfa", label: "Approved" },
  rejected:         { dot: "#ef4444", label: "Rejected" },
  failed:           { dot: "#ef4444", label: "Failed"   },
};

// 5-3-2 labels (classify by content type heuristic — we use platform as proxy)
// Real classification would need a content_type column; for now show platform mix
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

// ---------------------------------------------------------------------------
// Date helpers (all module-level, stable)
// ---------------------------------------------------------------------------
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseDate(s: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function effectiveDate(post: SocialPost): string | null {
  return isoDate(parseDate(post.posted_at) ?? parseDate(post.scheduled_for) ?? new Date(post.created_at));
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/** Monday = 0 … Sunday = 6 */
function dayOfWeek(year: number, month: number, day: number): number {
  const d = new Date(year, month, day).getDay(); // 0=Sun
  return (d + 6) % 7; // shift so Mon=0
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function startOfWeek(d: Date): Date {
  const dow = (d.getDay() + 6) % 7;
  return addDays(d, -dow);
}

function formatDisplayDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

// ---------------------------------------------------------------------------
// ContentCalendar
// ---------------------------------------------------------------------------
export function ContentCalendar({ supabaseUrl, supabaseKey, authToken }: Props) {
  const today = new Date();
  const [viewMode, setViewMode] = useState<"month" | "week">("month");
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [weekStart, setWeekStart] = useState<Date>(startOfWeek(today));
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const headers = {
    apikey: supabaseKey,
    Authorization: `Bearer ${authToken}`,
    "Content-Type": "application/json",
  };

  // ---------------------------------------------------------------------------
  // Fetch posts for visible date range (±2 months for smooth nav)
  // ---------------------------------------------------------------------------
  const fetchPosts = useCallback(async () => {
    try {
      const r = await fetch(
        `${supabaseUrl}/rest/v1/social_posts?select=id,platform,content,status,scheduled_for,posted_at,created_at,media_urls&order=created_at.desc&limit=500`,
        { headers }
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setPosts(await r.json());
    } catch (e) {
      console.error("Calendar fetch:", e);
    } finally {
      setLoading(false);
    }
  }, [supabaseUrl, authToken]);

  useEffect(() => { fetchPosts(); }, [fetchPosts]);

  // ---------------------------------------------------------------------------
  // Build day → posts map
  // ---------------------------------------------------------------------------
  const postsByDay = useCallback(() => {
    const map: Record<string, SocialPost[]> = {};
    posts.forEach(p => {
      const d = effectiveDate(p);
      if (!d) return;
      if (!map[d]) map[d] = [];
      map[d].push(p);
    });
    return map;
  }, [posts]);

  const dayMap = postsByDay();

  // ---------------------------------------------------------------------------
  // 5-3-2 mix for visible period
  // ---------------------------------------------------------------------------
  const mixStats = useCallback((visiblePosts: SocialPost[]) => {
    // Approximate: posted = curated/original, pending/scheduled = upcoming
    const total = visiblePosts.length;
    const byPlatform: Record<string, number> = {};
    visiblePosts.forEach(p => { byPlatform[p.platform] = (byPlatform[p.platform] ?? 0) + 1; });
    const posted = visiblePosts.filter(p => p.status === "posted").length;
    const scheduled = visiblePosts.filter(p => p.status === "scheduled").length;
    const pending = visiblePosts.filter(p => p.status === "pending_approval").length;
    return { total, posted, scheduled, pending, byPlatform };
  }, []);

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------
  const prevMonth = () => {
    if (currentMonth === 0) { setCurrentYear(y => y - 1); setCurrentMonth(11); }
    else setCurrentMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (currentMonth === 11) { setCurrentYear(y => y + 1); setCurrentMonth(0); }
    else setCurrentMonth(m => m + 1);
  };
  const prevWeek = () => setWeekStart(d => addDays(d, -7));
  const nextWeek = () => setWeekStart(d => addDays(d, 7));
  const goToday  = () => {
    setCurrentYear(today.getFullYear());
    setCurrentMonth(today.getMonth());
    setWeekStart(startOfWeek(today));
    setSelectedDay(isoDate(today));
  };

  // ---------------------------------------------------------------------------
  // Day detail panel
  // ---------------------------------------------------------------------------
  const DayPanel = () => {
    if (!selectedDay) return null;
    const dayPosts = dayMap[selectedDay] ?? [];
    return (
      <div style={{
        width: "320px", flexShrink: 0, borderLeft: "1px solid #1f2937",
        background: "#0d1117", overflowY: "auto", display: "flex", flexDirection: "column",
      }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #1f2937", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <p style={{ margin: 0, fontSize: "11px", color: "#6b7280" }}>Selected day</p>
            <p style={{ margin: "2px 0 0", fontSize: "14px", fontWeight: 700, color: "#f9fafb" }}>{formatDisplayDate(selectedDay)}</p>
          </div>
          <button onClick={() => setSelectedDay(null)} style={{ background: "none", border: "none", color: "#6b7280", cursor: "pointer", fontSize: "16px" }}>✕</button>
        </div>

        {dayPosts.length === 0 ? (
          <p style={{ padding: "20px", fontSize: "13px", color: "#6b7280" }}>No posts on this day.</p>
        ) : (
          <div style={{ padding: "12px", display: "flex", flexDirection: "column", gap: "10px" }}>
            {dayPosts.map(post => {
              const col = platformColour(post.platform);
              const st = STATUS_STYLE[post.status] ?? { dot: "#6b7280", label: post.status };
              return (
                <div key={post.id} style={{ background: "#111827", border: `1px solid ${col}30`, borderLeft: `3px solid ${col}`, borderRadius: "8px", padding: "10px 12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                    <span style={{ fontSize: "11px", fontWeight: 700, color: col, background: `${col}20`, padding: "2px 8px", borderRadius: "6px" }}>
                      {platformLabel(post.platform)}
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "10px", color: st.dot }}>
                      <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: st.dot }} />
                      {st.label}
                    </span>
                  </div>
                  <p style={{ margin: 0, fontSize: "12px", color: "#d1d5db", lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                    {post.content}
                  </p>
                  {post.media_urls && post.media_urls.length > 0 && (
                    <p style={{ margin: "6px 0 0", fontSize: "10px", color: "#6b7280" }}>📎 {post.media_urls.length} attachment{post.media_urls.length > 1 ? "s" : ""}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Month grid
  // ---------------------------------------------------------------------------
  const MonthView = () => {
    const numDays = daysInMonth(currentYear, currentMonth);
    const firstDow = dayOfWeek(currentYear, currentMonth, 1); // 0=Mon
    const todayStr = isoDate(today);

    // Visible posts this month for mix stats
    const monthPrefix = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}`;
    const monthPosts = posts.filter(p => (effectiveDate(p) ?? "").startsWith(monthPrefix));
    const mix = mixStats(monthPosts);

    return (
      <div style={{ flex: 1, overflow: "auto", padding: "16px 20px" }}>
        {/* Mix stats */}
        <div style={{ display: "flex", gap: "12px", marginBottom: "16px", flexWrap: "wrap" }}>
          <div style={{ fontSize: "12px", color: "#9ca3af" }}>
            <span style={{ fontWeight: 700, color: "#f9fafb" }}>{mix.total}</span> posts this month ·{" "}
            <span style={{ color: "#22c55e" }}>{mix.posted} posted</span> ·{" "}
            <span style={{ color: "#3b82f6" }}>{mix.scheduled} scheduled</span> ·{" "}
            <span style={{ color: "#f59e0b" }}>{mix.pending} pending</span>
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {Object.entries(mix.byPlatform).map(([p, n]) => (
              <span key={p} style={{ fontSize: "11px", padding: "1px 8px", borderRadius: "8px", background: `${platformColour(p)}20`, color: platformColour(p), border: `1px solid ${platformColour(p)}40` }}>
                {platformLabel(p)}: {n}
              </span>
            ))}
          </div>
        </div>

        {/* Day headers */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "2px", marginBottom: "2px" }}>
          {DAYS.map(d => (
            <div key={d} style={{ textAlign: "center", fontSize: "11px", color: "#6b7280", padding: "4px 0", fontWeight: 600 }}>{d}</div>
          ))}
        </div>

        {/* Grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "2px" }}>
          {/* Leading empty cells */}
          {Array.from({ length: firstDow }).map((_, i) => (
            <div key={`empty-${i}`} style={{ minHeight: "72px", borderRadius: "6px", background: "#0a0f18" }} />
          ))}

          {/* Day cells */}
          {Array.from({ length: numDays }, (_, i) => i + 1).map(day => {
            const iso = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const dayPosts = dayMap[iso] ?? [];
            const isToday = iso === todayStr;
            const isSelected = iso === selectedDay;
            const platforms = [...new Set(dayPosts.map(p => p.platform))];

            return (
              <div
                key={iso}
                onClick={() => setSelectedDay(iso === selectedDay ? null : iso)}
                style={{
                  minHeight: "72px", borderRadius: "6px", padding: "6px",
                  background: isSelected ? "#1a2236" : isToday ? "#111827" : "#0d1117",
                  border: `1px solid ${isSelected ? "#00d4ff" : isToday ? "#374151" : "#1f2937"}`,
                  cursor: "pointer", position: "relative",
                  transition: "border-color 0.15s",
                }}
              >
                <p style={{
                  margin: "0 0 4px", fontSize: "12px", fontWeight: isToday ? 700 : 400,
                  color: isToday ? "#00d4ff" : "#9ca3af",
                }}>
                  {day}
                </p>

                {/* Platform dots */}
                {platforms.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "2px" }}>
                    {platforms.map(p => {
                      const count = dayPosts.filter(post => post.platform === p).length;
                      return (
                        <span key={p} title={`${platformLabel(p)} (${count})`} style={{
                          fontSize: "9px", fontWeight: 700, padding: "1px 5px", borderRadius: "4px",
                          background: `${platformColour(p)}25`, color: platformColour(p),
                          border: `1px solid ${platformColour(p)}40`,
                        }}>
                          {platformAbbr(p)}{count > 1 ? ` ×${count}` : ""}
                        </span>
                      );
                    })}
                  </div>
                )}

                {/* Status indicator row — tiny dots */}
                {dayPosts.length > 0 && (
                  <div style={{ display: "flex", gap: "3px", marginTop: "4px", flexWrap: "wrap" }}>
                    {dayPosts.map(p => (
                      <span key={p.id} style={{
                        width: "5px", height: "5px", borderRadius: "50%",
                        background: STATUS_STYLE[p.status]?.dot ?? "#6b7280",
                        display: "inline-block",
                      }} title={STATUS_STYLE[p.status]?.label ?? p.status} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Week strip
  // ---------------------------------------------------------------------------
  const WeekView = () => {
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    const todayStr = isoDate(today);

    // Visible posts this week for mix stats
    const weekPosts = days.flatMap(d => dayMap[isoDate(d)] ?? []);
    const mix = mixStats(weekPosts);

    return (
      <div style={{ flex: 1, overflow: "auto", padding: "16px 20px" }}>
        {/* Mix stats */}
        <div style={{ display: "flex", gap: "12px", marginBottom: "16px", flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ fontSize: "12px", color: "#9ca3af" }}>
            <span style={{ fontWeight: 700, color: "#f9fafb" }}>{mix.total}</span> posts this week ·{" "}
            <span style={{ color: "#22c55e" }}>{mix.posted} posted</span> ·{" "}
            <span style={{ color: "#3b82f6" }}>{mix.scheduled} scheduled</span> ·{" "}
            <span style={{ color: "#f59e0b" }}>{mix.pending} pending</span>
          </div>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {Object.entries(mix.byPlatform).map(([p, n]) => (
              <span key={p} style={{ fontSize: "11px", padding: "1px 8px", borderRadius: "8px", background: `${platformColour(p)}20`, color: platformColour(p), border: `1px solid ${platformColour(p)}40` }}>
                {platformLabel(p)}: {n}
              </span>
            ))}
          </div>
        </div>

        {/* 7-day columns */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "8px" }}>
          {days.map(d => {
            const iso = isoDate(d);
            const dayPosts = dayMap[iso] ?? [];
            const isToday = iso === todayStr;
            const isSelected = iso === selectedDay;

            return (
              <div key={iso} style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {/* Day header */}
                <div
                  onClick={() => setSelectedDay(iso === selectedDay ? null : iso)}
                  style={{
                    textAlign: "center", padding: "6px 4px", borderRadius: "6px", cursor: "pointer",
                    background: isSelected ? "#1a2236" : isToday ? "rgba(0,212,255,0.1)" : "#111827",
                    border: `1px solid ${isSelected ? "#00d4ff" : isToday ? "rgba(0,212,255,0.3)" : "#1f2937"}`,
                  }}
                >
                  <p style={{ margin: 0, fontSize: "10px", color: "#6b7280" }}>{DAYS[(d.getDay() + 6) % 7]}</p>
                  <p style={{ margin: "2px 0 0", fontSize: "14px", fontWeight: 700, color: isToday ? "#00d4ff" : "#f9fafb" }}>
                    {d.getDate()}
                  </p>
                  <p style={{ margin: 0, fontSize: "9px", color: "#4b5563" }}>{MONTHS[d.getMonth()].slice(0, 3)}</p>
                </div>

                {/* Post cards */}
                {dayPosts.map(post => {
                  const col = platformColour(post.platform);
                  const st = STATUS_STYLE[post.status] ?? { dot: "#6b7280", label: post.status };
                  return (
                    <div key={post.id} style={{
                      background: "#111827", borderLeft: `3px solid ${col}`,
                      border: `1px solid ${col}25`, borderRadius: "6px", padding: "6px 8px",
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                        <span style={{ fontSize: "9px", fontWeight: 700, color: col }}>{platformAbbr(post.platform)}</span>
                        <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: st.dot }} title={st.label} />
                      </div>
                      <p style={{
                        margin: 0, fontSize: "10px", color: "#9ca3af", lineHeight: 1.4,
                        display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden",
                      }}>
                        {post.content}
                      </p>
                    </div>
                  );
                })}

                {dayPosts.length === 0 && (
                  <div style={{ borderRadius: "6px", border: "1px dashed #1f2937", minHeight: "40px" }} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------
  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "48px", color: "#9ca3af" }}>
        Loading calendar…
      </div>
    );
  }

  const weekEnd = addDays(weekStart, 6);

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* Main */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Toolbar */}
        <div style={{ padding: "14px 20px", borderBottom: "1px solid #1f2937", display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>

          {/* View toggle */}
          <div style={{ display: "flex", gap: "4px" }}>
            {(["month", "week"] as const).map(v => (
              <button key={v} onClick={() => setViewMode(v)} style={{
                padding: "5px 12px", fontSize: "12px", borderRadius: "6px", cursor: "pointer",
                border: `1px solid ${viewMode === v ? "#00d4ff" : "#374151"}`,
                background: viewMode === v ? "rgba(0,212,255,0.1)" : "transparent",
                color: viewMode === v ? "#00d4ff" : "#9ca3af",
              }}>
                {v === "month" ? "📅 Month" : "📋 Week"}
              </button>
            ))}
          </div>

          {/* Navigation */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button onClick={viewMode === "month" ? prevMonth : prevWeek} style={{ padding: "4px 10px", fontSize: "14px", borderRadius: "6px", border: "1px solid #374151", background: "transparent", color: "#9ca3af", cursor: "pointer" }}>‹</button>
            <span style={{ fontSize: "14px", fontWeight: 600, color: "#f9fafb", minWidth: "160px", textAlign: "center" }}>
              {viewMode === "month"
                ? `${MONTHS[currentMonth]} ${currentYear}`
                : `${weekStart.getDate()} ${MONTHS[weekStart.getMonth()].slice(0,3)} – ${weekEnd.getDate()} ${MONTHS[weekEnd.getMonth()].slice(0,3)} ${weekEnd.getFullYear()}`
              }
            </span>
            <button onClick={viewMode === "month" ? nextMonth : nextWeek} style={{ padding: "4px 10px", fontSize: "14px", borderRadius: "6px", border: "1px solid #374151", background: "transparent", color: "#9ca3af", cursor: "pointer" }}>›</button>
          </div>

          <button onClick={goToday} style={{ padding: "5px 12px", fontSize: "12px", borderRadius: "6px", border: "1px solid #374151", background: "transparent", color: "#9ca3af", cursor: "pointer" }}>Today</button>

          <button onClick={fetchPosts} style={{ padding: "5px 9px", fontSize: "13px", borderRadius: "6px", border: "1px solid #374151", background: "transparent", color: "#9ca3af", cursor: "pointer" }}>↻</button>

          {/* Platform legend */}
          <div style={{ marginLeft: "auto", display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {Object.entries(PLATFORM_CFG).map(([p, cfg]) => (
              <span key={p} style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "10px", color: cfg.colour }}>
                <span style={{ width: "8px", height: "8px", borderRadius: "2px", background: cfg.colour }} />
                {cfg.label}
              </span>
            ))}
          </div>
        </div>

        {/* Calendar view */}
        {viewMode === "month" ? <MonthView /> : <WeekView />}
      </div>

      {/* Day detail panel */}
      <DayPanel />
    </div>
  );
}
