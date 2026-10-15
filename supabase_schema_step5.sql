-- ==============================================================================
-- CampusFind: Hardened Step 5 Database Schema Migration (Production-Ready)
-- Run this entire script in your Supabase Dashboard -> SQL Editor
--
-- Security Features:
-- 1. Idempotent: Can be safely rerun multiple times without errors.
-- 2. Email Privacy: Students cannot scrape or inspect other students' profiles.
-- 3. Role Protection: Students cannot escalate their privileges to admin.
-- 4. Verified College Only: Database-level enforcement of email verification
--    and @builderscollege.edu.in domain before allowing report insertion.
-- 5. Strict Ownership: Reports can only be updated/deleted by original authors.
-- 6. Safe Search Paths: All SECURITY DEFINER functions lock search_path.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. PROFILES TABLE
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 1.1 RLS: Private profile access (prevents mass harvesting of student emails)
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
CREATE POLICY "Users can view their own profile"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- 1.2 RLS: Self-profile updates only
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- 1.3 Trigger: Prevent role tampering & immutable fields modification
CREATE OR REPLACE FUNCTION public.protect_profile_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Prevent modifying account ID or email directly
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Unauthorized: Account ID cannot be changed.';
  END IF;
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    RAISE EXCEPTION 'Unauthorized: Email cannot be changed directly in profiles.';
  END IF;

  -- Prevent role escalation to admin unless executed by service_role or superuser
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF current_user <> 'postgres' AND auth.role() <> 'service_role' THEN
      RAISE EXCEPTION 'Unauthorized: You cannot grant yourself or modify account roles.';
    END IF;
  END IF;

  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.protect_profile_role() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_protect_profile_role ON public.profiles;
CREATE TRIGGER trg_protect_profile_role
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_role();

-- 1.4 Trigger: Auto-provision profile on auth.users signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    'student'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill profile rows for any existing accounts
INSERT INTO public.profiles (id, email, full_name, role)
SELECT
  id,
  email,
  COALESCE(raw_user_meta_data->>'full_name', split_part(email, '@', 1)),
  'student'
FROM auth.users
ON CONFLICT (id) DO NOTHING;


-- ------------------------------------------------------------------------------
-- 2. HELPER FUNCTIONS FOR VERIFICATION CHECK
-- ------------------------------------------------------------------------------

-- Safely inspect auth.users to ensure the user has confirmed their @builderscollege.edu.in email
CREATE OR REPLACE FUNCTION public.is_verified_college_user()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM auth.users
    WHERE id = auth.uid()
      AND email_confirmed_at IS NOT NULL
      AND email ILIKE '%@builderscollege.edu.in'
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_verified_college_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_verified_college_user() TO authenticated;


-- ------------------------------------------------------------------------------
-- 3. LOST & FOUND ITEMS TABLE
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('lost', 'found')),
  category TEXT NOT NULL CHECK (
    category IN (
      'Electronics',
      'Cards & IDs',
      'Keys',
      'Books & Notes',
      'Accessories',
      'Bottles & Containers',
      'Clothing',
      'Other'
    )
  ),
  location TEXT NOT NULL,
  date_string TEXT NOT NULL,
  image_url TEXT,
  image_path TEXT,
  contact_name TEXT,
  contact_phone TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'claimed', 'resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_items_created_at ON public.items (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_items_type ON public.items (type);
CREATE INDEX IF NOT EXISTS idx_items_category ON public.items (category);
CREATE INDEX IF NOT EXISTS idx_items_user_id ON public.items (user_id);

ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;

-- 3.1 RLS: Public read access — anyone can browse campus lost and found listings
DROP POLICY IF EXISTS "Items are viewable by everyone" ON public.items;
CREATE POLICY "Items are viewable by everyone"
  ON public.items
  FOR SELECT
  USING (true);

-- 3.2 RLS: Only authenticated, email-verified college users can insert reports for themselves
DROP POLICY IF EXISTS "Authenticated users can insert their own reports" ON public.items;
DROP POLICY IF EXISTS "Verified college users can insert their own reports" ON public.items;
CREATE POLICY "Verified college users can insert their own reports"
  ON public.items
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND public.is_verified_college_user() = true
  );

-- 3.3 RLS: Users can only update reports they created
DROP POLICY IF EXISTS "Users can update their own reports" ON public.items;
CREATE POLICY "Users can update their own reports"
  ON public.items
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 3.4 RLS: Users can only delete reports they created
DROP POLICY IF EXISTS "Users can delete their own reports" ON public.items;
CREATE POLICY "Users can delete their own reports"
  ON public.items
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- 3.5 Trigger: Protect immutable item fields and auto-touch updated_at
CREATE OR REPLACE FUNCTION public.protect_item_modification()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Prevent transferring item ownership to another user
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Unauthorized: Item reporter ownership cannot be transferred.';
  END IF;

  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_items_protect ON public.items;
CREATE TRIGGER trg_items_protect
  BEFORE UPDATE ON public.items
  FOR EACH ROW EXECUTE FUNCTION public.protect_item_modification();
