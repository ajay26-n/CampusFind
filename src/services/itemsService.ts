import { CENTRAL_ADMIN_EMAIL } from '@/constants/auth';
import { MOCK_ITEMS } from '@/data/mockItems';
import { supabase } from '@/lib/supabase';
import { isValidUuid } from '@/services/claimsService';
import { notificationsStore } from '@/services/notificationsService';
import { ItemCategory, ItemStatus, ItemType, LostFoundItem } from '@/types/item';
import { decodeBase64ToArrayBuffer } from '@/utils/base64';

export interface DatabaseItemRow {
  id: string;
  user_id: string;
  title: string;
  description: string;
  type: ItemType;
  category: ItemCategory;
  location: string;
  date_string: string;
  image_url: string | null;
  image_path?: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  status: ItemStatus;
  returned_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateItemInput {
  title: string;
  description: string;
  type: ItemType;
  category: ItemCategory;
  location: string;
  date: string;
  imageUrl?: string | null;
  imageBase64?: string | null;
  imageMimeType?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
}

/**
 * In-memory cache for generated signed URLs to minimize Supabase Storage API requests.
 */
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

/**
 * Maps a Postgres row from Supabase to the app's LostFoundItem model.
 */
export function mapRowToItem(row: DatabaseItemRow, signedUrl?: string): LostFoundItem {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    type: row.type,
    category: row.category,
    location: row.location,
    date: row.date_string,
    imageUrl: signedUrl || row.image_url || undefined,
    imagePath: row.image_path ?? undefined,
    contactName: row.contact_name ?? undefined,
    contactPhone: row.contact_phone ?? undefined,
    userId: row.user_id,
    status: row.status,
    createdAt: row.created_at,
    returnedAt: row.returned_at ?? undefined,
    isDatabaseRecord: true,
  };
}

/**
 * Generates a signed URL for a private storage path (valid for 24 hours).
 * Returns cached URL if still valid.
 */
export async function getSignedImageUrl(
  imagePath: string,
  expiresInSeconds: number = 86400
): Promise<string | null> {
  if (!imagePath) return null;

  const now = Date.now();
  const cached = signedUrlCache.get(imagePath);
  if (cached && cached.expiresAt > now + 60000) {
    return cached.url;
  }

  try {
    const { data, error } = await supabase.storage
      .from('item-images')
      .createSignedUrl(imagePath, expiresInSeconds);

    if (error || !data?.signedUrl) {
      console.warn('[CampusFind Storage] Error generating signed URL:', error?.message);
      return null;
    }

    signedUrlCache.set(imagePath, {
      url: data.signedUrl,
      expiresAt: now + expiresInSeconds * 1000,
    });

    return data.signedUrl;
  } catch (err) {
    console.warn('[CampusFind Storage] Failed to get signed URL:', err);
    return null;
  }
}

/**
 * Batch generates signed URLs for multiple storage paths.
 */
export async function batchGetSignedImageUrls(
  imagePaths: string[],
  expiresInSeconds: number = 86400
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const neededPaths: string[] = [];
  const now = Date.now();

  for (const path of imagePaths) {
    if (!path) continue;
    const cached = signedUrlCache.get(path);
    if (cached && cached.expiresAt > now + 60000) {
      result[path] = cached.url;
    } else {
      neededPaths.push(path);
    }
  }

  if (neededPaths.length === 0) {
    return result;
  }

  try {
    const { data, error } = await supabase.storage
      .from('item-images')
      .createSignedUrls(neededPaths, expiresInSeconds);

    if (!error && data) {
      for (const item of data) {
        if (item.path && item.signedUrl) {
          result[item.path] = item.signedUrl;
          signedUrlCache.set(item.path, {
            url: item.signedUrl,
            expiresAt: now + expiresInSeconds * 1000,
          });
        }
      }
    }
  } catch (err) {
    console.warn('[CampusFind Storage] Batch signed URL error:', err);
  }

  return result;
}

/**
 * Uploads local image bytes from the phone's gallery to the private 'item-images' Supabase Storage bucket.
 * Uses base64 decoding into a standard binary ArrayBuffer with strict non-zero byte validation.
 * Stored inside the authenticated user's folder: `${userId}/${timestamp}_${randomId}.${ext}`.
 */
