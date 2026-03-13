# PHASE 1 AUTH SPEC — Mission Control Supabase Authentication

**Produced by:** Architect  
**Date:** 2026-03-13  
**Status:** READY FOR IMPLEMENTATION  
**Assigned to:** Koda (Builder)

---

## Assumptions & Context

> **⚠️ No existing knowledge graph context was injected for Mission Control.**  
> The following assumptions are made and must be verified by Cestra/Koda before implementation:
>
> - Mission Control is a **React SPA** (not Next.js App Router) — based on the reference to `App.tsx` in the brief. Stack is React + TypeScript + Tailwind CSS.
> - The app currently has a single `App.tsx` entry point with 7 sections rendered as routes or conditional views.
> - No auth layer currently exists.
> - Deployment target is Vercel or similar static host.
> - Supabase project is already provisioned (URL and anon key available).
> - `@supabase/auth-helpers-react` is to be used as specified.

---

## 1. Component Architecture

```
src/
├── main.tsx                          (unchanged — renders <App />)
├── App.tsx                           (MODIFIED — wrap with AuthProvider, gate routes)
├── lib/
│   └── supabaseClient.ts             (NEW — Supabase client singleton)
├── context/
│   └── AuthContext.tsx               (NEW — AuthProvider + useAuth hook)
├── components/
│   ├── auth/
│   │   ├── LoginPage.tsx             (NEW — email/password login form)
│   │   ├── ProtectedRoute.tsx        (NEW — route guard wrapper)
│   │   └── LogoutButton.tsx          (NEW — logout trigger, used in nav)
│   └── ... (existing components, unchanged)
└── .env.local                        (EXISTING — add new vars, see §6)
```

### Dependency Graph

```
App.tsx
  └── AuthProvider (AuthContext.tsx)
        └── ProtectedRoute (ProtectedRoute.tsx)
              └── [All 7 existing sections/routes]
        └── LoginPage (LoginPage.tsx)
              └── supabaseClient (lib/supabaseClient.ts)

LogoutButton (any nav component)
  └── useAuth (AuthContext.tsx)
        └── supabaseClient (lib/supabaseClient.ts)
```

---

## 2. Auth Flow

```
User visits any route
        │
        ▼
ProtectedRoute checks useAuth().session
        │
   ┌────┴────┐
   │         │
session    no session
present    present
   │         │
   ▼         ▼
Render    Redirect to /login
route     (replace history)
   
/login route
        │
User submits email + password
        │
        ▼
supabase.auth.signInWithPassword({ email, password })
        │
   ┌────┴──────────┐
   │               │
success          error
   │               │
   ▼               ▼
Session stored   Show inline error message
in localStorage  (do NOT redirect)
        │
        ▼
AuthContext session state updated
        │
        ▼
ProtectedRoute re-evaluates → renders protected content
```

### Session Persistence

- Supabase `@supabase/auth-helpers-react` persists session to `localStorage` automatically.
- On app load, `AuthProvider` calls `supabase.auth.getSession()` to rehydrate session.
- `supabase.auth.onAuthStateChange()` listener updates context state on token refresh or sign-out.
- Session token auto-refreshes via Supabase SDK — no manual refresh logic needed.

### Logout Flow

```
User clicks LogoutButton
        │
        ▼
useAuth().signOut() called
        │
        ▼
supabase.auth.signOut()
        │
        ▼
AuthContext clears session state
        │
        ▼
ProtectedRoute redirects to /login
```

---

## 3. Component Specifications

### 3.1 `src/lib/supabaseClient.ts`

```typescript
import { createClient } from '@supabase/supabase-js'

const supabaseUrl: string = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey: string = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
```

> **Note:** Uses `VITE_` prefix assuming Vite bundler. If CRA (Create React App), use `REACT_APP_` prefix instead. Koda to confirm bundler.

---

### 3.2 `src/context/AuthContext.tsx`

**Exports:**
- `AuthProvider` — React context provider component
- `useAuth` — custom hook

**State managed:**
```typescript
type AuthContextValue = {
  session: Session | null        // Supabase Session object or null
  user: User | null              // Supabase User object or null
  loading: boolean               // true while initial session check is in flight
  signOut: () => Promise<void>   // triggers supabase.auth.signOut()
}
```

