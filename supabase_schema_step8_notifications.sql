-- ==============================================================================
-- CampusFind: Step 8 Migration — Secure In-App Notification Center
-- Run this entire script in your Supabase Dashboard -> SQL Editor
--
-- Objective:
-- Implements a secure, production-oriented in-app notification center for
-- Module 10 Phase 2. Enables students to receive reliable alerts for:
-- 1. Claim Submitted (confirmation on claim creation)
-- 2. Claim Approved / Rejected (decision updates from Central Admin)
-- 3. Item Resolved (case closure for approved claimant & original reporter)
--
-- Security & Operational Guarantees:
-- 1. Anti-Tamper & Anti-Forgery:
--    Direct INSERT, UPDATE, and DELETE on public.notifications are REVOKED from
--    client roles. Notifications are generated strictly by database triggers.
-- 2. Least-Privilege Read & Marking:
--    Students can only SELECT their own notifications (auth.uid() = user_id).
--    Marking as read is restricted to `public.mark_notification_as_read(UUID)`.
-- 3. Idempotent & Repeated-Transition Delivery:
--    Each status transition generates an atomic event UUID incorporated into the
--    idempotency key ('claim:<id>:<status>:<event_id>'). Repeated transitions
--    (rejected -> approved -> rejected -> approved) deliver distinct notifications,
--    while outbox retries reuse the exact persistent key and prevent duplicates.
-- 4. Ambiguity-Safe Resolution Targeting:
--    The resolution trigger counts approved claims. Exactly 1 approved claimant
--    receives the private handover notice. If multiple claims are marked approved,
--    the trigger withholds false handover notices, logs an administrative audit
--    record in the outbox, and avoids arbitrary LIMIT 1 selection.
-- 5. Transactional Outbox Resilience:
--    If an unexpected error occurs during notification generation, the payload is
--    captured in `public.notification_outbox` so the main workflow never fails,
--    and the event can be retried without duplicate alerts.
-- 5. Privacy-Preserving Resolved-Item Access:
--    `public.get_resolved_item_for_user(UUID)` allows original reporters, Central
--    Admin, and ONLY approved claimants to view resolved items with contact masking.
--    Base table RLS on public.items and public.claims remains completely intact.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. NOTIFICATIONS TABLE
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (
    type IN (
      'claim_submitted',
      'claim_approved',
      'claim_rejected',
      'item_resolved'
    )
  ),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT uq_notifications_idempotency_key UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created 
  ON public.notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread 
  ON public.notifications (user_id, is_read) 
  WHERE is_read = false;

CREATE INDEX IF NOT EXISTS idx_notifications_item_id 
  ON public.notifications (item_id);

-- ------------------------------------------------------------------------------
-- 2. TRANSACTIONAL NOTIFICATION OUTBOX
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL,
  item_id UUID NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_outbox_pending 
  ON public.notification_outbox (status) 
  WHERE status = 'pending';

-- ------------------------------------------------------------------------------
-- 3. RLS POLICIES & PERMISSIONS
-- ------------------------------------------------------------------------------
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;

-- 3.1 SELECT: Students can strictly query only their own notifications
DROP POLICY IF EXISTS "Users can view their own notifications" ON public.notifications;
CREATE POLICY "Users can view their own notifications"
  ON public.notifications
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- 3.2 Revoke direct client mutation: prevents spoofing, forgery, or tampering
REVOKE INSERT, UPDATE, DELETE ON public.notifications FROM authenticated, anon;
REVOKE ALL ON public.notification_outbox FROM authenticated, anon;
GRANT SELECT ON public.notifications TO authenticated;

