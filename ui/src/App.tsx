import { useQuery, useMutation } from "convex/react";
import { api } from "./convex/api";
import "./App.css";

type Agent = {
  _id: string;
  name: string;
  role: string;
  status?: "active" | "idle" | "busy" | "offline";
  emoji?: string;
  capabilities?: string[];
  heartbeatAt?: number;
};

type Task = {
  _id: string;
  title: string;
  description?: string;
  status: "pending" | "in_progress" | "review" | "completed" | "archived";
  priority?: "low" | "medium" | "high" | "urgent";
  assignees: string[];
  creatorId: string;
  completedAt?: number;
};

type Activity = {
  _id: string;
  agentId: string;
  type: string;
  message: string;
  timestamp: number;
};

type Document = {
  _id: string;
  title: string;
  content: string;
  type: "spec" | "memo" | "decision" | "other";
  authorId: string;
  createdAt: number;
};

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function App() {
  const dashboard = useQuery(api.getDashboard.default);
  const taskBoard = useQuery(api.getTasksByStatus.default);
  const activities = useQuery(api.getActivitiesFiltered.default, { limit: 30 });
  const documents = useQuery(api.getDocuments.default);
  const auditLog = useQuery(api.getAuditLog.default, { limit: 20 });
  const updateTaskStatus = useMutation(api.updateTaskStatus.default);

  if (!dashboard) {
    return (
      <div className="loading">
        <div className="loading-spinner" />
        <p>Connecting to Mission Control...</p>
      </div>
    );
  }

  const statusOrder = ["pending", "in_progress", "review", "completed", "archived"];
  const statusLabels: Record<string, string> = {
    pending: "Pending",
    in_progress: "In Progress",
    review: "Review",
    completed: "Completed",
    archived: "Archived",
  };

  const nextStatus: Record<string, string> = {
    pending: "in_progress",
    in_progress: "review",
    review: "completed",
  };

  const nextLabel: Record<string, string> = {
    pending: "Start",
    in_progress: "Submit for Review",
    review: "Complete",
  };

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>🎯 Mission Control</h1>
        <span className="subtitle">DC81 Operations Hub</span>
      </header>

      {/* Stats Row */}
      <section className="stats-row">
        <div className="stat-card">
          <span className="stat-value">{dashboard.agents.length}</span>
          <span className="stat-label">Agents</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{dashboard.tasks.total}</span>
          <span className="stat-label">Total Tasks</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{dashboard.tasks.in_progress}</span>
          <span className="stat-label">In Progress</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{dashboard.tasks.review}</span>
          <span className="stat-label">In Review</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{dashboard.tasks.completed}</span>
          <span className="stat-label">Completed</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{dashboard.unreadNotifications}</span>
          <span className="stat-label">Notifications</span>
        </div>
      </section>

      {/* Agents */}
      <section className="panel">
        <h2>Squad Status</h2>
        <div className="agents-grid">
          {dashboard.agents.map((agent: Agent) => (
            <div key={agent._id} className={`agent-card status-${agent.status || "offline"}`}>
              <div className="agent-emoji">{agent.emoji || "🤖"}</div>
              <div className="agent-info">
                <strong>{agent.name}</strong>
                <span className="agent-role">{agent.role}</span>
                <span className={`agent-status ${agent.status || "offline"}`}>
                  {agent.status || "offline"}
                </span>
                {agent.capabilities && agent.capabilities.length > 0 && (
                  <div className="agent-capabilities">
                    {agent.capabilities.map((c: string) => (
                      <span key={c} className="capability-badge">{c}</span>
                    ))}
                  </div>
                )}
                {agent.heartbeatAt && (
                  <span className="agent-heartbeat">
                    Last seen: {timeAgo(agent.heartbeatAt)}
                  </span>
                )}
              </div>
            </div>
          ))}
          {dashboard.agents.length === 0 && (
            <p className="empty-state">No agents registered yet</p>
          )}
        </div>
      </section>

      {/* Task Board */}
      <section className="panel">
        <h2>Task Board</h2>
        <div className="kanban">
          {statusOrder.map((status) => {
            const tasks: Task[] = (taskBoard && taskBoard[status]) || [];
            return (
              <div key={status} className="kanban-column">
                <h3>
                  {statusLabels[status]} <span className="count">{tasks.length}</span>
                </h3>
                {tasks.map((task: Task) => (
                  <div key={task._id} className={`task-card priority-${task.priority || "medium"}`}>
                    <strong>{task.title}</strong>
                    {task.description && <p>{task.description}</p>}
                    {task.assignees && task.assignees.length > 0 && (
                      <div className="task-assignees">
                        {task.assignees.map((a: string) => (
                          <span key={a} className="assignee-badge">{a}</span>
                        ))}
                      </div>
                    )}
                    {task.priority && (
                      <span className={`priority-badge priority-${task.priority}`}>
                        {task.priority}
                      </span>
                    )}
                    <div className="task-actions">
                      {nextStatus[status] && (
                        <button
                          onClick={() =>
                            updateTaskStatus({
                              taskId: task._id as any,
                              status: nextStatus[status] as any,
                            })
                          }
                        >
                          {nextLabel[status]}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {tasks.length === 0 && (
                  <div className="kanban-empty">No tasks</div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Activity Feed */}
      <section className="panel">
        <h2>Activity Feed</h2>
        <div className="activity-feed">
          {activities?.map((activity: Activity) => (
            <div key={activity._id} className={`activity-item type-${activity.type}`}>
              <span className="activity-type">{activity.type.replace("_", " ")}</span>
              <span className="activity-agent">{activity.agentId}</span>
              <span className="activity-message">{activity.message}</span>
              <span className="activity-time">{timeAgo(activity.timestamp)}</span>
            </div>
          ))}
          {(!activities || activities.length === 0) && (
            <p className="empty-state">No activity yet</p>
          )}
        </div>
      </section>

      {/* Two-column: Documents + Audit Log */}
      <div className="two-column">
        {/* Documents */}
        <section className="panel">
          <h2>Documents</h2>
          <div className="documents-list">
            {documents?.map((doc: Document) => (
              <div key={doc._id} className="document-card">
                <strong>{doc.title}</strong>
                <span className="doc-type">{doc.type}</span>
                <span className="doc-author">by {doc.authorId}</span>
                <span className="doc-time">{timeAgo(doc.createdAt)}</span>
              </div>
            ))}
            {(!documents || documents.length === 0) && (
              <p className="empty-state">No documents yet</p>
            )}
          </div>
        </section>

        {/* Audit Log */}
        <section className="panel">
          <h2>Audit Log</h2>
          <div className="audit-log">
            {auditLog?.map((entry: any) => (
              <div key={entry._id} className="audit-entry">
                <span className="audit-event">{entry.eventType}</span>
                <span className="audit-actor">{entry.actorId}</span>
                <span className="audit-target">{entry.targetType}{entry.targetId ? `: ${entry.targetId}` : ""}</span>
                {entry.details && <span className="audit-details">{entry.details}</span>}
                <span className="audit-time">{timeAgo(entry.timestamp)}</span>
              </div>
            ))}
            {(!auditLog || auditLog.length === 0) && (
              <p className="empty-state">No audit entries yet</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

export default App;