**Behaviour:**
1. On mount: call `supabase.auth.getSession()` → set `session` and `loading: false`
2. Register `supabase.auth.onAuthStateChange()` → update `session` and `user` on every auth event
3. Unsubscribe from auth state listener on unmount
4. `signOut()`: calls `supabase.auth.signOut()` — context state updates automatically via the listener

**Children rendered:**
- While `loading === true`: render a full-screen loading spinner (simple `<div>` centred, no external dependency)
- While `loading === false`: render `{children}`

---

### 3.3 `src/components/auth/LoginPage.tsx`

**Props:** none

**Local state:**
```typescript
email: string
password: string
error: string | null
loading: boolean
```

**Form fields:**
- Email input: `type="email"`, `autoComplete="email"`, `autoFocus`
- Password input: `type="password"`, `autoComplete="current-password"`
- Submit button: disabled while `loading === true`

**Behaviour:**
1. On submit: set `loading: true`, clear `error`
2. Call `supabase.auth.signInWithPassword({ email, password })`
3. On error: set `error` to `error.message`, set `loading: false`
4. On success: do nothing — `AuthContext` listener handles state update and `ProtectedRoute` handles redirect

**Styling:**
- Centred card layout, full viewport height
- Consistent with existing Mission Control UI (Tailwind classes — Koda to match existing design tokens)
- Error displayed as red inline text below form, not as alert/toast

**No registration link.** No "forgot password" link. This is a single-user admin tool.

---

### 3.4 `src/components/auth/ProtectedRoute.tsx`

**Props:**
```typescript
type ProtectedRouteProps = {
  children: React.ReactNode
}
```

**Behaviour:**
1. Read `{ session, loading }` from `useAuth()`
2. If `loading`: return null (AuthProvider already renders spinner during load)
3. If `!session`: redirect to `/login` (using `react-router-dom` `<Navigate replace to="/login" />`)
4. If `session`: render `{children}`

> **Assumption:** The app uses `react-router-dom` for routing. If routing is handled differently (e.g., conditional rendering in App.tsx), Koda must adapt the redirect mechanism accordingly — the logic remains identical.

---

### 3.5 `src/components/auth/LogoutButton.tsx`

**Props:**
```typescript
type LogoutButtonProps = {
  className?: string   // pass-through for styling flexibility
}
```

**Behaviour:**
- Renders a `<button>` with text "Sign out"
- On click: calls `useAuth().signOut()`
- Shows no loading state (sign-out is near-instant)

**Placement:** Koda to add `<LogoutButton />` to the existing navigation/header component used across all 7 sections. Exact component name unknown — Koda to identify and integrate.

---

## 4. `App.tsx` Integration

**Current assumed structure:**
```tsx
// App.tsx (BEFORE)
function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Section1 />} />
        <Route path="/section2" element={<Section2 />} />
        // ... 7 routes
      </Routes>
    </Router>
  )
}
```

**Required change — wrap with AuthProvider and ProtectedRoute:**
```tsx
// App.tsx (AFTER)
function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/*"
            element={
              <ProtectedRoute>
                {/* existing route structure goes here, unchanged */}
                <Routes>
                  <Route path="/" element={<Section1 />} />
                  <Route path="/section2" element={<Section2 />} />
                  // ... all 7 existing routes
                </Routes>
              </ProtectedRoute>
            }
          />
        </Routes>
      </Router>
    </AuthProvider>
  )
}
```

> **Critical:** The 7 existing section components must not be modified. All auth logic is contained in the wrapper layer only.

> **If app uses hash routing or no router at all:** Koda to adapt the `LoginPage` render condition and `ProtectedRoute` redirect mechanism. Core auth logic (AuthContext, supabaseClient) is router-agnostic.

---

## 5. Supabase Database Schema

### Table: `admin_users`

```
Table: admin_users
Schema: public
Purpose: Stores authorised admin accounts. Single row for Dominic.

Columns:
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid()
  email           TEXT         NOT NULL UNIQUE
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()

RLS: ENABLED
```

> **Note:** No `password_hash` column. Supabase Auth manages password hashing internally in the `auth.users` table (Supabase-managed schema). The `admin_users` table stores the application-level record and is used for RLS policy checks — it does NOT store credentials.

> The initial user (Dominic) must be created via **Supabase Dashboard → Authentication → Users → Invite User** (or Add User). The email added there must match the row inserted into `admin_users`.

---

## 6. RLS Policies

