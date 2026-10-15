import { useSyncExternalStore } from 'react';
import { supabase } from '@/lib/supabase';
import { DatabaseNotificationRow, NotificationItem } from '@/types/notification';

type Listener = () => void;

let notifications: NotificationItem[] = [];
let isLoading = false;
let lastFetchedUserId: string | null = null;
const listeners = new Set<Listener>();

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

function mapRowToNotification(row: DatabaseNotificationRow): NotificationItem {
  return {
    id: row.id,
    userId: row.user_id,
    itemId: row.item_id,
    type: row.type,
    title: row.title,
    message: row.message,
    isRead: row.is_read,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
  };
}

export const notificationsStore = {
  getNotifications: (): NotificationItem[] => notifications,

  getIsLoading: (): boolean => isLoading,

  getUnreadCount: (): number => {
    return notifications.filter((n) => !n.isRead).length;
  },

  setNotifications: (items: NotificationItem[]): void => {
    notifications = items;
    emitChange();
  },

  addNotification: (item: NotificationItem): void => {
    notifications = [item, ...notifications.filter((n) => n.id !== item.id)];
    emitChange();
  },

  markLocalAsRead: (id: string): void => {
    let changed = false;
    notifications = notifications.map((n) => {
      if (n.id === id && !n.isRead) {
        changed = true;
        return { ...n, isRead: true };
      }
      return n;
    });
    if (changed) {
      emitChange();
    }
  },

  clear: (): void => {
    notifications = [];
    lastFetchedUserId = null;
    emitChange();
  },

  /**
   * Refreshes notifications for the current authenticated user from Supabase.
   */
  refreshFromDatabase: async (): Promise<{
    notifications: NotificationItem[];
    error: string | null;
  }> => {
    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        notifications = [];
        lastFetchedUserId = null;
        emitChange();
        return { notifications: [], error: null };
      }

      isLoading = true;
      emitChange();

      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false });

      isLoading = false;

      if (error) {
        console.warn('[CampusFind Notifications] Fetch error:', error.message);
        emitChange();
        return { notifications, error: error.message };
      }

      if (data) {
        const rows = data as DatabaseNotificationRow[];
        notifications = rows.map(mapRowToNotification);
        lastFetchedUserId = user.id;
        emitChange();
        return { notifications, error: null };
      }

      emitChange();
      return { notifications: [], error: null };
    } catch (err: any) {
      isLoading = false;
      console.warn('[CampusFind Notifications] Unexpected error:', err);
      emitChange();
      return { notifications, error: err?.message || 'Network error fetching notifications.' };
    }
  },

  /**
   * Securely marks a single notification as read via least-privilege RPC.
   */
  markAsRead: async (id: string): Promise<boolean> => {
    notificationsStore.markLocalAsRead(id);

    try {
      const { data, error } = await supabase.rpc('mark_notification_as_read', {
        p_notification_id: id,
      });

      if (error) {
        console.warn('[CampusFind Notifications] markAsRead error:', error.message);
        return false;
      }

      return Boolean(data);
    } catch (err) {
      console.warn('[CampusFind Notifications] markAsRead exception:', err);
      return false;
    }
  },

  /**
   * Triggers the outbox retry runner if the active user is Central Admin.
   * Fails gracefully and silently for normal students.
   */
  retryOutboxIfAdmin: async (): Promise<number> => {
    try {
      const { data, error } = await supabase.rpc('retry_failed_notifications', {
        p_max_batch: 50,
      });

      if (error) {
        // Expected to fail with unauthorized for non-admins; silently return 0
        return 0;
      }

      const processedCount = Number(data) || 0;
      if (processedCount > 0) {
        // Refresh feed to display any newly delivered notifications
        await notificationsStore.refreshFromDatabase();
      }
      return processedCount;
    } catch {
      return 0;
    }
  },
};

/**
 * React hook for consuming all notifications.
 */
export function useNotifications(): NotificationItem[] {
  return useSyncExternalStore(
    (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    notificationsStore.getNotifications,
    notificationsStore.getNotifications
  );
}

/**
 * React hook for consuming the unread notification count badge.
 */
export function useUnreadNotificationCount(): number {
  return useSyncExternalStore(
    (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    notificationsStore.getUnreadCount,
    notificationsStore.getUnreadCount
  );
}

/**
 * React hook for consuming notification loading state.
 */
export function useNotificationsLoading(): boolean {
  return useSyncExternalStore(
    (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    notificationsStore.getIsLoading,
    notificationsStore.getIsLoading
  );
}
