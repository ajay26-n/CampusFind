-- ==============================================================================
-- CampusFind: Step 6 Production Migration — Real Item Return Workflow
-- Run this entire script in your Supabase Dashboard -> SQL Editor
--
-- Security & Operational Guarantees:
-- 1. Transactional: Runs in a single transaction (BEGIN ... COMMIT); rolls back on error.
-- 2. Preserves public.is_admin(): Preserved verbatim (profiles role + admin email check).
-- 3. Preserves items_status_check: Preserves all 5 statuses (open, in_custody, claimed, resolved, archived).
-- 4. Preserves Live Triggers: trg_items_enforce_insert, trg_items_enforce_status (with its
--    enforce_item_status_transition function), trg_items_updated_at, and trg_items_protect remain active.
-- 5. Preserves Existing RLS: Authors retain exact self-update policy; SELECT/INSERT/DELETE untouched.
-- 6. Adds Minimal Admin Workflow Policy: Central Admin can only update status to in_custody, open, or resolved.
-- 7. Hardens protect_item_modification(): Adds archive lock (no reopening resolved items),
--    non-destructive returned_at timestamping, and least-privilege content/contact field freeze.
-- 8. Preserves items_feed View: Exact confirmed column order, returned_at, owner/admin real contact
--    visibility, privacy masking for other users, and active status filter ('open', 'in_custody', 'claimed').
-- 9. Non-Destructive: All existing item listings, claims, images, and audit records remain intact.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. ALIAS HELPER FUNCTION (ENSURES COMPATIBILITY)
-- ------------------------------------------------------------------------------
-- Calls existing live public.is_admin() without modifying its implementation.
CREATE OR REPLACE FUNCTION public.is_central_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.is_admin();
$$;

REVOKE EXECUTE ON FUNCTION public.is_central_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_central_admin() TO authenticated;


-- ------------------------------------------------------------------------------
-- 2. CENTRAL ADMIN WORKFLOW RLS UPDATE POLICY
-- ------------------------------------------------------------------------------
-- Permits verified Central Admin to update workflow status on items reported by students.
-- Creator self-update policy ("Users can update their own reports") is preserved.
DROP POLICY IF EXISTS "Central admin can manage item workflow status" ON public.items;
CREATE POLICY "Central admin can manage item workflow status"
  ON public.items
  FOR UPDATE
  TO authenticated
  USING (
    public.is_admin() = true
  )
  WITH CHECK (
    public.is_admin() = true
    AND status IN ('in_custody', 'open', 'resolved')
  );


-- ------------------------------------------------------------------------------
-- 3. ENHANCE protect_item_modification() (IN PLACE)
-- ------------------------------------------------------------------------------
-- Preserves existing user_id ownership protection and updated_at touching.
-- Adds: (a) archive lock, (b) non-destructive returned_at stamp, (c) admin field freeze.
CREATE OR REPLACE FUNCTION public.protect_item_modification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Preserved Rule 1: Item reporter ownership cannot be transferred
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Unauthorized: Item reporter ownership cannot be transferred.';
  END IF;

  -- Preserved Rule 2: Primary key and creation timestamp are immutable
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Unauthorized: Item ID cannot be modified.';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Unauthorized: Item creation timestamp cannot be modified.';
  END IF;

  -- Rule 3: Prevent resolved items from being reopened
  IF OLD.status = 'resolved' AND NEW.status IS DISTINCT FROM 'resolved' THEN
    RAISE EXCEPTION 'Unauthorized: Resolved items are permanently archived and cannot be reopened.';
  END IF;

  -- Rule 4: Automatically stamp returned_at when transitioning to 'resolved'
  -- Preserves an existing return timestamp if one was already set
  IF NEW.status = 'resolved' AND (OLD.status IS DISTINCT FROM 'resolved') THEN
    NEW.returned_at = COALESCE(NEW.returned_at, OLD.returned_at, timezone('utc'::text, now()));
  END IF;

  -- Rule 5: Least privilege for Central Admin on other students' items:
  -- When Admin updates another student's report, content and contact fields cannot be modified.
  -- Admin is strictly restricted to workflow status, returned_at, and updated_at.
  IF auth.uid() IS DISTINCT FROM OLD.user_id AND public.is_admin() THEN
    IF NEW.title IS DISTINCT FROM OLD.title
       OR NEW.description IS DISTINCT FROM OLD.description
       OR NEW.type IS DISTINCT FROM OLD.type
       OR NEW.category IS DISTINCT FROM OLD.category
       OR NEW.location IS DISTINCT FROM OLD.location
       OR NEW.date_string IS DISTINCT FROM OLD.date_string
       OR NEW.image_url IS DISTINCT FROM OLD.image_url
       OR NEW.image_path IS DISTINCT FROM OLD.image_path
       OR NEW.contact_name IS DISTINCT FROM OLD.contact_name
       OR NEW.contact_phone IS DISTINCT FROM OLD.contact_phone
    THEN
      RAISE EXCEPTION 'Unauthorized: Central Admin is only permitted to update workflow status. Item content and contact fields cannot be modified.';
    END IF;
  END IF;

  -- Preserved Rule 6: Auto-touch updated_at
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$;


-- ------------------------------------------------------------------------------
-- 4. PRIVACY-PRESERVING items_feed VIEW (EXACT LIVE DEFINITION)
-- ------------------------------------------------------------------------------
-- Preserves confirmed live column order, returned_at, owner/admin contact visibility,
-- contact privacy masking, and active status filter ('open', 'in_custody', 'claimed').
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

GRANT SELECT ON public.items_feed TO authenticated, anon;

COMMIT;
