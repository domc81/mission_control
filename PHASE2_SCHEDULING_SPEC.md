# Phase 2: Post Scheduling Engine — Architecture & Spec

**Phase:** 2 of Mission Control Expansion  
**Date:** 2026-03-13  
**Author:** Cestra (spec), Koda (implementation)  
**Priority:** HIGH — Immediate pain point

---

## Problem

When Dominic approves a batch of social posts, they all fire at once. That's wrong. Posts should be scheduled into optimal time windows for each platform.

## Optimal Posting Windows (UK Time)

| Platform   | Times                                      |
|------------|-------------------------------------------|
| LinkedIn   | 09:00                                     |
| X          | 09:30, 13:00, 17:00                       |
| Instagram  | 10:00                                     |
| Facebook   | 10:30                                     |

---

## Architecture

### Current Flow
```
Approve → late-post.py → Late API (publishNow: true)
```

### New Flow
```
Approve → Calculate next slot → Update social_posts scheduled_for → Late API (scheduledFor)
                                    ↓
                            Cron job checks every minute
                                    ↓
                            If time reached → Publish
```

### Components

1. **Scheduler Service** (`src/lib/scheduler.ts`)
   - `calculateNextSlot(platform: string, fromDate: Date): Date`
   - Returns the next available slot for the platform

2. **Scheduled Publisher** (`scripts/scheduled-publisher.py`)
   - Runs via cron every minute
   - Queries `social_posts` WHERE `scheduled_for <= NOW()` AND `status = 'approved'`
   - Calls Late API for each
   - Updates status to `posted` on success, `failed` on error

3. **Timeline UI** (`src/components/ContentTimeline.tsx`)
   - Visual calendar showing scheduled posts
   - Platform colour coding
   - Click to view/edit

---

## Scheduler Logic

```typescript
const PLATFORM_WINDOWS = {
  linkedin: [{ hour: 9, minute: 0 }],
  x: [{ hour: 9, minute: 30 }, { hour: 13, minute: 0 }, { hour: 17, minute: 0 }],
  instagram: [{ hour: 10, minute: 0 }],
  facebook: [{ hour: 10, minute: 30 }],
};

function calculateNextSlot(platform: string, fromDate: Date = new Date()): Date {
  const windows = PLATFORM_WINDOWS[platform];
  if (!windows) return fromDate; // No scheduling for unknown platforms

  const now = new Date(fromDate);
  
  for (const window of windows) {
    const slot = new Date(now);
    slot.setHours(window.hour, window.minute, 0, 0);
    
    if (slot > now) {
      return slot; // Found a slot today
    }
  }
  
  // All slots passed today, find first slot tomorrow
  const firstTomorrow = new Date(now);
  firstTomorrow.setDate(firstTomorrow.getDate() + 1);
  firstTomorrow.setHours(windows[0].hour, windows[0].minute, 0, 0);
  return firstTomorrow;
}
```

---

## Database Changes

### Table: `social_posts` (already exists, add column)

```sql
ALTER TABLE social_posts ADD COLUMN scheduled_for TIMESTAMPTZ;
```

---

## Updated Approval Flow

### approve-post.sh

```bash
# Before: node x-post.cjs $POST_ID
# After: 
SCHEDULED=$(python3 /root/.openclaw/workspace-cestra/scripts/calculate-slot.py $PLATFORM)
UPDATE social_posts SET status='approved', scheduled_for='$SCHEDULED' WHERE id='$POST_ID'
```

### late-post.py Update

Modify to read `scheduled_for`:
- If `scheduled_for` is NULL or in past → publish immediately
- If `scheduled_for` is in future → use Late API `scheduledFor` parameter

```python
scheduled_for = row.get('scheduled_for')
if scheduled_for and scheduled_for > datetime.now():
    # Schedule for later
    payload['scheduledFor'] = scheduled_for.isoformat()
    payload['publishNow'] = False
else:
    # Publish immediately
    payload['publishNow'] = True
```