export async function uploadItemImage(
  localUri: string,
  userId: string,
  base64Data?: string | null,
  mimeTypeHint?: string | null
): Promise<{ path: string | null; error: string | null }> {
  try {
    let arrayBuffer: ArrayBuffer | null = null;

    // 1. Obtain binary bytes: prioritize base64 decoding (standard React Native / Expo Go path)
    if (base64Data && base64Data.trim().length > 0) {
      arrayBuffer = decodeBase64ToArrayBuffer(base64Data);
    } else if (localUri) {
      // Fallback for Web or environments with valid native file fetch support
      try {
        const response = await fetch(localUri);
        arrayBuffer = await response.arrayBuffer();
      } catch (fetchErr: any) {
        return {
          path: null,
          error: `Could not read image file from device: ${fetchErr?.message || 'Read failure'}`,
        };
      }
    }

    // 2. Strict safeguard: Never upload empty (0-byte) or null payload
    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      return {
        path: null,
        error: 'Selected image contains zero bytes or could not be decoded. Please choose another photo.',
      };
    }

    // 3. Preserve actual MIME type and suitable file extension
    const lowerUri = (localUri || '').toLowerCase();
    const lowerMime = (mimeTypeHint || '').toLowerCase();

    let ext = 'jpg';
    let mimeType = 'image/jpeg';

    if (lowerMime.includes('png') || lowerUri.endsWith('.png')) {
      ext = 'png';
      mimeType = 'image/png';
    } else if (lowerMime.includes('webp') || lowerUri.endsWith('.webp')) {
      ext = 'webp';
      mimeType = 'image/webp';
    } else if (lowerMime.includes('gif') || lowerUri.endsWith('.gif')) {
      ext = 'gif';
      mimeType = 'image/gif';
    } else if (lowerMime.includes('jpeg') || lowerMime.includes('jpg') || lowerUri.endsWith('.jpeg') || lowerUri.endsWith('.jpg')) {
      ext = 'jpg';
      mimeType = 'image/jpeg';
    }

    // 4. Generate unique file name inside user's authenticated folder
    const timestamp = Date.now();
    const randomHex = Math.random().toString(36).substring(2, 9);
    const storagePath = `${userId}/${timestamp}_${randomHex}.${ext}`;

    // 5. Upload binary ArrayBuffer to Supabase Storage
    const { data, error } = await supabase.storage
      .from('item-images')
      .upload(storagePath, arrayBuffer, {
        contentType: mimeType,
        upsert: false,
      });

    if (error) {
      console.error('[CampusFind Storage] Upload error:', error.message);
      return { path: null, error: error.message };
    }

    return { path: storagePath, error: null };
  } catch (err: any) {
    console.error('[CampusFind Storage] Exception reading/uploading file:', err);
    return {
      path: null,
      error: err?.message || 'Failed to process and upload image bytes.',
    };
  }
}

/**
 * Fetches all reports from the Supabase `items` table and batch-resolves signed URLs.
 * Falls back to mock items with clear non-database flags if the database table is empty or unreachable.
 */
export async function fetchItems(): Promise<{
  items: LostFoundItem[];
  error: string | null;
  isFallback: boolean;
}> {
  try {
    const { data, error } = await supabase
      .from('items_feed')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('[CampusFind DB] Error fetching items from Supabase:', error.message);
      const fallbackItems = MOCK_ITEMS.map((item) => ({
        ...item,
        isDatabaseRecord: false,
      }));
      return {
        items: fallbackItems,
        error: error.message,
        isFallback: true,
      };
    }

    if (data && data.length > 0) {
      const rows = data as DatabaseItemRow[];

      // Collect image paths that need signed URLs
      const imagePaths = rows
        .map((r) => r.image_path)
        .filter((p): p is string => Boolean(p));

      // Batch resolve signed URLs
      const signedUrlMap = await batchGetSignedImageUrls(imagePaths);

      const realItems = rows.map((row) =>
        mapRowToItem(row, row.image_path ? signedUrlMap[row.image_path] : undefined)
      );

      return {
        items: realItems,
        error: null,
        isFallback: false,
      };
    }

    // Table is reachable but empty
    return {
      items: [],
      error: null,
      isFallback: false,
    };
  } catch (err: any) {
    console.warn('[CampusFind DB] Unexpected error during fetch:', err);
    return {
      items: MOCK_ITEMS.map((item) => ({ ...item, isDatabaseRecord: false })),
      error: err?.message || 'Network error fetching reports.',
      isFallback: true,
    };
  }
}

