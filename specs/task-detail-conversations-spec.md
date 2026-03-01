# Spec: Task Detail Panel + Agent Conversations UI
**Date:** 2026-02-27  
**Author:** Architect  
**For:** Koda (Builder)  
**Status:** Ready for implementation

---

## 1. Situation Assessment

After reviewing all referenced files, **the React component logic is already written** in `App.tsx`. Both `TaskDetailPanel` and `AgentConversationsPanel` are fully implemented, wired up, and referencing the correct Convex API bindings. The Convex backend query `getTasksWithMessages.ts` also exists and is correct.

**The only missing deliverable is CSS.** App.css contains no styles for any of the new components. Koda's task is to add those styles — nothing else needs to be built.

---

## 2. Component Inventory (Already Implemented)

### 2.1 `TaskDetailPanel` (slide-out side panel)
**File:** `ui/src/App.tsx` (already present)  
**Trigger:** Clicking any `.task-card` in the Kanban board sets `selectedTask` state → panel renders  
**Close:** Click overlay or ✕ button → `setSelectedTask(null)`

Sections rendered inside the panel:
1. Title + description
2. Status badge + priority badge + assignees + creator + claimedBy
3. Timestamps grid (created, claimed, started, completed)
4. Approval block (status badge + tier + requestedAt) — conditional
5. Result summary — conditional
6. Last error — conditional
7. Messages list (via `useQuery(api.getMessages.default, { taskId })`)
8. New message form (textarea + send button, `useMutation(api.sendMessage.default)`)

CSS classes used (all need styles):
```
.slide-panel-overlay
.slide-panel
.slide-panel-header
.slide-panel-close
.slide-panel-content
.task-detail-section
.task-detail-title
.task-detail-description
.task-detail-meta
.task-meta-row
.meta-label
.meta-value
.task-detail-subsection
.timestamp-grid
.timestamp-item
.timestamp-label
.timestamp-value
.approval-info
.approval-status-badge
.approval-status-badge.approval-pending
.approval-status-badge.approval-approved
.approval-status-badge.approval-rejected
.approval-tier
.approval-time
.result-summary
.last-error
.error-icon
.error-text
.messages-section
.messages-list
.message-item
.message-header
.message-author
.message-emoji
.message-time
.message-content
.message-mentions
.mention-badge
.no-messages
.new-message-form
.message-input
.send-message-btn
```

Also used (already have styles from existing badge system — do NOT redefine):
- `.status-badge.status-*` — **does NOT exist yet** (see §4.1 below)
- `.priority-badge.priority-*` — exists ✓
- `.assignee-badge` — exists ✓

### 2.2 `AgentConversationsPanel`
**File:** `ui/src/App.tsx` (already present)  
**Location in DOM:** Between Activity Feed and Two-column section  
**Data source:** `useQuery(api.getTasksWithMessages.default)` — returns `TaskWithMessages[]`

CSS classes used:
```
.conversations-list
.conversation-item
.conversation-item.expanded
.conversation-header
.conversation-task-info
.status-indicator
.status-indicator.status-pending
.status-indicator.status-in_progress
.status-indicator.status-review
.status-indicator.status-completed
.status-indicator.status-archived
.conversation-task-title
.conversation-meta
.message-count
.last-activity
.expand-icon
.expand-icon.expanded
.conversation-thread
.thread-message
.thread-message-header
.thread-author
.thread-emoji
.thread-time
.thread-content
```

---

## 3. CSS Specification

All new CSS must be appended to `ui/src/App.css`. Follow the existing synthwave theme — vars are already defined in `:root`.

### 3.1 Slide Panel (Task Detail)