-- 3.3 Function: Least-privilege read marker
CREATE OR REPLACE FUNCTION public.mark_notification_as_read(p_notification_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.notifications
  SET is_read = true
  WHERE id = p_notification_id
    AND user_id = auth.uid();
  RETURN FOUND;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_notification_as_read(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_notification_as_read(UUID) TO authenticated;

-- ------------------------------------------------------------------------------
-- 4. RESOLVED-ITEM ACCESS HELPER (PRIVACY-PRESERVED & LEAST-PRIVILEGE)
-- ------------------------------------------------------------------------------
-- Allows approved claimants, original reporters, and Central Admin to open resolved items.
-- Enforces contact masking identical to items_feed (phone is NULL, found contact is Central Security).
CREATE OR REPLACE FUNCTION public.get_resolved_item_for_user(p_item_id UUID)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  title TEXT,
  description TEXT,
  type TEXT,
  category TEXT,
  location TEXT,
  date_string TEXT,
  image_url TEXT,
  image_path TEXT,
  status TEXT,
  returned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  contact_name TEXT,
  contact_phone TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    i.id,
    i.user_id,
    i.title,
    i.description,
    i.type,
    i.category,
    i.location,
    i.date_string,
    i.image_url,
    i.image_path,
    i.status,
    i.returned_at,
    i.created_at,
    i.updated_at,
    -- Dynamic contact masking:
    CASE
      WHEN auth.uid() = i.user_id OR public.is_admin() THEN i.contact_name
      WHEN i.type = 'found' THEN 'Central Security Office'
      ELSE i.contact_name
    END AS contact_name,
    CASE
      WHEN auth.uid() = i.user_id OR public.is_admin() THEN i.contact_phone
      ELSE NULL
    END AS contact_phone
  FROM public.items i
  WHERE i.id = p_item_id
    AND (
      -- 1. Original reporter
      auth.uid() = i.user_id
      -- 2. Central Admin
      OR public.is_admin()
      -- 3. ONLY the single, unambiguous approved claimant
      -- If multiple claims are marked approved, access is withheld pending administrative resolution
      OR (
        EXISTS (
          SELECT 1 FROM public.claims c
          WHERE c.item_id = p_item_id
            AND c.claimant_id = auth.uid()
            AND c.status = 'approved'
        )
        AND (
          SELECT count(DISTINCT claimant_id) FROM public.claims
          WHERE item_id = p_item_id AND status = 'approved'
        ) = 1
      )
    );
$$;

REVOKE EXECUTE ON FUNCTION public.get_resolved_item_for_user(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_resolved_item_for_user(UUID) TO authenticated;

-- ------------------------------------------------------------------------------
-- 5. RELIABLE NOTIFICATION DISPATCH (INTERNAL SECURE HELPER)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.safe_dispatch_notification(
  p_user_id UUID,
  p_item_id UUID,
  p_type TEXT,
  p_title TEXT,
  p_message TEXT,
  p_idempotency_key TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Primary attempt: atomic direct write to notifications
  INSERT INTO public.notifications (
    user_id, item_id, type, title, message, idempotency_key
  )
  VALUES (
    p_user_id, p_item_id, p_type, p_title, p_message, p_idempotency_key
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

EXCEPTION WHEN OTHERS THEN
  -- Outbox fallback: records failure without aborting parent transaction
  INSERT INTO public.notification_outbox (
    idempotency_key, user_id, item_id, type, title, message, status, attempts, last_error
  )
  VALUES (
    p_idempotency_key, p_user_id, p_item_id, p_type, p_title, p_message, 'pending', 1, SQLERRM
  )
  ON CONFLICT (idempotency_key) DO UPDATE
    SET attempts = public.notification_outbox.attempts + 1,
        last_error = EXCLUDED.last_error,
        updated_at = timezone('utc'::text, now());
END;
$$;

REVOKE EXECUTE ON FUNCTION public.safe_dispatch_notification(UUID, UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, authenticated, anon;

-- ------------------------------------------------------------------------------
-- 6. WORKFLOW TRIGGERS
-- ------------------------------------------------------------------------------

-- 6.1 Claim Submitted Trigger (Confirms submission to claimant)
CREATE OR REPLACE FUNCTION public.trg_notify_claim_submitted()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item_title TEXT;
BEGIN
  SELECT title INTO v_item_title FROM public.items WHERE id = NEW.item_id;

  PERFORM public.safe_dispatch_notification(
    NEW.claimant_id,
    NEW.item_id,
    'claim_submitted',
    'Claim Submitted',
    'Your claim for "' || COALESCE(v_item_title, 'item') || '" has been submitted and is pending review by Central Security Desk.',
    'claim:' || NEW.id || ':submitted'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_claim_submitted_notification ON public.claims;
CREATE TRIGGER on_claim_submitted_notification
  AFTER INSERT ON public.claims
  FOR EACH ROW EXECUTE FUNCTION public.trg_notify_claim_submitted();

-- 6.2 Claim Decision Trigger (Approved / Rejected)
-- Assigns a persistent event UUID to each distinct transition transaction, supporting
-- repeated state transitions (e.g. rejected -> approved -> rejected -> approved)
-- without key collisions or suppressing later notifications.
CREATE OR REPLACE FUNCTION public.trg_notify_claim_decision()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item_title TEXT;
  v_event_id UUID;
  v_key TEXT;
BEGIN
  -- Strict guard: ONLY fire when status transitions to 'approved' or 'rejected'
  IF NEW.status IN ('approved', 'rejected') AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    SELECT title INTO v_item_title FROM public.items WHERE id = NEW.item_id;
    
    -- Persistent transition event identifier
    v_event_id := gen_random_uuid();
    v_key := 'claim:' || NEW.id || ':' || NEW.status || ':' || v_event_id;

    PERFORM public.safe_dispatch_notification(
      NEW.claimant_id,
      NEW.item_id,
      CASE WHEN NEW.status = 'approved' THEN 'claim_approved' ELSE 'claim_rejected' END,
      CASE WHEN NEW.status = 'approved' THEN 'Claim Approved' ELSE 'Claim Rejected' END,
      CASE 
        WHEN NEW.status = 'approved' THEN 
          'Your claim for "' || COALESCE(v_item_title, 'item') || '" has been approved. Please bring your college ID to Central Security Desk to complete physical collection.'
        ELSE 
          'Your claim for "' || COALESCE(v_item_title, 'item') || '" was not approved. Please contact Central Security Desk if you need clarification.'
      END,
      v_key
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_claim_status_notification ON public.claims;
CREATE TRIGGER on_claim_status_notification
  AFTER UPDATE OF status ON public.claims
  FOR EACH ROW EXECUTE FUNCTION public.trg_notify_claim_decision();

-- 6.3 Item Resolution Trigger (Notifies Verified Approved Claimant & Reporter Privately)
-- Strictly verifies that exactly ONE approved claimant exists before sending the private handover notice.
-- If multiple claims are marked approved, detects ambiguity, withholds false handover notices,
-- logs an operational audit record in notification_outbox, and notifies the reporter safely.
CREATE OR REPLACE FUNCTION public.trg_notify_item_resolution()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_approved_claimants UUID[];
  v_approved_count INT;
  v_claimant_id UUID;
  v_event_id UUID;
BEGIN
  -- Strict guard: ONLY fire when status transitions to 'resolved'
  IF NEW.status = 'resolved' AND (OLD.status IS DISTINCT FROM 'resolved') THEN
    v_event_id := gen_random_uuid();

    -- Gather all distinct approved claimants for this item
    SELECT COALESCE(array_agg(DISTINCT claimant_id), ARRAY[]::UUID[])
    INTO v_approved_claimants
    FROM public.claims
    WHERE item_id = NEW.id AND status = 'approved';

    v_approved_count := cardinality(v_approved_claimants);

    -- 1. Claimant resolution notification
    IF v_approved_count = 1 THEN
      -- Exactly one verified claimant: send handover confirmation
      v_claimant_id := v_approved_claimants[1];
      PERFORM public.safe_dispatch_notification(
        v_claimant_id,
        NEW.id,
        'item_resolved',
        'Item Handover Completed',
        'Your claimed item "' || NEW.title || '" has been verified and handed over. Case closed.',
        'resolve:' || NEW.id || ':claimant:' || v_claimant_id || ':' || v_event_id
      );
    ELSIF v_approved_count > 1 THEN
      -- Ambiguity detected: multiple claims are approved for one physical item.
      -- Do NOT guess with LIMIT 1. Do NOT broadcast false handover notices.
      -- Record an administrative audit alert in the outbox for Central Admin review.
      INSERT INTO public.notification_outbox (
        idempotency_key, user_id, item_id, type, title, message, status, attempts, last_error
      )
      VALUES (
        'resolve:' || NEW.id || ':ambiguous_approved_claims:' || v_event_id,
        NEW.user_id,
        NEW.id,
        'item_resolved',
        'Ambiguous Resolution Notice',
        'Item resolved with ' || v_approved_count || ' approved claims. Claimant handover notification withheld pending administrative audit.',
        'failed',
        1,
        'Ambiguous approved claims: Item ' || NEW.id || ' has ' || v_approved_count || ' claims marked approved. Handover notification withheld.'
      )
      ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;
    -- If v_approved_count = 0: No claimant notification needed (self-resolved or expired found item)

    -- 2. Notify original reporter (strictly omitting claimant name, phone, student ID, and proof)
    IF NEW.user_id IS NOT NULL AND (v_approved_count <> 1 OR NEW.user_id <> v_approved_claimants[1]) THEN
      PERFORM public.safe_dispatch_notification(
        NEW.user_id,
        NEW.id,
        'item_resolved',
        'Item Case Closed',
        'The item you reported, "' || NEW.title || '", has been returned to its verified owner by Central Security. Thank you for helping our campus!',
        'resolve:' || NEW.id || ':reporter:' || NEW.user_id || ':' || v_event_id
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_item_resolution_notification ON public.items;
CREATE TRIGGER on_item_resolution_notification
  AFTER UPDATE OF status ON public.items
  FOR EACH ROW EXECUTE FUNCTION public.trg_notify_item_resolution();

-- ------------------------------------------------------------------------------
-- 7. OUTBOX RETRY RUNNER (CENTRAL ADMIN AUTHORIZED)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.retry_failed_notifications(p_max_batch INT DEFAULT 50)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row RECORD;
  v_count INT := 0;
BEGIN
  -- Authorization: Only Central Admin can trigger outbox retries
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Only Central Admin can trigger outbox retries.';
  END IF;

  FOR v_row IN
    SELECT *
    FROM public.notification_outbox
    WHERE status = 'pending'
    ORDER BY created_at ASC
    LIMIT p_max_batch
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      INSERT INTO public.notifications (
        user_id, item_id, type, title, message, idempotency_key
      )
      VALUES (
        v_row.user_id, v_row.item_id, v_row.type, v_row.title, v_row.message, v_row.idempotency_key
      )
      ON CONFLICT (idempotency_key) DO NOTHING;

      UPDATE public.notification_outbox
      SET status = 'delivered',
          updated_at = timezone('utc'::text, now())
      WHERE id = v_row.id;

      v_count := v_count + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.notification_outbox
      SET attempts = v_row.attempts + 1,
          last_error = SQLERRM,
          updated_at = timezone('utc'::text, now())
      WHERE id = v_row.id;
    END;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.retry_failed_notifications(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retry_failed_notifications(INT) TO authenticated;

COMMIT;
