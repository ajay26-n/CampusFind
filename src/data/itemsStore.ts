import { useSyncExternalStore } from 'react';

import { MOCK_ITEMS } from '@/data/mockItems';
import { fetchItems } from '@/services/itemsService';
import { ItemStatus, LostFoundItem } from '@/types/item';

type Listener = () => void;

// In-memory cache for items during the session (starts with mock items as dev fallback)
let items: LostFoundItem[] = MOCK_ITEMS.map((item) => ({ ...item, isDatabaseRecord: false }));
let isLoading = false;
let isFallback = true;
const listeners = new Set<Listener>();

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

export const itemsStore = {
  getItems: (): LostFoundItem[] => items,

  getIsLoading: (): boolean => isLoading,

  getIsFallback: (): boolean => isFallback,

  getItemById: (id: string): LostFoundItem | undefined => {
    return items.find((item) => item.id === id);
  },

  setItems: (newItems: LostFoundItem[], fallbackFlag: boolean = false): void => {
    items = newItems;
    isFallback = fallbackFlag;
    emitChange();
  },

  addItem: (newItem: LostFoundItem): void => {
    // Add new item to the top of the list
    items = [newItem, ...items];
    emitChange();
  },

  updateItemStatus: (id: string, status: ItemStatus): void => {
    items = items.map((item) => (item.id === id ? { ...item, status } : item));
    emitChange();
  },

  /**
   * Refreshes items by querying the Supabase PostgreSQL database.
   */
  refreshFromDatabase: async (): Promise<{ count: number; error: string | null }> => {
    isLoading = true;
    emitChange();

    try {
      const { items: dbItems, error, isFallback: fallback } = await fetchItems();

      if (!error && dbItems.length > 0) {
        items = dbItems;
        isFallback = fallback;
      } else if (!error && dbItems.length === 0) {
        // Database is empty: show empty list or provide empty state
        items = [];
        isFallback = false;
      } else {
        // Network/database error: keep fallback with error warning
        items = MOCK_ITEMS.map((item) => ({ ...item, isDatabaseRecord: false }));
        isFallback = true;
      }

      emitChange();
      return { count: items.length, error };
    } catch (err: any) {
      items = MOCK_ITEMS.map((item) => ({ ...item, isDatabaseRecord: false }));
      isFallback = true;
      emitChange();
      return { count: items.length, error: err?.message || 'Error loading reports' };
    } finally {
      isLoading = false;
      emitChange();
    }
  },

  subscribe: (listener: Listener): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/**
 * React hook to subscribe to items.
 * Triggers re-renders when reports are fetched, refreshed, or created.
 */
export function useItems(): LostFoundItem[] {
  return useSyncExternalStore(itemsStore.subscribe, itemsStore.getItems);
}

/**
 * React hook to track database fetch loading state.
 */
export function useItemsLoading(): boolean {
  return useSyncExternalStore(itemsStore.subscribe, itemsStore.getIsLoading);
}

/**
 * React hook to track whether currently displayed items are mock fallback data.
 */
export function useItemsIsFallback(): boolean {
  return useSyncExternalStore(itemsStore.subscribe, itemsStore.getIsFallback);
}