```css
/* ===================== Task Detail Slide Panel ===================== */

/* Full-screen overlay — dimmed, click-to-close */
.slide-panel-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  z-index: 1000;
  display: flex;
  justify-content: flex-end;  /* panel slides in from the right */
}

/* The panel itself — fixed right column, full height, scrollable */
.slide-panel {
  background: var(--bg-secondary);
  border-left: 1px solid var(--border);
  width: 480px;
  max-width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: -4px 0 40px rgba(0, 0, 0, 0.5);
  /* Slide-in animation */
  animation: slideInRight 0.25s ease-out;
}

@keyframes slideInRight {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}

.slide-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid var(--border);
  background: var(--bg-primary);
  flex-shrink: 0;
  position: relative;
}

.slide-panel-header::after {
  content: '';
  position: absolute;
  bottom: -1px;
  left: 0;
  width: 100%;
  height: 1px;
  background: linear-gradient(90deg, var(--neon-cyan), var(--neon-magenta), transparent);
  opacity: 0.4;
}

.slide-panel-header h2 {
  font-family: 'Orbitron', sans-serif;
  font-size: 0.85rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-primary);
  margin: 0;
}

.slide-panel-close {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 1.1rem;
  cursor: pointer;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  transition: color 0.15s, background 0.15s;
}

.slide-panel-close:hover {
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.06);
}

/* Scrollable body of the panel */
.slide-panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

/* ===================== Task Detail Sections ===================== */

.task-detail-section {
  padding-bottom: 1.25rem;
  border-bottom: 1px solid rgba(38, 41, 55, 0.8);
}

.task-detail-section:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.task-detail-title {
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 0.5rem;
  line-height: 1.4;
}

.task-detail-description {
  font-size: 0.85rem;
  color: var(--text-secondary);
  margin-bottom: 0.75rem;
  line-height: 1.6;
}

.task-detail-meta {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.task-meta-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  font-size: 0.82rem;
}

.meta-label {
  font-family: 'Orbitron', sans-serif;
  font-size: 0.6rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
  min-width: 70px;
  flex-shrink: 0;
}

.meta-value {
  color: var(--text-secondary);
}

.task-detail-subsection {
  font-family: 'Orbitron', sans-serif;
  font-size: 0.65rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 0.75rem;
}

/* Status badges (used inside the slide panel) */
.status-badge {
  font-family: 'Orbitron', sans-serif;
  font-size: 0.6rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 0.2rem 0.55rem;
  border-radius: 4px;
  display: inline-block;
}

.status-badge.status-pending        { background: rgba(100, 116, 139, 0.15); color: var(--text-muted); border: 1px solid rgba(100, 116, 139, 0.3); }
.status-badge.status-in_progress    { background: rgba(184, 77, 255, 0.12); color: var(--neon-purple); border: 1px solid rgba(184, 77, 255, 0.25); }
.status-badge.status-review         { background: rgba(245, 158, 11, 0.12); color: var(--warning); border: 1px solid rgba(245, 158, 11, 0.25); }
.status-badge.status-completed      { background: rgba(34, 197, 94, 0.12); color: var(--success); border: 1px solid rgba(34, 197, 94, 0.25); }
.status-badge.status-archived       { background: rgba(38, 41, 55, 0.5); color: var(--text-muted); border: 1px solid var(--border); }

/* ===================== Timestamps ===================== */

.timestamp-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.6rem;
}

.timestamp-item {
  background: var(--bg-muted);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.timestamp-label {
  font-family: 'Orbitron', sans-serif;
  font-size: 0.55rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.timestamp-value {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

/* ===================== Approval ===================== */

.approval-info {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
}

.approval-status-badge {
  font-family: 'Orbitron', sans-serif;
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 0.2rem 0.6rem;
  border-radius: 4px;
}

.approval-status-badge.approval-pending  { background: rgba(245, 158, 11, 0.15); color: var(--warning); border: 1px solid rgba(245, 158, 11, 0.3); }
.approval-status-badge.approval-approved { background: rgba(34, 197, 94, 0.15); color: var(--success); border: 1px solid rgba(34, 197, 94, 0.3); }
.approval-status-badge.approval-rejected { background: rgba(220, 38, 38, 0.15); color: var(--danger); border: 1px solid rgba(220, 38, 38, 0.3); }

.approval-tier {
  font-size: 0.78rem;
  color: var(--text-secondary);
}

.approval-time {
  font-size: 0.72rem;
  color: var(--text-muted);
}

/* ===================== Result Summary / Last Error ===================== */

.result-summary {
  font-size: 0.85rem;
  color: var(--text-secondary);
  line-height: 1.6;
  background: rgba(34, 197, 94, 0.05);
  border: 1px solid rgba(34, 197, 94, 0.15);
  border-radius: 6px;
  padding: 0.75rem 1rem;
}

.last-error {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  background: rgba(220, 38, 38, 0.08);
  border: 1px solid rgba(220, 38, 38, 0.2);
  border-radius: 6px;
  padding: 0.75rem 1rem;
}

.error-icon {
  flex-shrink: 0;
}

.error-text {
  font-size: 0.82rem;
  color: #fca5a5;
  line-height: 1.5;
  word-break: break-word;
}

/* ===================== Messages (inside slide panel) ===================== */

.messages-section {
  flex: 1;
}

.messages-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-bottom: 1rem;
  max-height: 300px;
  overflow-y: auto;
  padding-right: 0.25rem;
}

.message-item {
  background: var(--bg-muted);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.7rem 0.9rem;
  transition: border-color 0.2s;
}

.message-item:hover {
  border-color: rgba(0, 212, 255, 0.2);
}

.message-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.4rem;
}

.message-author {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-family: 'Orbitron', sans-serif;
  font-size: 0.65rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  color: var(--neon-cyan);
  text-shadow: 0 0 6px rgba(0, 212, 255, 0.3);
}

.message-emoji {
  font-size: 1rem;
  filter: drop-shadow(0 0 3px rgba(0, 212, 255, 0.2));
}

.message-time {
  font-size: 0.7rem;
  color: var(--text-muted);
}

.message-content {
  font-size: 0.85rem;
  color: var(--text-secondary);
  line-height: 1.55;
  word-break: break-word;
}

.message-mentions {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin-top: 0.5rem;
  font-size: 0.72rem;
  color: var(--text-muted);
  flex-wrap: wrap;
}

.mention-badge {
  background: rgba(184, 77, 255, 0.12);
  color: var(--neon-purple);
  border: 1px solid rgba(184, 77, 255, 0.2);
  border-radius: 4px;
  padding: 0.1rem 0.4rem;
  font-size: 0.65rem;
}

.no-messages {
  color: var(--text-muted);
  font-size: 0.82rem;
  text-align: center;
  padding: 1.5rem;
  font-style: italic;
}

/* ===================== New Message Form ===================== */

.new-message-form {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--border);
}

.message-input {
  background: var(--bg-muted);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-primary);
  padding: 0.65rem 0.85rem;
  font-size: 0.85rem;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  resize: vertical;
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
  line-height: 1.5;
}

.message-input:focus {
  border-color: rgba(0, 212, 255, 0.4);
  box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.08);
}

.message-input::placeholder {
  color: var(--text-muted);
}

.send-message-btn {
  align-self: flex-end;
  background: linear-gradient(135deg, var(--neon-cyan), var(--neon-magenta));
  color: #0d0f14;
  border: none;
  border-radius: 4px;
  padding: 0.4rem 1.1rem;
  font-size: 0.72rem;
  font-family: 'Orbitron', sans-serif;
  font-weight: 600;
  letter-spacing: 0.05em;
  cursor: pointer;
  transition: opacity 0.2s, box-shadow 0.2s;
}

.send-message-btn:hover:not(:disabled) {
  opacity: 0.9;
  box-shadow: var(--glow-cyan);
}

.send-message-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* ===================== Agent Conversations Panel ===================== */

.conversations-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.conversation-item {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.conversation-item:hover {
  border-color: rgba(0, 212, 255, 0.2);
  box-shadow: var(--glow-cyan-subtle);
}

.conversation-item.expanded {
  border-color: rgba(0, 212, 255, 0.3);
}

/* Clickable header row */
.conversation-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.9rem 1rem;
  cursor: pointer;
  user-select: none;
  transition: background 0.15s;
  gap: 1rem;
}

.conversation-header:hover {
  background: var(--bg-card-hover);
}

.conversation-task-info {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex: 1;
  min-width: 0;
}

/* Coloured dot indicating task status */
.status-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-indicator.status-pending     { background: var(--text-muted); }
.status-indicator.status-in_progress { background: var(--neon-purple); box-shadow: 0 0 6px rgba(184, 77, 255, 0.5); }
.status-indicator.status-review      { background: var(--warning);     box-shadow: 0 0 6px rgba(245, 158, 11, 0.4); }
.status-indicator.status-completed   { background: var(--success);     box-shadow: 0 0 6px rgba(34, 197, 94, 0.4); }
.status-indicator.status-archived    { background: var(--border); }

.conversation-task-title {
  font-size: 0.88rem;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.conversation-meta {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-shrink: 0;
}

.message-count {
  font-size: 0.72rem;
  color: var(--neon-cyan);
  font-family: 'Orbitron', sans-serif;
  letter-spacing: 0.03em;
}

.last-activity {
  font-size: 0.7rem;
  color: var(--text-muted);
  white-space: nowrap;
}

.expand-icon {
  font-size: 0.7rem;
  color: var(--text-muted);
  transition: transform 0.2s;
  display: inline-block;
}

.expand-icon.expanded {
  transform: rotate(180deg);
}

/* Expanded thread */
.conversation-thread {
  border-top: 1px solid var(--border);
  padding: 0.75rem 1rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  background: var(--bg-secondary);
  max-height: 400px;
  overflow-y: auto;
}

.thread-message {
  padding: 0.6rem 0.8rem;
  background: var(--bg-muted);
  border: 1px solid var(--border);
  border-radius: 6px;
}

.thread-message-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.35rem;
}

.thread-author {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-family: 'Orbitron', sans-serif;
  font-size: 0.62rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  color: var(--neon-magenta);
  text-shadow: 0 0 6px rgba(255, 51, 168, 0.25);
}

.thread-emoji {
  font-size: 0.95rem;
}

.thread-time {
  font-size: 0.68rem;
  color: var(--text-muted);
}

.thread-content {
  font-size: 0.83rem;
  color: var(--text-secondary);
  line-height: 1.55;
  word-break: break-word;
}

/* ===================== Responsive — Slide Panel ===================== */

@media (max-width: 600px) {
  .slide-panel {
    width: 100%;
    border-left: none;
    border-top: 1px solid var(--border);
  }
  .timestamp-grid {
    grid-template-columns: 1fr;
  }
}
```

