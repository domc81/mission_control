import { useState, useRef } from "react";
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
  claimedBy?: string;
  claimedAt?: number;
  startedAt?: number;
  completedAt?: number;
  lastError?: string;
  approvalStatus?: "pending" | "approved" | "rejected";
  approvalTier?: "auto" | "notify" | "gate" | "blocked";
  approvalRequestedAt?: number;
  approvalRespondedAt?: number;
  resultSummary?: string;
  createdAt: number;
  updatedAt: number;
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
  type: "spec" | "memo" | "decision" | "guide" | "other";
  authorId: string;
  createdAt: number;
  storageId?: string;
  fileName?: string;
};

type Message = {
  _id: string;
  taskId: string;
  authorId: string;
  content: string;
  mentions: string[];
  createdAt: number;
};

type TaskWithMessages = {
  task: Task;
  message: Message;
  messageCount: number;
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

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

function getAgentEmoji(authorId: string): string {
  const agentEmojis: Record<string, string> = {
    "dominic": "👤",
    "cestra": "🎯",
    "veda": "🔮",
    "orin": "🔍",
    "vision": "👁️",
    "loki": "🎭",
    "fin": "💰",
  };
  return agentEmojis[authorId.toLowerCase()] || "🤖";
}

/** Minimal Markdown → HTML renderer (no external deps) */
function renderMarkdown(md: string): string {
  return md
    // Headings
    .replace(/^#### (.+)$/gm, "<h4>$1</h4>")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    // Bold + italic
    .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // Horizontal rules
    .replace(/^---$/gm, "<hr/>")
    // Tables — header row
    .replace(/^\|(.+)\|$/gm, (line) => {
      const cells = line.split("|").filter((_, i, a) => i > 0 && i < a.length - 1);
      // Detect separator row
      if (cells.every(c => /^[-: ]+$/.test(c))) return "<tr data-sep/>";
      return "<tr>" + cells.map(c => `<td>${c.trim()}</td>`).join("") + "</tr>";
    })
    // Wrap consecutive <tr> in <table>
    .replace(/(<tr[^>]*>.*?<\/tr>\n?)+/gs, (block) => {
      const rows = block.replace(/<tr data-sep\/>\n?/g, "");
      // Promote first row to thead
      const firstEnd = rows.indexOf("</tr>") + 5;
      const thead = rows.slice(0, firstEnd).replace(/<td>/g, "<th>").replace(/<\/td>/g, "</th>");
      const tbody = rows.slice(firstEnd);
      return `<table><thead>${thead}</thead><tbody>${tbody}</tbody></table>`;
    })
    // Unordered lists
    .replace(/^[\-\*] (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>\n?)+/gs, "<ul>$&</ul>")
    // Inline code
    .replace(/`(.+?)`/g, "<code>$1</code>")
    // Paragraphs — blank-line separated blocks not already tagged
    .split(/\n\n+/)
    .map(block => {
      const trimmed = block.trim();
      if (/^<(h[1-6]|ul|ol|li|table|hr|blockquote)/.test(trimmed)) return trimmed;
      if (trimmed === "") return "";
      return `<p>${trimmed.replace(/\n/g, "<br/>")}</p>`;
    })
    .join("\n");
}

/** Shows a download link for a document with a Convex storageId */
function DocumentFileLink({ storageId, fileName }: { storageId: string; fileName?: string }) {
  const fileUrl = useQuery(api.getFileUrl.default, { storageId });
  if (!fileUrl) return <span className="doc-file-loading">Loading file…</span>;
  return (
    <a
      className="doc-file-link"
      href={fileUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={e => e.stopPropagation()}
    >
      📎 {fileName || "Download file"}
    </a>
  );
}

function DocumentModal({ doc, onClose }: { doc: Document; onClose: () => void }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">{doc.title}</h2>
            <div className="modal-meta">
              <span className="doc-type">{doc.type}</span>
              <span className="doc-author">by {doc.authorId}</span>
              <span className="doc-time">{timeAgo(doc.createdAt)}</span>
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        {doc.storageId && (
          <div className="modal-file-section">
            <DocumentFileLink storageId={doc.storageId} fileName={doc.fileName} />
          </div>
        )}
        <div
          className="modal-body markdown-content"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(doc.content) }}
        />
      </div>
    </div>
  );
}

