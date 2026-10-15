export type ItemType = 'lost' | 'found';

export type ItemCategory =
  | 'Electronics'
  | 'Cards & IDs'
  | 'Keys'
  | 'Books & Notes'
  | 'Accessories'
  | 'Bottles & Containers'
  | 'Clothing'
  | 'Other';

export type ItemStatus = 'open' | 'in_custody' | 'claimed' | 'resolved';

export type ClaimStatus = 'pending' | 'approved' | 'rejected';

export interface Claim {
  id: string;
  item_id: string;
  claimant_id: string;
  claimant_name?: string;
  claimant_phone?: string;
  student_id_number?: string;
  proof_description?: string;
  claimant_email?: string;
  status: ClaimStatus;
  created_at: string;
  updated_at?: string;
  notes?: string;
}

export interface LostFoundItem {
  id: string;
  title: string;
  description: string;
  type: ItemType;
  category: ItemCategory;
  location: string;
  date: string;
  /** Optional user-uploaded image URL or local URI. If omitted, category fallback is used. */
  imageUrl?: string;
  /** Private Supabase Storage object path (e.g. userId/uuid.jpg) */
  imagePath?: string;
  contactName?: string;
  contactPhone?: string;
  /** Authenticated user UUID of the reporter from Supabase Auth */
  userId?: string;
  /** Current workflow status of the item */
  status?: ItemStatus;
  /** ISO timestamp when the record was created in the database */
  createdAt?: string;
  /** ISO timestamp when the item was returned to owner */
  returnedAt?: string;
  /** Distinguishes verified Supabase database records from local mock fallback data */
  isDatabaseRecord?: boolean;
  /** Optional finder details when someone reports finding a lost item */
  finderName?: string;
  finderPhone?: string;
  finderNote?: string;
}