---

## 4. Gap Analysis — Things That Need Attention

### 4.1 `.status-badge` missing from existing CSS
`TaskDetailPanel` renders `<span className={`status-badge status-${task.status}`}>` but `.status-badge` is not defined anywhere in the current `App.css`. The spec above defines it — Koda must add it.

### 4.2 `sendMessage` export name mismatch
`sendMessage.ts` exports `export const sendMessage = mutation({...})` (named export), but `App.tsx` calls `api.sendMessage.default`. In Convex with `anyApi`, this routes by module filename + export name, so `api.sendMessage.default` will fail at runtime — the export should be `default`.

**Fix required in `convex/sendMessage.ts`:**
```typescript
// Change:
export const sendMessage = mutation({ ... })

// To:
export default mutation({ ... })
```

### 4.3 `getTasksWithMessages` export name
`getTasksWithMessages.ts` already uses `export default query(...)` — this is correct. No change needed.

### 4.4 `getMessages` returns messages unsorted
Currently returns `.collect()` with no ordering. Messages will appear in insertion order, which is likely fine for now but should be noted. If ordering becomes an issue, add `.order("asc")` before `.collect()`:
```typescript
.withIndex("by_task", (q) => q.eq("taskId", args.taskId))
.order("asc")
.collect()
```
No schema change required — `by_task` index already exists.