/** Task Detail Slide-out Panel */
function TaskDetailPanel({ task, onClose, onUpdateStatus }: { task: Task; onClose: () => void; onUpdateStatus: (args: {taskId: string; status: string}) => void }) {
  const messages = useQuery(api.getMessages.default, { taskId: task._id as any });
  const sendMessage = useMutation(api.sendMessage.default);
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!newMessage.trim() || sending) return;
    setSending(true);
    try {
      await sendMessage({
        taskId: task._id as any,
        authorId: "dominic",
        content: newMessage.trim(),
        mentions: [],
      });
      setNewMessage("");
    } catch (err) {
      console.error("Failed to send message:", err);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="slide-panel-overlay" onClick={onClose}>
      <div className="slide-panel" onClick={e => e.stopPropagation()}>
        <div className="slide-panel-header">
          <h2>Task Details</h2>
          <button className="slide-panel-close" onClick={onClose}>✕</button>
        </div>
        
        <div className="slide-panel-content">
          {/* Task Info */}
          <div className="task-detail-section">
            <h3 className="task-detail-title">{task.title}</h3>
            {task.description && (
              <p className="task-detail-description">{task.description}</p>
            )}
            
            <div className="task-detail-meta">
              <div className="task-meta-row">
                <span className="meta-label">Status:</span>
                <select
                  className={`status-badge status-${task.status}`}
                  value={task.status}
                  onChange={e => onUpdateStatus({ taskId: task._id, status: e.target.value })}
                  style={{ cursor: "pointer", border: "none", background: "transparent", fontWeight: "inherit", fontSize: "inherit" }}
                >
                  <option value="pending">pending</option>
                  <option value="in_progress">in progress</option>
                  <option value="review">review</option>
                  <option value="completed">completed</option>
                  <option value="blocked">blocked</option>
                </select>
              </div>
              <div className="task-meta-row">
                <span className="meta-label">Priority:</span>
                <span className={`priority-badge priority-${task.priority || "medium"}`}>
                  {task.priority || "medium"}
                </span>
              </div>
              <div className="task-meta-row">
                <span className="meta-label">Assignees:</span>
                <div className="task-assignees">
                  {task.assignees.length > 0 ? (
                    task.assignees.map((a: string) => (
                      <span key={a} className="assignee-badge">{a}</span>
                    ))
                  ) : (
                    <span className="meta-value">Unassigned</span>
                  )}
                </div>
              </div>
              <div className="task-meta-row">
                <span className="meta-label">Creator:</span>
                <span className="meta-value">{task.creatorId}</span>
              </div>
              {task.claimedBy && (
                <div className="task-meta-row">
                  <span className="meta-label">Claimed By:</span>
                  <span className="meta-value">{task.claimedBy}</span>
                </div>
              )}
            </div>
          </div>

          {/* Timestamps */}
          <div className="task-detail-section">
            <h4 className="task-detail-subsection">Timestamps</h4>
            <div className="timestamp-grid">
              <div className="timestamp-item">
                <span className="timestamp-label">Created</span>
                <span className="timestamp-value">{formatTimestamp(task.createdAt)}</span>
              </div>
              {task.claimedAt && (
                <div className="timestamp-item">
                  <span className="timestamp-label">Claimed</span>
                  <span className="timestamp-value">{formatTimestamp(task.claimedAt)}</span>
                </div>
              )}
              {task.startedAt && (
                <div className="timestamp-item">
                  <span className="timestamp-label">Started</span>
                  <span className="timestamp-value">{formatTimestamp(task.startedAt)}</span>
                </div>
              )}
              {task.completedAt && (
                <div className="timestamp-item">
                  <span className="timestamp-label">Completed</span>
                  <span className="timestamp-value">{formatTimestamp(task.completedAt)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Approval Status */}
          {task.approvalStatus && (
            <div className="task-detail-section">
              <h4 className="task-detail-subsection">Approval</h4>
              <div className="approval-info">
                <span className={`approval-status-badge approval-${task.approvalStatus}`}>
                  {task.approvalStatus}
                </span>
                {task.approvalTier && (
                  <span className="approval-tier">Tier: {task.approvalTier}</span>
                )}
                {task.approvalRequestedAt && (
                  <span className="approval-time">Requested: {formatTimestamp(task.approvalRequestedAt)}</span>
                )}
              </div>
            </div>
          )}

          {/* Result Summary */}
          {task.resultSummary && (
            <div className="task-detail-section">
              <h4 className="task-detail-subsection">Result Summary</h4>
              <p className="result-summary">{task.resultSummary}</p>
            </div>
          )}

          {/* Last Error */}
          {task.lastError && (
            <div className="task-detail-section">
              <h4 className="task-detail-subsection">Last Error</h4>
              <div className="last-error">
                <span className="error-icon">⚠️</span>
                <span className="error-text">{task.lastError}</span>
              </div>
            </div>
          )}

          {/* Messages Section */}
          <div className="task-detail-section messages-section">
            <h4 className="task-detail-subsection">Messages</h4>
            
            <div className="messages-list">
              {messages?.map((msg: Message) => (
                <div key={msg._id} className="message-item">
                  <div className="message-header">
                    <span className="message-author">
                      <span className="message-emoji">{getAgentEmoji(msg.authorId)}</span>
                      {msg.authorId}
                    </span>
                    <span className="message-time">{timeAgo(msg.createdAt)}</span>
                  </div>
                  <div className="message-content">{msg.content}</div>
                  {msg.mentions.length > 0 && (
                    <div className="message-mentions">
                      Mentions: {msg.mentions.map((m: string) => (
                        <span key={m} className="mention-badge">{m}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {(!messages || messages.length === 0) && (
                <p className="no-messages">No messages yet</p>
              )}
            </div>

            {/* New Message Form */}
            <form className="new-message-form" onSubmit={handleSendMessage}>
              <textarea
                className="message-input"
                placeholder="Type a message..."
                value={newMessage}
                onChange={e => setNewMessage(e.target.value)}
                rows={3}
              />
              <button 
                type="submit" 
                className="send-message-btn"
                disabled={!newMessage.trim() || sending}
              >
                {sending ? "Sending..." : "Send Message"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Agent Conversations Panel */
function AgentConversationsPanel() {
  const tasksWithMessages = useQuery(api.getTasksWithMessages.default);
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const messagesByTask = useRef<Map<string, Message[]>>(new Map());

  function toggleTask(taskId: string) {
    const newExpanded = new Set(expandedTasks);
    if (newExpanded.has(taskId)) {
      newExpanded.delete(taskId);
    } else {
      newExpanded.add(taskId);
      // Fetch messages when expanding
      if (!messagesByTask.current.has(taskId)) {
        // Messages will be fetched by the component when rendered
      }
    }
    setExpandedTasks(newExpanded);
  }

  return (
    <section className="panel">
      <h2>Agent Conversations</h2>
      <div className="conversations-list">
        {tasksWithMessages?.map(({ task, message, messageCount }: TaskWithMessages) => (
          <ConversationItem 
            key={task._id}
            task={task}
            lastMessage={message}
            messageCount={messageCount}
            isExpanded={expandedTasks.has(task._id)}
            onToggle={() => toggleTask(task._id)}
          />
        ))}
        {(!tasksWithMessages || tasksWithMessages.length === 0) && (
          <p className="empty-state">No conversations yet</p>
        )}
      </div>
    </section>
  );
}

/** Individual Conversation Item */
function ConversationItem({ 
  task, 
  lastMessage, 
  messageCount, 
  isExpanded, 
  onToggle 
}: { 
  task: Task; 
  lastMessage: Message; 
  messageCount: number;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const messages = useQuery(api.getMessages.default, isExpanded ? { taskId: task._id as any } : "skip");

  return (
    <div className={`conversation-item ${isExpanded ? "expanded" : ""}`}>
      <div className="conversation-header" onClick={onToggle}>
        <div className="conversation-task-info">
          <span className={`status-indicator status-${task.status}`}></span>
          <span className="conversation-task-title">{task.title}</span>
        </div>
        <div className="conversation-meta">
          <span className="message-count">{messageCount} messages</span>
          <span className="last-activity">{timeAgo(lastMessage.createdAt)}</span>
          <span className={`expand-icon ${isExpanded ? "expanded" : ""}`}>▼</span>
        </div>
      </div>
      
      {isExpanded && (
        <div className="conversation-thread">
          {messages?.map((msg: Message) => (
            <div key={msg._id} className="thread-message">
              <div className="thread-message-header">
                <span className="thread-author">
                  <span className="thread-emoji">{getAgentEmoji(msg.authorId)}</span>
                  {msg.authorId}
                </span>
                <span className="thread-time">{formatTimestamp(msg.createdAt)}</span>
              </div>
              <div className="thread-content">{msg.content}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function App() {
  const dashboard = useQuery(api.getDashboard.default);
  const taskBoard = useQuery(api.getTasksByStatus.default);
  const activities = useQuery(api.getActivitiesFiltered.default, { limit: 30 });
  const documents = useQuery(api.getDocuments.default);
  const auditLog = useQuery(api.getAuditLog.default, { limit: 20 });
  const updateTaskStatus = useMutation(api.updateTaskStatus.default);
  const generateUploadUrl = useMutation(api.generateUploadUrl.default);
  const createDocument = useMutation(api.createDocument.default);

  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [uploadState, setUploadState] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [uploadTitle, setUploadTitle] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  async function handleFileUpload(e: React.FormEvent) {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file || !uploadTitle.trim()) return;
    setUploadState("uploading");
    try {
      const uploadUrl = await generateUploadUrl({});
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!res.ok) throw new Error("Upload failed");
      const { storageId } = await res.json();
      await createDocument({
        title: uploadTitle.trim(),
        content: `File: ${file.name}`,
        type: "other",
        authorId: "dominic",
        storageId,
        fileName: file.name,
      });
      setUploadTitle("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      setUploadState("done");
      setTimeout(() => setUploadState("idle"), 3000);
    } catch (err) {
      console.error(err);
      setUploadState("error");
      setTimeout(() => setUploadState("idle"), 4000);
    }
  }

  return (
    <div className="dashboard">
      {selectedDoc && (
        <DocumentModal doc={selectedDoc} onClose={() => setSelectedDoc(null)} />
      )}
      
      {selectedTask && (
        <TaskDetailPanel task={selectedTask} onClose={() => setSelectedTask(null)} onUpdateStatus={({ taskId, status }) => updateTaskStatus({ taskId: taskId as any, status: status as any })} />
      )}

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
                  <div 
                    key={task._id} 
                    className={`task-card priority-${task.priority || "medium"}`}
                    onClick={() => setSelectedTask(task)}
                  >
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
                          onClick={(e) => {
                            e.stopPropagation();
                            updateTaskStatus({
                              taskId: task._id as any,
                              status: nextStatus[status] as any,
                            })
                          }}
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

      {/* Agent Conversations Panel */}
      <AgentConversationsPanel />

      {/* Two-column: Documents + Audit Log */}
      <div className="two-column">
        {/* Documents */}
        <section className="panel">
          <h2>Documents</h2>

          {/* File Upload */}
          <form className="doc-upload-form" onSubmit={handleFileUpload}>
            <input
              type="text"
              placeholder="Document title"
              value={uploadTitle}
              onChange={e => setUploadTitle(e.target.value)}
              className="doc-upload-title"
            />
            <input
              type="file"
              ref={fileInputRef}
              className="doc-upload-file"
            />
            <button
              type="submit"
              className="doc-upload-btn"
              disabled={uploadState === "uploading"}
            >
              {uploadState === "uploading" ? "Uploading…" : uploadState === "done" ? "✓ Uploaded!" : uploadState === "error" ? "✗ Error" : "Upload File"}
            </button>
          </form>

          <div className="documents-list">
            {documents?.map((doc: Document) => (
              <div
                key={doc._id}
                className="document-card document-card--clickable"
                onClick={() => setSelectedDoc(doc)}
              >
                <strong>{doc.title}</strong>
                <span className="doc-type">{doc.type}</span>
                <span className="doc-author">by {doc.authorId}</span>
                <span className="doc-time">{timeAgo(doc.createdAt)}</span>
                {doc.storageId ? (
                  <DocumentFileLink storageId={doc.storageId} fileName={doc.fileName} />
                ) : (
                  <span className="doc-open-hint">Click to read →</span>
                )}
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