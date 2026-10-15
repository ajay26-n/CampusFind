-- ==============================================================================
-- CampusFind: Step 5.1 Supabase Storage Setup (Private item-images Bucket)
-- Run this script in your Supabase Dashboard -> SQL Editor
--
-- Features:
-- 1. Adds 'image_path' column to public.items table for storage object keys.
-- 2. Provisions the private 'item-images' bucket (5 MB limit, image types only).
-- 3. Enables RLS on storage.objects:
--    - Upload: Users can only upload files into their own user-ID folder.
--    - Update/Delete: Users can only modify/delete files in their own folder.
--    - Read/Sign: Allows generating time-limited signed URLs for display.
-- ==============================================================================

-- 1. Add image_path column to items table if not already present
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS image_path TEXT;

-- 2. Create the private 'item-images' bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'item-images',
  'item-images',
  false, -- Strictly private: direct unauthenticated URL access is blocked
  5242880, -- 5 MB file size limit
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/jpg']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];

-- 3. Storage Policy: Upload (INSERT)
-- Authenticated users may only upload objects into a folder named after their auth.uid()
DROP POLICY IF EXISTS "Authenticated users can upload item images to own folder" ON storage.objects;
CREATE POLICY "Authenticated users can upload item images to own folder"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'item-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 5. Storage Policy: Update (UPDATE)
-- Users may only replace/update files located inside their own user folder
DROP POLICY IF EXISTS "Users can update their own item images" ON storage.objects;
CREATE POLICY "Users can update their own item images"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'item-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'item-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 6. Storage Policy: Delete (DELETE)
-- Users may only delete files located inside their own user folder
DROP POLICY IF EXISTS "Users can delete their own item images" ON storage.objects;
CREATE POLICY "Users can delete their own item images"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'item-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 7. Storage Policy: Read / Signed URL Generation (SELECT)
-- Allows reading objects to generate signed download URLs (bucket is private, so signed token is required)
DROP POLICY IF EXISTS "Users can read item images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated and public users can read item images via signed URL" ON storage.objects;
CREATE POLICY "Users can read item images"
  ON storage.objects FOR SELECT
  TO authenticated, anon
  USING (bucket_id = 'item-images');
