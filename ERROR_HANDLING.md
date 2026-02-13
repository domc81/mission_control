# ERROR_HANDLING.md: Resilience Patterns

**Date:** 2026-02-08
**Purpose:** Make agents resilient to failures

---

## Error Categories

### 1. Transient Errors (Retry)
- Network timeouts
- Rate limiting
- Temporary service unavailability

### 2. Permanent Errors (Fail Fast)
- Invalid credentials
- Permission denied
- Validation errors

### 3. Degraded Mode (Continue)
- Partial failures
- Missing optional data
- Slow responses

---

## Retry Pattern

### Basic Retry Logic
```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (isTransientError(error) && i < maxRetries - 1) {
        const backoff = delayMs * Math.pow(2, i);
        await sleep(backoff);
        continue;
      }
      throw error;
    }
  }
  throw new Error("Max retries exceeded");
}
```

### Transient Error Detection
```typescript
function isTransientError(error: Error): boolean {
  const messages = [
    "timeout",
    "ECONNRESET",
    "ETIMEDOUT",
    "429",
    "503",
    "rate limit"
  ];
  return messages.some(m => 
    error.message.toLowerCase().includes(m)
  );
}
```

---

## Circuit Breaker Pattern

### Prevent Cascading Failures
```typescript
class CircuitBreaker {
  private failures = 0;
  private lastFailure: number = 0;
  private threshold = 5;
  private timeout = 60000; // 1 minute

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.isOpen()) {
      throw new Error("Circuit breaker open");
    }
    
    try {
      const result = await fn();
      this.reset();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  private isOpen(): boolean {
    if (this.failures >= this.threshold) {
      const elapsed = Date.now() - this.lastFailure;
      return elapsed < this.timeout;
    }
    return false;
  }

  private recordFailure() {
    this.failures++;
    this.lastFailure = Date.now();
  }

  private reset() {
    this.failures = 0;
  }
}
```

---

## Agent-Specific Error Handling

### VEDA (Product Intelligence)
```typescript
async function analyzeCompetitor(url: string) {
  try {
    return await withRetry(() => fetch(url), 3, 1000);
  } catch (error) {
    // Log and continue with alternative sources
    logError("Competitor fetch failed", { url, error });
    return await fallbackAnalysis(url);
  }
}
```

### ORIN (Customer Research)
```typescript
async function conductInterview(userId: string) {
  const circuit = new CircuitBreaker();
  
  try {
    return await circuit.execute(() => 
      scheduleInterview(userId)
    );
  } catch (error) {
    if (isTransientError(error)) {
      // Retry later
      await rescheduleInterview(userId);
      return { status: "pending" };
    }
    // Permanent failure
    logError("Interview failed permanently", { userId });
    return { status: "failed", reason: error.message };
  }
}
```

---

## Dead Letter Queue

### For Failed Tasks
When a task fails permanently, move to DLQ:

```typescript
async function handlePermanentFailure(taskId: string, error: Error) {
  // 1. Log to audit trail
  await ctx.db.insert("auditLog", {
    eventType: "task_permanent_failure",
    actorId: "system",
    targetType: "task",
    targetId: taskId,
    details: error.message,
    timestamp: Date.now()
  });

  // 2. Notify assignee
  await ctx.db.insert("notifications", {
    agentId: assigneeId,
    type: "system",
    content: `Task ${taskId} failed permanently`,
    relatedTaskId: taskId,
    delivered: false,
    createdAt: Date.now()
  });

  // 3. Archive task
  await ctx.db.patch(taskId, { status: "archived" });
}
```

---

## Health Check Endpoints

### Agent Self-Check
```typescript
async function healthCheck(): Promise<{
  status: "healthy" | "degraded" | "down";
  checks: {
    convex: boolean;
    credentials: boolean;
    memory: boolean;
  };
}> {
  const checks = {
    convex: await testConvex(),
    credentials: await testCredentials(),
    memory: await testMemory()
  };

  const allHealthy = Object.values(checks).every(v => v);
  const anyDown = Object.values(checks).some(v => !v);

  return {
    status: allHealthy ? "healthy" : anyDown ? "down" : "degraded",
    checks
  };
}
```

---

## Logging Standards

### Structured Log Format
```typescript
log({
  level: "INFO" | "WARN" | "ERROR",
  event: "task_started" | "task_completed" | "error",
  agentId: "...",
  taskId: "...",
  message: "...",
  metadata: { ... },
  timestamp: Date.now()
});
```

### Log Levels
- **DEBUG:** Detailed debug info (dev only)
- **INFO:** Normal operations
- **WARN:** Degraded but working
- **ERROR:** Something failed

---

## Recovery Procedures

### 1. Agent Crashed
```
Detection: No heartbeat for 30 min
Action: Auto-restart via cron
Escalation: Alert if still down after 3 attempts
```

### 2. Task Timeout
```
Detection: Task in_progress > 24h
Action: Send reminder to assignee
Escalation: Cestra review after 48h
```

### 3. Credential Expired
```
Detection: API calls return 401
Action: Attempt auto-refresh if refresh token exists
Escalation: Alert Dominic for manual fix
```

---

## Test Error Handling

### Chaos Testing
```bash
# Simulate failures
kill Convex connection periodically
Invalidate credentials
Network latency spikes
```

### Recovery Testing
```bash
# Verify
Task resumes after interruption
No data loss
Notifications delivered eventually
```

---

*ERROR_HANDLING - Make it resilient*