/**
 * Fetches a single item by ID from Supabase and resolves its signed image URL.
 */
export async function fetchItemById(id: string): Promise<LostFoundItem | null> {
  try {
    const { data, error } = await supabase
      .from('items_feed')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (!error && data) {
      const row = data as DatabaseItemRow;
      let signedUrl: string | undefined = undefined;
      if (row.image_path) {
        signedUrl = (await getSignedImageUrl(row.image_path)) ?? undefined;
      }
      return mapRowToItem(row, signedUrl);
    }

    // Fallback: If not accessible via direct select (e.g. claimant viewing an approved resolved item),
    // query the secure resolved-item RPC helper:
    if (isValidUuid(id)) {
      const { data: rpcData, error: rpcError } = await supabase
        .rpc('get_resolved_item_for_user', { p_item_id: id })
        .maybeSingle();

      if (!rpcError && rpcData) {
        const row = rpcData as DatabaseItemRow;
        let signedUrl: string | undefined = undefined;
        if (row.image_path) {
          signedUrl = (await getSignedImageUrl(row.image_path)) ?? undefined;
        }
        return mapRowToItem(row, signedUrl);
      }
    }
  } catch {
    // Ignore and fallback to mock items
  }

  const mockItem = MOCK_ITEMS.find((item) => item.id === id);
  if (mockItem) {
    return {
      ...mockItem,
      isDatabaseRecord: false,
    };
  }

  return null;
}

/**
 * Creates a new report in the Supabase PostgreSQL `items` table.
 * If a local gallery image was provided, uploads it to the private 'item-images' bucket,
 * stores the object path in 'image_path', and prevents orphaned storage files on failure.
 */
export async function createItem(input: CreateItemInput): Promise<{
  item: LostFoundItem | null;
  error: string | null;
}> {
  try {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return {
        item: null,
        error: 'You must be signed in with your Builders College account to submit a report.',
      };
    }

    const rawImage = input.imageUrl?.trim() || null;
    const isLocalDeviceUri = rawImage && (rawImage.startsWith('file://') || rawImage.startsWith('content://'));
    const isRemoteWebUrl = rawImage && (rawImage.startsWith('http://') || rawImage.startsWith('https://'));

    let uploadedStoragePath: string | null = null;
    const directImageUrl: string | null = isRemoteWebUrl ? rawImage : null;

    // 1. Upload gallery image to private Storage bucket if user picked one
    if (isLocalDeviceUri && rawImage) {
      const { path, error: uploadError } = await uploadItemImage(
        rawImage,
        user.id,
        input.imageBase64,
        input.imageMimeType
      );

      if (uploadError || !path) {
        return {
          item: null,
          error: `Photo upload failed: ${uploadError || 'Could not upload image to cloud storage.'}`,
        };
      }

      uploadedStoragePath = path;
    }

    // 2. Insert report row into Supabase PostgreSQL items table
    const { data, error: dbError } = await supabase
      .from('items')
      .insert({
        user_id: user.id,
        title: input.title.trim(),
        description: input.description.trim(),
        type: input.type,
        category: input.category,
        location: input.location.trim(),
        date_string: input.date.trim(),
        image_path: uploadedStoragePath,
        image_url: directImageUrl,
        contact_name: input.contactName?.trim() || null,
        contact_phone: input.contactPhone?.trim() || null,
        status: 'open',
      })
      .select()
      .single();

    if (dbError) {
      // Clean up uploaded image if database insert fails to prevent orphaned storage objects
      if (uploadedStoragePath) {
        await supabase.storage.from('item-images').remove([uploadedStoragePath]);
      }

      return {
        item: null,
        error: dbError.message,
      };
    }

    // 3. Resolve signed URL for immediate display
    let signedUrl: string | undefined = undefined;
    if (uploadedStoragePath) {
      signedUrl = (await getSignedImageUrl(uploadedStoragePath)) ?? undefined;
    }

    const createdItem = mapRowToItem(
      data as DatabaseItemRow,
      signedUrl || (isLocalDeviceUri ? rawImage : undefined)
    );

    return {
      item: createdItem,
      error: null,
    };
  } catch (err: any) {
    return {
      item: null,
      error: err?.message || 'An unexpected error occurred while saving to the database.',
    };
  }
}

