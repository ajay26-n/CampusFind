-- ==============================================================================
-- CampusFind: Step 11 Migration — Lost Item Found Reporting & Notifications
-- Run this script in your Supabase Dashboard -> SQL Editor
--
-- Objective:
-- When a student finds an item that was reported lost:
-- 1. Finder submits an "I Found This Item" report with their contact & handover note.
-- 2. System automatically notifies:
--    a) The student who lost/reported the item ('item_found').
--    b) The Central Admin ('item_found') to expect physical handover.
-- 3. Finder is directed to hand over the physical item to Central Security Office.
-- 4. Central Admin can confirm custody and subsequently resolve the lost report.
-- ==============================================================================

BEGIN;

-- 1. Expand public.notifications type constraint to include 'item_found'
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (
    type IN (
      'claim_submitted',
      'claim_approved',
      'claim_rejected',
      'item_resolved',
      'item_found'
    )
  );

-- 2. RPC function to handle "I Found This Item" reports securely
CREATE OR REPLACE FUNCTION public.report_lost_item_found(
  p_item_id UUID,
  p_finder_name TEXT,
  p_finder_phone TEXT,
  p_note TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_item RECORD;
  v_admin_id UUID;
  v_event_id UUID;
  v_finder_display TEXT;
  v_finder_phone_display TEXT;
  v_handover_note TEXT;
BEGIN
  -- 1. Ensure user is authenticated
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;

  -- 2. Fetch the lost item
  SELECT id, user_id, title, type, status INTO v_item
  FROM public.items
  WHERE id = p_item_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Item report not found.');
  END IF;

  -- 3. Validate that the item is a lost report and still open
  IF v_item.type <> 'lost' THEN
    RETURN jsonb_build_object('success', false, 'error', 'This action is only available for lost item reports.');
  END IF;

  IF v_item.status = 'resolved' THEN
    RETURN jsonb_build_object('success', false, 'error', 'This lost item has already been marked as returned / resolved.');
  END IF;

  -- 4. Prevent author from reporting finding their own lost item
  IF v_item.user_id = auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'You cannot report finding your own lost item.');
  END IF;

  -- 5. Guard against duplicate reporting: Check if already in custody or claimed
  IF v_item.status IN ('in_custody', 'claimed') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'This item has already been reported found and is currently awaiting physical handover at Central Security Office.'
    );
  END IF;

  -- 6. Officially mark item status as 'in_custody' (handover pending from finder)
  UPDATE public.items
  SET status = 'in_custody',
      updated_at = timezone('utc'::text, now())
  WHERE id = v_item.id;

  v_event_id := gen_random_uuid();
  v_finder_display := COALESCE(NULLIF(trim(p_finder_name), ''), 'A student');
  v_finder_phone_display := COALESCE(NULLIF(trim(p_finder_phone), ''), 'Contact via Security Office');
  v_handover_note := COALESCE(NULLIF(trim(p_note), ''), 'Dropped off at Central Security Desk');

  -- 5. Dispatch notification to the student who lost the item
  PERFORM public.safe_dispatch_notification(
    v_item.user_id,
    v_item.id,
    'item_found',
    'Lost Item Found! 🎉',
    'Good news! ' || v_finder_display || ' (' || v_finder_phone_display || ') reported finding your lost item "' || 
      v_item.title || '". They were directed to hand it over to the Central Security Office. Once physical custody is confirmed, please bring your College ID to collect it.',
    'lost_found:' || v_item.id || ':owner:' || v_event_id
  );

  -- 6. Discover Central Admin UUID
  SELECT id INTO v_admin_id
  FROM auth.users
  WHERE lower(trim(email)) = 'ajay.cs23@builderscollege.edu.in'
  LIMIT 1;

  IF v_admin_id IS NULL THEN
    SELECT id INTO v_admin_id
    FROM public.profiles
    WHERE lower(trim(email)) = 'ajay.cs23@builderscollege.edu.in'
    LIMIT 1;
  END IF;

  -- 7. Dispatch notification to Central Admin
  IF v_admin_id IS NOT NULL THEN
    PERFORM public.safe_dispatch_notification(
      v_admin_id,
      v_item.id,
      'item_found',
      'Lost Item Handover Expected 🛡️',
      'Finder ' || v_finder_display || ' (' || v_finder_phone_display || ') reported finding lost item "' || 
        v_item.title || '". Handover note: "' || v_handover_note || '". Please verify custody upon receiving at Central Security Office.',
      'lost_found:' || v_item.id || ':admin:' || v_event_id
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'item_id', v_item.id,
    'message', 'Found report submitted. Owner and Central Admin have been notified.'
  );
END;
$$;

-- 3. Ensure no ambiguous overloaded versions exist
DROP FUNCTION IF EXISTS public.report_lost_item_found(TEXT, TEXT, TEXT, TEXT);

REVOKE EXECUTE ON FUNCTION public.report_lost_item_found(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.report_lost_item_found(UUID, TEXT, TEXT, TEXT) TO authenticated;

COMMIT;

-- Force PostgREST to immediately refresh its schema cache
NOTIFY pgrst, 'reload schema';

