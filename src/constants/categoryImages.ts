import { ItemCategory, LostFoundItem } from '@/types/item';

/**
 * Predefined, static fallback images mapped by category.
 * Used when an item does not have a user-uploaded image.
 * These are fixed references to prevent loading random or inconsistent images.
 */
export const CATEGORY_FALLBACK_IMAGES: Record<ItemCategory, string> = {
  'Electronics': 'https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=600&auto=format&fit=crop&q=80',
  'Cards & IDs': 'https://images.unsplash.com/photo-1589330694653-dad6bc01cf0e?w=600&auto=format&fit=crop&q=80',
  'Keys': 'https://images.unsplash.com/photo-1582139329536-e7284fece509?w=600&auto=format&fit=crop&q=80',
  'Books & Notes': 'https://images.unsplash.com/photo-1497633762265-9d179a990aa6?w=600&auto=format&fit=crop&q=80',
  'Accessories': 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=600&auto=format&fit=crop&q=80',
  'Bottles & Containers': 'https://images.unsplash.com/photo-1602143407151-7111542de6e8?w=600&auto=format&fit=crop&q=80',
  'Clothing': 'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?w=600&auto=format&fit=crop&q=80',
  'Other': 'https://images.unsplash.com/photo-1530587191325-3db32d826c18?w=600&auto=format&fit=crop&q=80',
};

export interface ResolvedImage {
  uri: string;
  isIllustrative: boolean;
}

/**
 * Resolves the image source for an item:
 * - If the item has a user-uploaded image (`imageUrl`), return it with `isIllustrative: false`.
 * - If no image was provided, return the predefined category fallback with `isIllustrative: true`.
 */
export function resolveItemImage(
  item: Pick<LostFoundItem, 'imageUrl' | 'category'>
): ResolvedImage {
  if (item.imageUrl && item.imageUrl.trim().length > 0) {
    return {
      uri: item.imageUrl,
      isIllustrative: false,
    };
  }

  const fallbackUri =
    CATEGORY_FALLBACK_IMAGES[item.category] || CATEGORY_FALLBACK_IMAGES.Other;

  return {
    uri: fallbackUri,
    isIllustrative: true,
  };
}