### Policy 1 — `admin_users` SELECT

```sql
-- Name: admin_users_select_own
-- Table: public.admin_users
-- Operation: SELECT
-- Role: authenticated

CREATE POLICY "admin_users_select_own"
ON public.admin_users
FOR SELECT
TO authenticated
USING (
  auth.uid() = (
    SELECT au.id
    FROM auth.users au
    WHERE au.email = admin_users.email
    LIMIT 1
  )
);
```

**Intent:** An authenticated user can only read their own row. Prevents any future second user from reading Dominic's record.

### Policy 2 — `admin_users` INSERT (migration/setup only)

```sql
-- Name: admin_users_insert_service_role
-- Table: public.admin_users
-- Operation: INSERT
-- Role: service_role (bypasses RLS — used only during initial setup migration)
-- No explicit policy needed; service_role bypasses RLS by default.
```

**Intent:** Initial row insertion for Dominic is done via migration script or Supabase Dashboard using the service role key — not from the frontend.

### Policy 3 — No public access

```sql
-- Ensure anon role cannot read admin_users
-- (Default deny — no SELECT policy for anon role means no access)
-- Verify by checking: REVOKE ALL ON public.admin_users FROM anon;
```

---

## 7. Database Migration

**File:** `supabase/migrations/<timestamp>_create_admin_users.sql`

```sql
-- Create admin_users table
CREATE TABLE IF NOT EXISTS public.admin_users (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT        NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

-- RLS: authenticated users can only read their own record
CREATE POLICY "admin_users_select_own"
ON public.admin_users
FOR SELECT
TO authenticated
USING (
  auth.uid() = (
    SELECT au.id FROM auth.users au
    WHERE au.email = admin_users.email
    LIMIT 1
  )
);

-- Insert Dominic's record
-- NOTE: Replace with actual email before running
INSERT INTO public.admin_users (email)
VALUES ('dominic@dc81.co.uk')  -- REPLACE WITH ACTUAL EMAIL
ON CONFLICT (email) DO NOTHING;
```

> **⚠️ Koda must confirm Dominic's actual email with Cestra before running this migration.**

---

## 8. Environment Variables

**File:** `.env.local` (gitignored, never committed)

```bash
# Supabase project credentials
# Obtain from: Supabase Dashboard → Project Settings → API

VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-public-key>
```

> **If using Create React App (not Vite):** replace `VITE_` prefix with `REACT_APP_`:
> ```bash
> REACT_APP_SUPABASE_URL=https://<your-project-ref>.supabase.co
> REACT_APP_SUPABASE_ANON_KEY=<your-anon-public-key>
> ```

**⚠️ NEVER use the `service_role` key in frontend code.** The `anon` key is safe for client-side use when RLS is properly configured.

**Vercel deployment:** Add both variables to Vercel project environment variables (Settings → Environment Variables). Values identical to `.env.local`.

---

## 9. NPM Dependencies

Add to `package.json`:

```bash
npm install @supabase/supabase-js @supabase/auth-helpers-react
```

> **Note:** `@supabase/auth-helpers-react` wraps `@supabase/supabase-js`. Both are required. If `@supabase/supabase-js` is already installed, the install command will update it to a compatible version.

---

## 10. Security Constraints

1. **No public registration route.** `/login` renders the login form only. No sign-up link, no sign-up API call.
2. **No password reset UI.** If Dominic needs a password reset, it is done via Supabase Dashboard only.
3. **Anon key only in frontend.** Service role key stays server-side/migration only.
4. **RLS enforced on all tables.** The `admin_users` table has RLS enabled from creation.
5. **Session expiry.** Supabase default JWT expiry is 1 hour, auto-refreshed by SDK. No config change needed.
6. **No user enumeration.** Supabase `signInWithPassword` returns a generic error on failure — do not parse or display raw Supabase error codes to the user. Display: `"Invalid email or password."` always.

---

## 11. What Koda Must Do Before Starting

1. **Confirm bundler** (Vite vs CRA) → determines env var prefix
2. **Confirm routing approach** in existing `App.tsx` (react-router-dom version, hash vs browser history, or no router)
3. **Confirm Dominic's Supabase email** with Cestra → needed for migration
4. **Confirm existing nav/header component name** → needed to place `<LogoutButton />`
5. **Confirm Supabase project is provisioned** and credentials are available

---

## 12. Out of Scope for Phase 1