### 4.5 `authorId` hardcoded as `"dominic"`
In `TaskDetailPanel`, `handleSendMessage` hardcodes `authorId: "dominic"`. This is acceptable for the current MVP per the existing pattern in the codebase (same convention used in document uploads). No change required unless Dominic requests multi-user auth later.

---

## 5. No Schema Changes Required

The existing `messages` table schema is complete and sufficient:
- `taskId` (indexed) ✓
- `authorId` ✓
- `content` ✓
- `mentions` ✓
- `createdAt` ✓

No new Convex functions are needed.

---

## 6. Implementation Checklist for Koda

1. **Fix `sendMessage.ts`** — change named export to `export default mutation({...})`
2. **Append all CSS from §3** to the end of `ui/src/App.css`
3. **Verify** the app builds with no TS errors (`npm run build` in `ui/`)
4. **Manual smoke test:**
   - Click a task card → slide panel opens from right ✓
   - Slide panel shows all task fields (including conditional sections) ✓
   - Messages list renders (or shows "No messages yet") ✓
   - Typing + sending a message updates the list reactively ✓
   - Agent Conversations section shows grouped tasks ✓
   - Expanding a conversation shows thread with emoji + author + timestamp ✓
   - Mobile view (600px) — panel goes full-width ✓

---

## 7. File Change Summary