---

## Scheduled Publisher (cron job)

File: `/root/.openclaw/workspace-cestra/scripts/scheduled-publisher.py`

```python
#!/usr/bin/env python3
"""
Runs every minute via cron.
Finds approved posts with scheduled_for <= now.
Publishes them via Late API.
"""
import sys
sys.path.insert(0, '/root/.openclaw/workspace-cestra/scripts')
from load_late_env import load_env
load_env()

import logging
from datetime import datetime, timezone
from late_post import LatePoster
import requests

logging.basicConfig(
    filename='/root/.openclaw/workspace-cestra/logs/scheduled-publisher.log',
    level=logging.INFO
)

def main():
    # Query Supabase for posts ready to publish
    query = """
    SELECT id, platform, content, media_urls, scheduled_for
    FROM social_posts
    WHERE status = 'approved'
    AND scheduled_for <= NOW()
    ORDER BY scheduled_for ASC
    """
    # Execute query via Supabase REST API...
    
    for post in posts_to_publish:
        try:
            # Call Late API
            poster = LatePoster()
            result = poster.publish(post)
            
            if result['status'] == 'success':
                # Update to posted
                update_status(post['id'], 'posted', result['post_id'])
            else:
                # Update to failed
                update_status(post['id'], 'failed', error=result['error'])
        except Exception as e:
            update_status(post['id'], 'failed', error=str(e))
            logging.error(f"Failed to publish {post['id']}: {e}")

if __name__ == '__main__':
    main()
```

---

## Cron Setup

```bash
# Run scheduled publisher every minute
* * * * * /usr/bin/python3 /root/.openclaw/workspace-cestra/scripts/scheduled-publisher.py >> /dev/null 2>&1
```

---

## Timeline UI Component

```typescript
interface TimelinePost {
  id: string;
  platform: string;
  content: string;
  scheduled_for: Date;
  status: 'approved' | 'posted' | 'failed';
}

export function ContentTimeline() {
  const { data: posts } = useQuery('scheduledPosts');
  
  return (
    <div className="content-timeline">
      <h2>Content Schedule</h2>
      <div className="timeline-grid">
        {posts.map(post => (
          <div key={post.id} className={`timeline-item ${post.platform}`}>
            <span className="platform-badge">{post.platform}</span>
            <span className="scheduled-time">
              {formatDate(post.scheduled_for)}
            </span>
            <span className="content-preview">
              {post.content.substring(0, 50)}...
            </span>
            <span className={`status ${post.status}`}>{post.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## Knowledge Graph Updates (After Implementation)

### Scripts to Add
- `scheduled-publisher.py` — cron job script
- `calculate-slot.py` — utility for calculating next slot

### Decisions to Add
- `Platform-specific posting windows` — scheduling logic for optimal posting times

### Relationships
- `approve-post.sh` — CALLS → `calculate-slot.py`
- `approve-post.sh` — WRITES_TO → `social_posts` (scheduled_for)
- `scheduled-publisher.py` — READS_FROM → `social_posts`
- `scheduled-publisher.py` — CALLS → `late-post.py`

---

## Testing Checklist

- [ ] calculate-slot.py returns correct next slot for each platform
- [ ] approve-post.sh schedules posts instead of publishing immediately
- [ ] late-post.py handles scheduledFor parameter correctly
- [ ] scheduled-publisher.py runs via cron every minute
- [ ] Posts are published at scheduled time
- [ ] Failed posts are logged and marked as failed
- [ ] Timeline UI shows scheduled posts
- [ ] npm run build passes
- [ ] Knowledge Graph updated

---

## Next Steps

1. **Koda:** Implement spec
2. **Kyra:** Code review  
3. **Koda:** Fix issues, commit, push
4. **Koda:** Trigger Coolify deploy
5. **Cestra:** Update Knowledge Graph
6. **Cestra:** Notify Dominic