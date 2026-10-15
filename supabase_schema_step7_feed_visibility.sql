-- ==============================================================================
-- CampusFind: Step 7 Minimal Migration — Fix Home Feed Visibility Bug
-- Run this entire script in your Supabase Dashboard -> SQL Editor
--
-- Objective:
-- Fix the issue where non-admin students only see their own reports in the
-- Home Feed, caused by a conflict between `security_invoker = true` on `items_feed`
-- and author-restricted RLS (`auth.uid() = user_id OR is_admin()`) on `public.items`.
--
-- Security & Operational Guarantees:
-- 1. Owner-Privilege Mode (`security_invoker = false`):
--    The view executes with the privileges of its owner (`postgres`), allowing it
--    to query all active items across campus from `public.items` regardless of caller RLS.
-- 2. Side-Channel Protection (`security_barrier = true`):
--    Prevents PostgreSQL query optimizer from pushing user-defined predicates
--    ahead of the view's WHERE and CASE conditions, eliminating data-leak side channels.
-- 3. Dynamic Privacy Masking:
--    The CASE expressions evaluate `auth.uid()` against the caller's JWT:
--    - Item owner or Central Admin: sees real `contact_name` and `contact_phone`.
--    - Other students:
--      * Found reports: masks `contact_name` to 'Central Security Office' and `contact_phone` to NULL.
--      * Lost reports: preserves `contact_name` (e.g. reporter name), but masks `contact_phone` to NULL
--        to prevent campus-wide harvesting/scraping of personal phone numbers and emails.
-- 4. Status Isolation Preserved:
--    `WHERE status IN ('open', 'in_custody', 'claimed')` strictly hides all resolved
--    and archived items from the student feed.
-- 5. Non-Destructive:
--    Preserves exact column names, order, types, triggers, claims, custody, and
--    base table RLS policies on `public.items`.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. RECREATE items_feed VIEW WITH OWNER PRIVILEGES & SECURITY BARRIER
-- ------------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.items_feed
WITH (security_barrier = true, security_invoker = false)
AS
  SELECT
    id,
    user_id,
    title,
    description,
    type,
    category,
    location,
    date_string,
    image_url,
    image_path,
    status,
    returned_at,
    created_at,
    updated_at,
    CASE
      WHEN auth.uid() = user_id OR public.is_admin() THEN contact_name
      WHEN type = 'found' THEN 'Central Security Office'
      ELSE contact_name
    END AS contact_name,
    CASE
      WHEN auth.uid() = user_id OR public.is_admin() THEN contact_phone
      ELSE NULL
    END AS contact_phone
  FROM public.items
  WHERE status IN ('open', 'in_custody', 'claimed');

-- Ensure view options are explicitly applied in reloptions
ALTER VIEW public.items_feed SET (security_barrier = true, security_invoker = false);

-- ------------------------------------------------------------------------------
-- 2. PERMISSIONS
-- ------------------------------------------------------------------------------
-- Ensure both authenticated college students and guest browsers can read the feed
GRANT SELECT ON public.items_feed TO authenticated, anon;

COMMIT;
