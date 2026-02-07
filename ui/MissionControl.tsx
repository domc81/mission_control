// Mission Control Dashboard - React UI
// Shows real-time agent status, tasks, and activity feed

import React, { useState, useEffect } from "react";

interface Agent {
  id: string;
  name: string;
  role: string;
  status: "active" | "idle" | "busy" | "offline";
  lastHeartbeat?: number;
}

interface TaskStats {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
}

interface Activity {
  id: string;
  agentId: string;
  agentName: string;
  type: string;
  message: string;
  timestamp: number;
}

interface DashboardData {
  agents: Agent[];
  taskStats: TaskStats;
  recentActivities: Activity[];
}

export function MissionControl() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [polling, setPolling] = useState(true);

  // Poll Convex for updates every 5 seconds
  useEffect(() => {
    if (!polling) return;

    const poll = async () => {
      try {
        const response = await fetch("/api/getDashboard");
        if (response.ok) {
          const dashboardData = await response.json();
          setData(dashboardData);
          setLastUpdate(new Date());
        }
      } catch (error) {
        console.error("Polling error:", error);
      }
    };

    poll();
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, [polling]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active": return "#22c55e";
      case "idle": return "#eab308";
      case "busy": return "#3b82f6";
      case "offline": return "#6b7280";
      default: return "#6b7280";
    }
  };

  const formatTime = (timestamp: number) => {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  };

  return (
    <div style={{ 
      fontFamily: "system-ui, sans-serif",
      maxWidth: "1200px",
      margin: "0 auto",
      padding: "20px",
      backgroundColor: "#0f172a",
      minHeight: "100vh",
      color: "#e2e8f0"
    }}>
      {/* Header */}
      <header style={{ 
        display: "flex", 
        justifyContent: "space-between", 
        alignItems: "center",
        marginBottom: "30px",
        borderBottom: "1px solid #1e293b",
        paddingBottom: "20px"
      }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "28px", fontWeight: "bold" }}>
            🎯 Mission Control
          </h1>
          <p style={{ margin: "5px 0 0", color: "#64748b", fontSize: "14px" }}>
            DC81 Autonomous Agent Squad
          </p>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "12px", color: "#64748b" }}>
            Last update: {lastUpdate.toLocaleTimeString()}
          </div>
          <div style={{ 
            width: "10px", 
            height: "10px", 
            borderRadius: "50%", 
            backgroundColor: polling ? "#22c55e" : "#ef4444",
            display: "inline-block",
            marginTop: "5px"
          }} />
        </div>
      </header>

      {/* Agent Grid */}
      <section style={{ marginBottom: "30px" }}>
        <h2 style={{ fontSize: "18px", marginBottom: "15px", display: "flex", alignItems: "center", gap: "10px" }}>
          👥 Agents
          <span style={{ fontSize: "12px", color: "#64748b", fontWeight: "normal" }}>
            ({data?.agents.length || 0} online)
          </span>
        </h2>
        <div style={{ 
          display: "grid", 
          gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", 
          gap: "15px" 
        }}>
          {data?.agents.map(agent => (
            <div key={agent.id} style={{
              backgroundColor: "#1e293b",
              borderRadius: "10px",
              padding: "15px",
              borderLeft: `4px solid ${getStatusColor(agent.status)}`
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
                <div>
                  <div style={{ fontWeight: "bold", fontSize: "16px" }}>{agent.name}</div>
                  <div style={{ color: "#64748b", fontSize: "13px" }}>{agent.role}</div>
                </div>
                <span style={{
                  padding: "3px 8px",
                  borderRadius: "12px",
                  fontSize: "11px",
                  textTransform: "uppercase",
                  fontWeight: "bold",
                  backgroundColor: `${getStatusColor(agent.status)}20`,
                  color: getStatusColor(agent.status)
                }}>
                  {agent.status}
                </span>
              </div>
              {agent.lastHeartbeat && (
                <div style={{ marginTop: "10px", fontSize: "12px", color: "#64748b" }}>
                  🫀 Last heartbeat: {formatTime(agent.lastHeartbeat)}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Task Stats */}
      <section style={{ marginBottom: "30px" }}>
        <h2 style={{ fontSize: "18px", marginBottom: "15px" }}>📋 Tasks</h2>
        <div style={{ display: "flex", gap: "20px", flexWrap: "wrap" }}>
          <StatCard label="Total" value={data?.taskStats.total || 0} color="#3b82f6" />
          <StatCard label="Pending" value={data?.taskStats.pending || 0} color="#eab308" />
          <StatCard label="In Progress" value={data?.taskStats.inProgress || 0} color="#22c55e" />
          <StatCard label="Completed" value={data?.taskStats.completed || 0} color="#10b981" />
        </div>
      </section>

      {/* Activity Feed */}
      <section>
        <h2 style={{ fontSize: "18px", marginBottom: "15px" }}>📈 Activity Feed</h2>
        <div style={{ 
          backgroundColor: "#1e293b", 
          borderRadius: "10px", 
          padding: "20px",
          maxHeight: "400px",
          overflowY: "auto"
        }}>
          {data?.recentActivities.length === 0 ? (
            <p style={{ color: "#64748b", textAlign: "center" }}>No recent activity</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {data?.recentActivities.map(activity => (
                <div key={activity.id} style={{
                  display: "flex",
                  gap: "12px",
                  paddingBottom: "12px",
                  borderBottom: "1px solid #334155"
                }}>
                  <div style={{ 
                    width: "32px", 
                    height: "32px", 
                    borderRadius: "50%", 
                    backgroundColor: "#334155",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "14px",
                    flexShrink: 0
                  }}>
                    {activity.agentName.charAt(0)}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "14px" }}>
                      <span style={{ fontWeight: "bold" }}>{activity.agentName}</span>
                      {" "}
                      <span style={{ color: "#64748b" }}>{activity.message}</span>
                    </div>
                    <div style={{ fontSize: "12px", color: "#64748b", marginTop: "3px" }}>
                      {formatTime(activity.timestamp)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{
      backgroundColor: "#1e293b",
      borderRadius: "10px",
      padding: "15px 25px",
      textAlign: "center",
      minWidth: "120px"
    }}>
      <div style={{ fontSize: "28px", fontWeight: "bold", color }}>{value}</div>
      <div style={{ fontSize: "12px", color: "#64748b", marginTop: "5px" }}>{label}</div>
    </div>
  );
}

export default MissionControl;
