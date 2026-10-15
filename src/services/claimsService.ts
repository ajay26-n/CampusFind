import { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

export const CENTRAL_ADMIN_EMAIL = 'ajay.cs23@builderscollege.edu.in';

export type ClaimStatus = 'pending' | 'approved' | 'rejected';

export interface Claim {
  id: string;
  item_id: string;
  claimant_id: string;
  claimant_name: string;
  claimant_phone: string;
  student_id_number: string;
  proof_description: string;
  claimant_email?: string;
  status: ClaimStatus;
  created_at: string;
  updated_at?: string;
  notes?: string;
}

// In-memory cache for claims
const claimsCache = new Map<string, Claim[]>();
const custodySecuredCache = new Map<string, boolean>();

/**
 * Validates whether a string is a standard UUID.
 * Prevents passing non-UUID identifiers (such as mock item IDs 'item-1' or non-UUID strings)
 * into PostgreSQL UUID columns, which causes 22P02 syntax errors.
 */
export function isValidUuid(id?: string | null): boolean {
  if (!id) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

/**
 * Checks if the given user is the designated Central Admin.
 */
export function isCentralAdmin(user: User | null): boolean {
  if (!user || !user.email) return false;
  return user.email.trim().toLowerCase() === CENTRAL_ADMIN_EMAIL.toLowerCase();
}

/**
 * Checks if physical custody of the item has been marked secured at the Central Security Office.
 */
export function isCustodySecured(itemId: string): boolean {
  return custodySecuredCache.get(itemId) ?? false;
}

/**
 * Sets the physical custody status of the item.
 * Handover must occur before custody is marked as secured.
 */
export function setCustodySecured(itemId: string, secured: boolean): void {
  custodySecuredCache.set(itemId, secured);
}

/**
 * Creates a claim request in the existing database `claims` table with 'pending' status,
 * linked to the item and claimant.
 *
 * Rules:
 * - The student who created a Report Found item must never be able to claim that same item.
 * - Does NOT mark the item resolved or returned.
 * - Requires claimant_name, claimant_phone, student_id_number, and proof_description.
 * - Surfaces database validation errors directly without masking them with fake local fallbacks.
 */
export async function createClaimRequest(params: {
  itemId: string;
  claimantId: string;
  claimantName: string;
  claimantPhone: string;
  studentIdNumber: string;
  proofDescription: string;
  itemCreatorId?: string;
  claimantEmail?: string;
}): Promise<{ claim: Claim | null; error: string | null }> {
  const {
    itemId,
    claimantId,
    claimantName,
    claimantPhone,
    studentIdNumber,
    proofDescription,
    itemCreatorId,
    claimantEmail,
  } = params;

  // 1. Enforce creator rule: Reporter of a found item cannot claim their own item
  if (itemCreatorId && claimantId === itemCreatorId) {
    return {
      claim: null,
      error: 'You reported finding this item. The reporter of a found item cannot submit a claim for it.',
    };
  }

  // 2. Validate UUID format before querying PostgreSQL
  if (!isValidUuid(itemId)) {
    return {
      claim: null,
      error: 'Cannot submit a claim for a demo listing. Please select a verified campus report.',
    };
  }

  if (!isValidUuid(claimantId)) {
    return {
      claim: null,
      error: 'Invalid claimant account identifier.',
    };
  }

  // 3. Validate every required field before submitting
  const name = claimantName?.trim();
  const phone = claimantPhone?.trim();
  const studentId = studentIdNumber?.trim();
  const proof = proofDescription?.trim();

  if (!name) {
    return {
      claim: null,
      error: 'Full name is required to submit a claim.',
    };
  }

  if (!phone) {
    return {
      claim: null,
      error: 'Contact phone number is required to verify ownership.',
    };
  }

  if (!studentId) {
    return {
      claim: null,
      error: 'College / Student ID number is required for verification.',
    };
  }

  if (!proof) {
    return {
      claim: null,
      error: 'Proof of ownership description is required.',
    };
  }

  try {
    // 4. Insert claim with all required schema columns:
    // item_id, claimant_id, claimant_name, claimant_phone, student_id_number, proof_description, status: 'pending'
    const result = await supabase
      .from('claims')
      .insert({
        item_id: itemId,
        claimant_id: claimantId,
        claimant_name: name,
        claimant_phone: phone,
        student_id_number: studentId,
        proof_description: proof,
        status: 'pending',
      })
      .select()
      .maybeSingle();

    // 5. If the database returned an error, surface it directly
    if (result.error) {
      console.warn('[CampusFind Claims] DB insert error:', result.error.message);
      return {
        claim: null,
        error: result.error.message || 'Database rejected the claim request.',
      };
    }

    if (result.data) {
      const claim = result.data as Claim;
      if (claimantEmail && !claim.claimant_email) {
        claim.claimant_email = claimantEmail;
      }
      cacheClaim(claim);
      return { claim, error: null };
    }

    return {
      claim: null,
      error: 'No claim record returned from database.',
    };
  } catch (err: any) {
    console.error('[CampusFind Claims] Exception inserting claim:', err);
    return {
      claim: null,
      error: err?.message || 'Network error submitting claim request.',
    };
  }
}

/**
 * Fetches all claim requests for a specific item from the database.
 * Avoids querying PostgreSQL with non-UUID mock item IDs to prevent 22P02 errors.
 */
export async function fetchClaimsForItem(itemId: string): Promise<Claim[]> {
  if (!isValidUuid(itemId)) {
    return claimsCache.get(itemId) || [];
  }

  try {
    const { data, error } = await supabase
      .from('claims')
      .select('*')
      .eq('item_id', itemId)
      .order('created_at', { ascending: false });

    if (!error && data) {
      const dbClaims = data as Claim[];
      claimsCache.set(itemId, dbClaims);
      return dbClaims;
    }

    if (error) {
      console.warn('[CampusFind Claims] Error fetching claims from DB:', error.message);
    }
  } catch (err) {
    console.warn('[CampusFind Claims] Exception fetching claims from DB:', err);
  }

  return claimsCache.get(itemId) || [];
}

/**
 * Updates a claim status in the database (e.g. approve or reject by Central Admin).
 * Validates UUID to prevent PostgreSQL 22P02 errors.
 */
export async function updateClaimStatus(
  claimId: string,
  itemId: string,
  newStatus: ClaimStatus
): Promise<{ success: boolean; error: string | null }> {
  if (!isValidUuid(claimId)) {
    return {
      success: false,
      error: `Invalid claim UUID: "${claimId}". Cannot update a non-database claim record.`,
    };
  }

  try {
    const { error } = await supabase
      .from('claims')
      .update({ status: newStatus })
      .eq('id', claimId);

    if (error) {
      console.warn('[CampusFind Claims] Error updating status in DB:', error.message);
      return { success: false, error: error.message };
    }

    // Update local cache
    const cached = claimsCache.get(itemId) || [];
    const updated = cached.map((c) => (c.id === claimId ? { ...c, status: newStatus } : c));
    claimsCache.set(itemId, updated);

    return { success: true, error: null };
  } catch (err: any) {
    console.warn('[CampusFind Claims] Exception updating claim in DB:', err);
    return { success: false, error: err?.message || 'Failed to update claim.' };
  }
}

/**
 * Helper to check if a specific user already has an active claim for this item.
 */
export function hasUserClaimedItem(itemId: string, userId: string): boolean {
  const cached = claimsCache.get(itemId) || [];
  return cached.some(
    (c) =>
      c.claimant_id === userId &&
      (c.status === 'pending' || c.status === 'approved')
  );
}

function cacheClaim(claim: Claim) {
  const current = claimsCache.get(claim.item_id) || [];
  if (!current.some((c) => c.id === claim.id)) {
    claimsCache.set(claim.item_id, [claim, ...current]);
  }
}

/**
 * Retrieves user-friendly in-screen status feedback for a student claim.
 */
export function getClaimantStatus(claim?: Claim | null): {
  status: ClaimStatus | 'none';
  label: string;
  subtext: string;
} {
  if (!claim) {
    return {
      status: 'none',
      label: 'No Claim Submitted',
      subtext: 'You have not submitted a claim for this item.',
    };
  }

  switch (claim.status) {
    case 'approved':
      return {
        status: 'approved',
        label: 'Claim Approved',
        subtext: 'Bring your college ID to the Central Security Office to complete collection.',
      };
    case 'rejected':
      return {
        status: 'rejected',
        label: 'Claim Rejected',
        subtext: 'Your ownership proof was not approved. Contact Central Security Office if you need clarification.',
      };
    case 'pending':
    default:
      return {
        status: 'pending',
        label: 'Claim Pending Review',
        subtext: 'Central Security Office is reviewing your request.',
      };
  }
}

