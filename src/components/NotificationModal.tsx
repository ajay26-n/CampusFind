import React from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MaxContentWidth } from '@/constants/theme';
import {
  notificationsStore,
  useNotifications,
  useNotificationsLoading,
  useUnreadNotificationCount,
} from '@/services/notificationsService';
import { NotificationItem, NotificationType } from '@/types/notification';

interface NotificationModalProps {
  visible: boolean;
  onClose: () => void;
  onSelectNotification: (itemId: string) => void;
}

function getNotificationIcon(type: NotificationType): string {
  switch (type) {
    case 'item_found':
      return '🎉';
    case 'claim_approved':
      return '✅';
    case 'claim_rejected':
      return '❌';
    case 'item_resolved':
      return '🎁';
    case 'claim_submitted':
      return '📝';
    default:
      return '🔔';
  }
}

function formatNotificationTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch {
    return 'Recent';
  }
}

export function NotificationModal({
  visible,
  onClose,
  onSelectNotification,
}: NotificationModalProps) {
  const notifications = useNotifications();
  const unreadCount = useUnreadNotificationCount();
  const isLoading = useNotificationsLoading();

  const handlePressItem = async (notification: NotificationItem) => {
    if (!notification.isRead) {
      notificationsStore.markAsRead(notification.id);
    }
    onClose();
    onSelectNotification(notification.itemId);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <SafeAreaView style={styles.modalSafeContainer} edges={['top', 'bottom']}>
          <View style={styles.modalCard}>
            {/* Header */}
            <View style={styles.modalHeader}>
              <View style={styles.headerTitleRow}>
                <Text style={styles.headerTitle}>Notifications</Text>
                {unreadCount > 0 && (
                  <View style={styles.unreadBadgePill}>
                    <Text style={styles.unreadBadgeText}>
                      {unreadCount} {unreadCount === 1 ? 'new' : 'new'}
                    </Text>
                  </View>
                )}
              </View>

              <Pressable
                onPress={onClose}
                style={({ pressed }) => [styles.closeBtn, { opacity: pressed ? 0.7 : 1 }]}
                hitSlop={12}
                accessibilityLabel="Close notifications"
              >
                <Text style={styles.closeBtnText}>✕</Text>
              </Pressable>
            </View>

            {/* List Content */}
            <ScrollView
              style={styles.scrollList}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
            >
              {isLoading && notifications.length === 0 ? (
                <View style={styles.centerBox}>
                  <ActivityIndicator size="small" color="#38BDF8" />
                  <Text style={styles.centerText}>Loading activity...</Text>
                </View>
              ) : notifications.length === 0 ? (
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyIcon}>🔕</Text>
                  <Text style={styles.emptyTitle}>No Notifications Yet</Text>
                  <Text style={styles.emptySub}>
                    Updates regarding your submitted claims, admin verifications, and returned items will appear here.
                  </Text>
                </View>
              ) : (
                notifications.map((item) => {
                  const icon = getNotificationIcon(item.type);
                  const timeDisplay = formatNotificationTime(item.createdAt);

                  return (
                    <Pressable
                      key={item.id}
                      style={({ pressed }) => [
                        styles.notificationCard,
                        !item.isRead && styles.unreadCard,
                        { opacity: pressed ? 0.85 : 1 },
                      ]}
                      onPress={() => handlePressItem(item)}
                    >
                      <View style={styles.cardHeaderRow}>
                        <View style={styles.iconAndTitle}>
                          <Text style={styles.typeIcon}>{icon}</Text>
                          <Text style={[styles.cardTitle, !item.isRead && styles.unreadTitle]}>
                            {item.title}
                          </Text>
                        </View>
                        <View style={styles.metaRow}>
                          <Text style={styles.timeText}>{timeDisplay}</Text>
                          {!item.isRead && <View style={styles.unreadDot} />}
                        </View>
                      </View>

                      <Text style={styles.cardMessage}>{item.message}</Text>

                      <View style={styles.cardFooter}>
                        <Text style={styles.actionPrompt}>View Item Details →</Text>
                      </View>
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(3, 7, 18, 0.75)',
    justifyContent: 'flex-end',
  },
  modalSafeContainer: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  modalCard: {
    width: '100%',
    maxWidth: MaxContentWidth,
    height: Platform.OS === 'web' ? '85%' : '88%',
    backgroundColor: '#0F172A',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: '#1E293B',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
    backgroundColor: '#131B2E',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#F8FAFC',
    letterSpacing: -0.3,
  },
  unreadBadgePill: {
    backgroundColor: '#0284C7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  unreadBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    color: '#94A3B8',
    fontSize: 15,
    fontWeight: '600',
  },
  scrollList: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    gap: 12,
  },
  centerBox: {
    paddingVertical: 50,
    alignItems: 'center',
    gap: 12,
  },
  centerText: {
    color: '#64748B',
    fontSize: 14,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 24,
  },
  emptyIcon: {
    fontSize: 44,
    marginBottom: 12,
  },
  emptyTitle: {
    color: '#F1F5F9',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  emptySub: {
    color: '#64748B',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  notificationCard: {
    backgroundColor: '#131B2E',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  unreadCard: {
    borderColor: '#0284C7',
    backgroundColor: 'rgba(14, 165, 233, 0.08)',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  iconAndTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  typeIcon: {
    fontSize: 18,
  },
  cardTitle: {
    color: '#E2E8F0',
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
  },
  unreadTitle: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  timeText: {
    color: '#64748B',
    fontSize: 12,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#38BDF8',
  },
  cardMessage: {
    color: '#94A3B8',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 10,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.05)',
    paddingTop: 8,
  },
  actionPrompt: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '600',
  },
});
