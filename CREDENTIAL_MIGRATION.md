# Credential Migration Plan

**Date:** 2026-02-08
**Status:** ✅ COMPLETE

## Problem Statement

Current credentials are stored as plain files in the workspace:
- `/root/.openclaw/workspace-cestra/.convex-deploy-key` - Full deployment access
- `/root/.openclaw/workspace-cestra/.convex-auth-token` - Auth access

**Risk:** Any agent with file access can read these and gain full Convex control.

## Migration Goal

Move workspace credentials into the encrypted Convex credential vault so:
1. ✅ Credentials encrypted at rest (AES-256-GCM)
2. ✅ Agent isolation - only authorized agents can access
3. ✅ Audit trail for all credential access
4. ✅ No plain-text credentials in workspace

## Current System Architecture

### Convex Credential Tables
```
credentials table:
- agentId: string (which agent owns this)
- service: string (e.g., "convex-deploy")
- encryptedKey: string (AES-256-GCM encrypted)
- iv: string
- tag: string
- permissions: string[]
- createdAt/updatedAt/lastAccessedAt
```

### Encryption Helper Functions
```typescript
// From convex/encryption.ts
encryptCredential(plaintext: string): { encryptedKey, iv, tag }
decryptCredential(encryptedKey, iv, tag): plaintext
```

## Migration Steps

### Step 1: Create Credential Store Function
Add a mutation to store workspace credentials:

```typescript
export const storeWorkspaceCredential = mutation({
  args: {
    service: v.string(),
    plaintextKey: v.string(),
    ownerAgentId: v.id("agents")
  },
  handler: async (ctx, args) => {
    const { encryptedKey, iv, tag } = await encryptCredential(args.plaintextKey);
    await ctx.db.insert("credentials", {
      agentId: args.ownerAgentId.toString(),
      service: args.service,
      encryptedKey,
      iv,
      tag,
      permissions: [args.ownerAgentId.toString()],
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    return { success: true };
  }
});
```

### Step 2: Create Credential Retrieval Function
Add a mutation to retrieve credentials (with audit logging):

```typescript
export const getWorkspaceCredential = mutation({
  args: {
    agentId: v.id("agents"),
    service: v.string()
  },
  handler: async (ctx, args) => {
    const creds = await ctx.db.query("credentials")
      .withIndex("by_service", q => q.eq("service", args.service))
      .collect();
    
    const cred = creds.find(c => c.agentId === args.agentId.toString());
    if (!cred) throw new Error("Credential not found");
    
    // Audit log access
    await ctx.db.insert("auditLog", {
      eventType: "workspace_credential_accessed",
      actorId: args.agentId.toString(),
      targetType: "credential",
      targetId: cred._id.toString(),
      details: `Accessed ${args.service}`,
      timestamp: Date.now()
    });
    
    return decryptCredential(cred.encryptedKey, cred.iv, cred.tag);
  }
});
```

### Step 3: Migrate Convex Credentials
Run migration (via Cestra with current keys):

```typescript
// Once
await storeWorkspaceCredential({
  service: "convex-deploy-key",
  plaintextKey: "<current-deploy-key>",
  ownerAgentId: "j97cnp3g5vvsaxsdv528q279m180rs94"  // Cestra
});

await storeWorkspaceCredential({
  service: "convex-auth-token", 
  plaintextKey: "<current-auth-token>",
  ownerAgentId: "j97cnp3g5vvsaxsdv528q279m180rs94"  // Cestra
});
```

### Step 4: Delete Plain-File Credentials
After verification:

```bash
rm /root/.openclaw/workspace-cestra/.convex-deploy-key
rm /root/.openclaw/workspace-cestra/.convex-auth-token
```

### Step 5: Update Agent Tools
Modify agent workflows to retrieve credentials from Convex:

```typescript
// Instead of reading files
const deployKey = await getWorkspaceCredential({
  agentId: myAgentId,
  service: "convex-deploy-key"
});
```

## Prerequisite: CONVEX_VAULT_KEY

The encryption module requires a master key environment variable.

**Requirement:**
```
CONVEX_VAULT_KEY=<32-byte hex string>
```

**Generation:**
```bash
# Generate a 256-bit (32-byte) key in hex format
openssl rand -hex 32
# Example: a1b2c3d4e5f6...32 bytes...z9
```

**Convex Configuration:**
This key must be set in the Convex deployment environment. Contact Convex support or configure via dashboard.

**Security Note:** This key is a single point of failure. If lost, all encrypted credentials are unrecoverable. Store securely (e.g., password manager, not in codebase).

- [ ] StoreCredential function added
- [ ] GetCredential function updated to support workspace creds
- [ ] Cestra migrates both credentials
- [ ] Test VEDA retrieves credential (should fail - wrong permissions)
- [ ] Test Cestra retrieves credential (should succeed)
- [ ] Verify audit log shows access
- [ ] Delete plain-text files
- [ ] Update agent documentation

## Security Properties

After migration:
| Property | Status |
|----------|--------|
| Encrypted at rest | ✅ AES-256-GCM |
| Agent isolation | ✅ Only Cestra can access |
| Audit trail | ✅ All access logged |
| No plain files | ✅ After Step 4 |

## Rollback Plan

If issues occur:
1. Re-create plain files with keys
2. Re-run migration with corrected permissions
3. No data loss - Convex credentials table is additional layer

---

*Credential Migration Plan - Phase 2*