| File | Action | Change |
|------|--------|--------|
| `ui/src/App.css` | **Append** | All new CSS from §3 |
| `convex/sendMessage.ts` | **Fix** | Change named export to `export default` |
| `ui/src/App.tsx` | **No change** | Already complete |
| `convex/getTasksWithMessages.ts` | **No change** | Already correct |
| `convex/getMessages.ts` | **No change** | Works as-is |
| `convex/schema.ts` | **No change** | No schema changes needed |

---

---GRAPH_UPDATE_START---
ENTITIES:
- TYPE: Component | NAME: TaskDetailPanel | file_path: ui/src/App.tsx | component_type: slide-panel | description: Slide-out right panel showing full task details, timestamps, approval info, result summary, last error, and message thread with compose form
- TYPE: Component | NAME: AgentConversationsPanel | file_path: ui/src/App.tsx | component_type: section | description: Top-level dashboard section listing all tasks that have messages, grouped by task, expandable to show full message thread
- TYPE: Component | NAME: ConversationItem | file_path: ui/src/App.tsx | component_type: list-item | description: Expandable row showing task summary and collapsible message thread within AgentConversationsPanel
- TYPE: APIRoute | NAME: getTasksWithMessages | file_path: convex/getTasksWithMessages.ts | method: QUERY | path: api.getTasksWithMessages.default | description: Returns all tasks that have at least one message, with latest message and message count, sorted by most recent activity
- TYPE: APIRoute | NAME: getMessages | file_path: convex/getMessages.ts | method: QUERY | path: api.getMessages.default | description: Returns all messages for a given taskId ordered by insertion
- TYPE: APIRoute | NAME: sendMessage | file_path: convex/sendMessage.ts | method: MUTATION | path: api.sendMessage.default | description: Inserts a message and creates mention notifications; export must be default not named
- TYPE: Decision | NAME: CSS-only implementation | rationale: Component logic already existed in App.tsx; only missing piece was stylesheet rules | alternatives_considered: Refactor into separate component files | status: active
- TYPE: Decision | NAME: Export fix for sendMessage | rationale: App.tsx calls api.sendMessage.default but file uses named export; must change to default export to match Convex anyApi routing | alternatives_considered: Change App.tsx call site to api.sendMessage.sendMessage | status: active

RELATIONSHIPS:
- SOURCE_TYPE: Component | SOURCE: TaskDetailPanel | REL: CALLS | TARGET_TYPE: APIRoute | TARGET: getMessages
- SOURCE_TYPE: Component | SOURCE: TaskDetailPanel | REL: CALLS | TARGET_TYPE: APIRoute | TARGET: sendMessage
- SOURCE_TYPE: Component | SOURCE: AgentConversationsPanel | REL: CALLS | TARGET_TYPE: APIRoute | TARGET: getTasksWithMessages
- SOURCE_TYPE: Component | SOURCE: ConversationItem | REL: CALLS | TARGET_TYPE: APIRoute | TARGET: getMessages
- SOURCE_TYPE: Component | SOURCE: AgentConversationsPanel | REL: DEPENDS_ON | TARGET_TYPE: Component | TARGET: ConversationItem

DECISIONS:
- TITLE: No new Convex schema or functions required | RATIONALE: messages table and all required queries/mutations already exist; this is a pure UI styling task with one export bug fix | ALTERNATIVES: Add dedicated message pagination query if thread length becomes a performance concern
- TITLE: sendMessage must use default export | RATIONALE: App.tsx uses api.sendMessage.default which Convex anyApi resolves as the default export; named export (export const sendMessage) would resolve as api.sendMessage.sendMessage | ALTERNATIVES: Update App.tsx to use api.sendMessage.sendMessage call site instead
---GRAPH_UPDATE_END---