- Multi-user support
- Role-based access control
- Password reset flow
- Social/OAuth login
- Two-factor authentication
- Audit logging of login events

These may be addressed in later phases if required.

---

---GRAPH_UPDATE_START---
ENTITIES:
- TYPE: Component | NAME: LoginPage | file_path: src/components/auth/LoginPage.tsx | component_type: page | description: Email/password login form for Mission Control. Single-user admin only. No registration.
- TYPE: Component | NAME: AuthContext | file_path: src/context/AuthContext.tsx | component_type: context | description: Supabase Auth context provider. Exposes session, user, loading, signOut via useAuth hook. Handles session rehydration and onAuthStateChange listener.
- TYPE: Component | NAME: ProtectedRoute | file_path: src/components/auth/ProtectedRoute.tsx | component_type: wrapper | description: Route guard. Redirects unauthenticated users to /login. Renders children when session is present.
- TYPE: Component | NAME: LogoutButton | file_path: src/components/auth/LogoutButton.tsx | component_type: ui | description: Button component that calls useAuth().signOut(). To be placed in existing nav/header.
- TYPE: Component | NAME: supabaseClient | file_path: src/lib/supabaseClient.ts | component_type: utility | description: Supabase client singleton. Initialised with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY env vars.
- TYPE: DBTable | NAME: admin_users | schema_name: public | description: Application-level admin user registry. Single row for Dominic. RLS enabled. Does not store passwords (Supabase Auth handles that).
- TYPE: RLSPolicy | NAME: admin_users_select_own | description: Authenticated users can only SELECT their own row from admin_users, matched by email against auth.users.
- TYPE: DBFunction | NAME: create_admin_users_migration | description: SQL migration creating admin_users table, enabling RLS, creating policies, and inserting Dominic's email row.
- TYPE: Decision | NAME: No password_hash column in admin_users | rationale: Supabase Auth manages credentials in auth.users (managed schema). admin_users is for application-level RLS anchoring only. | alternatives_considered: Storing bcrypt hash in admin_users (rejected — duplicates Supabase Auth responsibility and creates credential sync risk) | status: active
- TYPE: Decision | NAME: ProtectedRoute wraps all routes except /login | rationale: Single enforcement point. No per-route auth decoration needed. Simpler to maintain. | alternatives_considered: Per-route auth checks (rejected — fragile, easy to miss a route) | status: active
- TYPE: Decision | NAME: No public registration | rationale: Mission Control is a single-user internal tool. Public registration is a security risk. | alternatives_considered: Invite-only registration (rejected — unnecessary complexity for one user) | status: active

RELATIONSHIPS:
- SOURCE_TYPE: Component | SOURCE: AuthContext | REL: USES_FUNCTION | TARGET_TYPE: Component | TARGET: supabaseClient
- SOURCE_TYPE: Component | SOURCE: LoginPage | REL: USES_FUNCTION | TARGET_TYPE: Component | TARGET: supabaseClient
- SOURCE_TYPE: Component | SOURCE: ProtectedRoute | REL: IMPORTS | TARGET_TYPE: Component | TARGET: AuthContext
- SOURCE_TYPE: Component | SOURCE: LogoutButton | REL: IMPORTS | TARGET_TYPE: Component | TARGET: AuthContext
- SOURCE_TYPE: Component | SOURCE: LoginPage | REL: IMPORTS | TARGET_TYPE: Component | TARGET: AuthContext
- SOURCE_TYPE: RLSPolicy | SOURCE: admin_users_select_own | REL: ENFORCES | TARGET_TYPE: DBTable | TARGET: admin_users

DECISIONS:
- TITLE: No password_hash column in admin_users | RATIONALE: Supabase Auth manages credentials in auth.users. admin_users is for RLS anchoring only. | ALTERNATIVES: Storing bcrypt hash directly (rejected — duplicates Supabase Auth, creates sync risk)
- TITLE: Single ProtectedRoute wrapping all routes | RATIONALE: One enforcement point, impossible to accidentally leave a route unprotected. | ALTERNATIVES: Per-route auth decoration (rejected — fragile at scale)
- TITLE: No public registration or password reset UI | RATIONALE: Single-user internal tool. Supabase Dashboard handles account management. | ALTERNATIVES: Admin-only registration flow (rejected — unnecessary complexity)
---GRAPH_UPDATE_END---
