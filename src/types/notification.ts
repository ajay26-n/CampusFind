/**
 * CampusFind: Module 10 Phase 2 Notification Types
 */

export type NotificationType =
  | 'claim_submitted'
  | 'claim_approved'
  | 'claim_rejected'
  | 'item_resolved'
  | 'item_found';

export interface NotificationItem {
  id: string;
  userId: string;
  itemId: string;
  type: NotificationType;
  title: string;
  message: string;
  isRead: boolean;
  idempotencyKey: string;
  createdAt: string;
}

export interface DatabaseNotificationRow {
  id: string;
  user_id: string;
  item_id: string;
  type: NotificationType;
  title: string;
  message: string;
  is_read: boolean;
  idempotency_key: string;
  created_at: string;
}