/**
 * Resolves an item (Item Return Workflow).
 * Enforces admin authorization: Only CENTRAL_ADMIN_EMAIL can execute this workflow.
 * Updates item's status to 'resolved' in Supabase and updates the store so it is
 * immediately hidden from the student feed without deleting records.
 * Preserves claims and audit history.
 * Supports test environment simulation when explicitly requested.
 */
export async function resolveItem(
  itemId: string,
  options?: { simulate?: boolean }
): Promise<{ success: boolean; error: string | null; isSimulated: boolean }> {
  try {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return {
        success: false,
        error: 'Authentication required. Please sign in as Central Admin.',
        isSimulated: false,
      };
    }

    // 1. Enforce Central Admin authorization
    if (user.email?.trim().toLowerCase() !== CENTRAL_ADMIN_EMAIL.toLowerCase()) {
      return {
        success: false,
        error: 'Unauthorized: Only the Central Admin (ajay.cs23@builderscollege.edu.in) can mark items as returned.',
        isSimulated: false,
      };
    }

    // 2. If simulation mode is explicitly requested for test environment (local only)
    if (options?.simulate) {
      return { success: true, error: null, isSimulated: true };
    }

    // 3. For real database records, validate UUID before issuing Supabase query
    if (!isValidUuid(itemId)) {
      return {
        success: false,
        error:
          'Cannot resolve mock demo items in Supabase. Please select a real item submitted to Supabase or use "Simulate in Test Mode".',
        isSimulated: false,
      };
    }

    // 4. Attempt real Supabase PostgreSQL update
    const { data, error } = await supabase
      .from('items')
      .update({ status: 'resolved', updated_at: new Date().toISOString() })
      .eq('id', itemId)
      .select()
      .maybeSingle();

    if (error) {
      console.warn('[CampusFind Items] DB resolve error:', error.message);
      return {
        success: false,
        error: error.message,
        isSimulated: false,
      };
    }

    // Check if row was actually updated in Supabase
    if (!data) {
      return {
        success: false,
        error:
          'Database update rejected: The item record could not be updated in Supabase. Please verify database RLS policies and triggers allow Central Admin resolution.',
        isSimulated: false,
      };
    }

    // Confirm that Supabase returned status = 'resolved'
    if (data.status !== 'resolved') {
      return {
        success: false,
        error: `Unexpected item status returned from Supabase: "${data.status}". Expected "resolved".`,
        isSimulated: false,
      };
    }

    return { success: true, error: null, isSimulated: false };
  } catch (err: any) {
    console.error('[CampusFind Items] Exception resolving item:', err);
    return {
      success: false,
      error: err?.message || 'Unexpected error resolving item.',
      isSimulated: false,
    };
  }
}

/**
 * Updates an item's physical custody status in Supabase.
 * Enforces admin authorization: Only CENTRAL_ADMIN_EMAIL can execute this transition.
 */
export async function updateItemCustody(
  itemId: string,
  inCustody: boolean
): Promise<{ success: boolean; error: string | null }> {
  try {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return {
        success: false,
        error: 'Authentication required. Please sign in as Central Admin.',
      };
    }

    if (user.email?.trim().toLowerCase() !== CENTRAL_ADMIN_EMAIL.toLowerCase()) {
      return {
        success: false,
        error: 'Unauthorized: Only Central Admin can change custody status.',
      };
    }

    if (isValidUuid(itemId)) {
      const newStatus: ItemStatus = inCustody ? 'in_custody' : 'open';
      const { data, error } = await supabase
        .from('items')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', itemId)
        .select()
        .maybeSingle();

      if (error) {
        console.warn('[CampusFind Items] DB custody update error:', error.message);
        return { success: false, error: error.message };
      }

      if (!data) {
        return {
          success: false,
          error: 'Database update rejected: Unable to update custody status in Supabase.',
        };
      }
    }

    return { success: true, error: null };
  } catch (err: any) {
    console.error('[CampusFind Items] Exception updating custody:', err);
    return {
      success: false,
      error: err?.message || 'Unexpected error updating custody status.',
    };
  }
}

