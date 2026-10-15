-- ==============================================================================
-- CampusFind: Step 10 — Central Admin Notifications for Newly Submitted Claims
-- Run this script in your Supabase Dashboard -> SQL Editor (For Review Only)
--
-- Objective:
-- In-place update to public.trg_notify_claim_submitted() to create a private
-- "New Claim Pending Review" notification for Central Admin upon claim submission,
-- while preserving the existing claimant notification and trigger bindings.
-- ==============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.trg_notify_claim_submitted()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_item_title TEXT;
  v_admin_id UUID;
  v_claimant_display TEXT;
BEGIN
  -- 1. Fetch reported item title
  SELECT title INTO v_item_title FROM public.items WHERE id = NEW.item_id;

  -- 2. Claimant Confirmation Notification (Preserved exactly from Step 8)
  PERFORM public.safe_dispatch_notification(
    NEW.claimant_id,
    NEW.item_id,
    'claim_submitted',
    'Claim Submitted',
    'Your claim for "' || COALESCE(v_item_title, 'item') || '" has been submitted and is pending review by Central Security Desk.',
    'claim:' || NEW.id || ':submitted'
  );

  -- 3. Discover Central Admin user UUID on the server side
  -- Query auth.users under the SECURITY DEFINER postgres context
  SELECT id INTO v_admin_id
  FROM auth.users
  WHERE lower(trim(email)) = 'ajay.cs23@builderscollege.edu.in'
  LIMIT 1;

  -- Fallback to public.profiles if auth.users lookup returns null
  IF v_admin_id IS NULL THEN
    SELECT id INTO v_admin_id
    FROM public.profiles
    WHERE lower(trim(email)) = 'ajay.cs23@builderscollege.edu.in'
    LIMIT 1;
  END IF;

  -- 4. Central Admin Notification (Dispatched privately to Central Admin)
  IF v_admin_id IS NOT NULL THEN
    v_claimant_display := COALESCE(NULLIF(trim(NEW.claimant_name), ''), 'A student');

    PERFORM public.safe_dispatch_notification(
      v_admin_id,
      NEW.item_id,
      'claim_submitted',
      'New Claim Pending Review',
      v_claimant_display || ' submitted a claim for "' || COALESCE(v_item_title, 'item') || '".' || chr(10) ||
      'Claim ID: ' || NEW.id || chr(10) ||
      'Item ID: ' || NEW.item_id || chr(10) ||
      'Please review proof of ownership and verify student ID at Central Security Office.',
      'claim:' || NEW.id || ':admin:submitted'
    );
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
