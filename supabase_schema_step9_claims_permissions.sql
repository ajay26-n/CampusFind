-- ==============================================================================
-- CampusFind: Step 9 Security Hardening — Least-Privilege Permissions on public.claims
-- Run this script in your Supabase Dashboard -> SQL Editor
--
-- Objective:
-- Implement least-privilege table permissions on `public.claims` to eliminate
-- dangerous destructive capabilities (DELETE, TRUNCATE) from client roles while
-- preserving 100% of working application workflows (claim submission, admin
-- review/approval/rejection, and notification dispatch).
--
-- Operational & Security Guarantees:
-- 1. Idempotent & Transactional:
--    Wrapped in BEGIN ... COMMIT. Can be safely rerun without errors.
-- 2. Non-Destructive:
--    Does not drop tables, alter columns, or modify existing claim records.
-- 3. Strips Destructive Privileges:
--    REVOKES DELETE and TRUNCATE on public.claims from `anon`, `authenticated`,
--    and `PUBLIC`. The application never deletes claims; permanent retention
--    is maintained for campus custody audit trails.
-- 4. Strips Unauthenticated Mutation:
--    REVOKES INSERT, UPDATE, DELETE, TRUNCATE from `anon`. Guests cannot submit
--    or modify claims.
-- 5. Preserves Required Client Operations:
--    GRANTS SELECT, INSERT, UPDATE on public.claims to `authenticated`.
--    - Verified students can submit claims (INSERT).
--    - Students and Central Admin can view relevant claims (SELECT).
--    - Central Admin can approve/reject claims (UPDATE).
-- 6. Preserves RLS & Live Triggers:
--    Ensures ROW LEVEL SECURITY is enabled on public.claims.
--    All live triggers (on_claim_submitted_notification, on_claim_status_notification)
--    remain active and untouched.
-- ==============================================================================

BEGIN;

-- 1. Ensure Row Level Security is enabled on public.claims
ALTER TABLE IF EXISTS public.claims ENABLE ROW LEVEL SECURITY;

-- 2. Revoke all privileges from PUBLIC (default catch-all role)
REVOKE ALL ON TABLE public.claims FROM PUBLIC;

-- 3. Restrict unauthenticated client role (anon)
-- Revoke all mutation and administrative privileges from guests.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.claims FROM anon;

-- Optional: Allow anon to SELECT only if guest browsing requires it; otherwise revoke.
-- To preserve existing read behavior safely under active RLS:
GRANT SELECT ON TABLE public.claims TO anon;

-- 4. Restrict authenticated student & admin client role (authenticated)
-- Explicitly revoke destructive privileges that the application never uses.
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.claims FROM authenticated;

-- Grant strictly the minimal operational privileges required by the application:
-- - INSERT: Needed for createClaimRequest()
-- - SELECT: Needed for fetchClaimsForItem() and userClaim checks
-- - UPDATE: Needed for updateClaimStatus() (Central Admin workflow)
GRANT SELECT, INSERT, UPDATE ON TABLE public.claims TO authenticated;

COMMIT;