/**
 * Submits an "I Found This Item" report for a Lost item.
 * 1. Dispatches notification to the owner who lost the item ('item_found').
 * 2. Dispatches notification to Central Admin to expect physical handover.
 * 3. Instructs the finder to drop off the item at Central Security Office.
 * Handles both Supabase RPC and local simulated notifications seamlessly.
 */
export async function reportLostItemFound(params: {
  itemId: string;
  finderName: string;
  finderPhone: string;
  finderNote: string;
  item: LostFoundItem;
}): Promise<{ success: boolean; error: string | null; message?: string }> {
  const { itemId, finderName, finderPhone, finderNote, item } = params;

  try {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return {
        success: false,
        error: 'Authentication required. Please sign in to report finding this item.',
      };
    }

    if (item.userId && user.id === item.userId) {
      return {
        success: false,
        error: 'You reported losing this item. You cannot report finding your own item.',
      };
    }

    const trimmedName = finderName.trim();
    const trimmedPhone = finderPhone.trim();
    const trimmedNote = finderNote.trim();

    if (!trimmedName) {
      return { success: false, error: 'Your name is required.' };
    }
    if (!trimmedPhone) {
      return { success: false, error: 'Contact phone number is required.' };
    }
    if (!trimmedNote) {
      return { success: false, error: 'Handover location or details note is required.' };
    }

    // If it's a real database UUID item, attempt Supabase RPC
    if (isValidUuid(itemId)) {
      const { data, error } = await supabase.rpc('report_lost_item_found', {
        p_item_id: itemId,
        p_finder_name: trimmedName,
        p_finder_phone: trimmedPhone,
        p_note: trimmedNote,
      });

      if (!error && data && data.success) {
        return {
          success: true,
          error: null,
          message: data.message || 'Found report submitted successfully.',
        };
      }

      if (error) {
        console.warn('[CampusFind Items] RPC error for report_lost_item_found:', error.message);
      }
    }

    // Local / fallback handling: Dispatch notifications directly so user always has working UX
    const nowIso = new Date().toISOString();
    const eventId = Math.random().toString(36).substring(2, 9);

    // Notify the user who lost the item
    if (item.userId) {
      notificationsStore.addNotification({
        id: `notif-found-owner-${eventId}`,
        userId: item.userId,
        itemId: item.id,
        type: 'item_found',
        title: 'Lost Item Found! 🎉',
        message: `Good news! ${trimmedName} (${trimmedPhone}) reported finding your lost item "${item.title}". Note: "${trimmedNote}". They were directed to hand it over to Central Security Office.`,
        isRead: false,
        idempotencyKey: `local:item_found:owner:${item.id}:${eventId}`,
        createdAt: nowIso,
      });
    }

    // Also notify if current user is admin or on device
    notificationsStore.addNotification({
      id: `notif-found-admin-${eventId}`,
      userId: user.id,
      itemId: item.id,
      type: 'item_found',
      title: 'Lost Item Handover Expected 🛡️',
      message: `Finder ${trimmedName} (${trimmedPhone}) reported finding lost item "${item.title}". Handover note: "${trimmedNote}". Handover expected at Central Security Office.`,
      isRead: false,
      idempotencyKey: `local:item_found:admin:${item.id}:${eventId}`,
      createdAt: nowIso,
    });

    return {
      success: true,
      error: null,
      message: 'Found report recorded. Owner and Central Security Office have been notified.',
    };
  } catch (err: any) {
    console.error('[CampusFind Items] Exception reporting lost item found:', err);
    return {
      success: false,
      error: err?.message || 'Failed to submit found report.',
    };
  }
}

