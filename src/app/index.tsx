import React, { useState, useMemo, useEffect } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { ItemCard } from '@/components/ItemCard';
import { NotificationModal } from '@/components/NotificationModal';
import { MaxContentWidth } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { itemsStore, useItems, useItemsIsFallback } from '@/data/itemsStore';
import { isCentralAdmin, isCustodySecured } from '@/services/claimsService';
import {
  notificationsStore,
  useUnreadNotificationCount,
} from '@/services/notificationsService';
import { LostFoundItem } from '@/types/item';

type FilterType = 'all' | 'lost' | 'found' | 'in_custody';

export default function HomeScreen() {
  const { user, signOut } = useAuth();
  const items = useItems();
  const isFallback = useItemsIsFallback();
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilter, setSelectedFilter] = useState<FilterType>('all');
  const [notificationModalVisible, setNotificationModalVisible] = useState(false);
  const unreadNotificationCount = useUnreadNotificationCount();

  const isAdmin = isCentralAdmin(user);

  // Load live reports and notifications from Supabase PostgreSQL on startup
  useEffect(() => {
    itemsStore.refreshFromDatabase();
    if (user) {
      notificationsStore.refreshFromDatabase();
      if (isAdmin) {
        notificationsStore.retryOutboxIfAdmin();
      }
    }
  }, [user, isAdmin]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      itemsStore.refreshFromDatabase(),
      user ? notificationsStore.refreshFromDatabase() : Promise.resolve(),
      isAdmin ? notificationsStore.retryOutboxIfAdmin() : Promise.resolve(),
    ]);
    setRefreshing(false);
  };

  // Filter items based on active tab and search query
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      // 0. Immediately hide resolved items from the student feed
      if (item.status === 'resolved') {
        return false;
      }

      // 1. Status Filter (All / Lost / Found / In Custody for Admin)
      if (selectedFilter === 'in_custody') {
        const inCustody = isCustodySecured(item.id) || item.status === 'in_custody';
        if (!inCustody) return false;
      } else if (selectedFilter !== 'all' && item.type !== selectedFilter) {
        return false;
      }

      // 2. Search Query Filter
      if (searchQuery.trim().length > 0) {
        const query = searchQuery.toLowerCase().trim();
        const matchesTitle = item.title.toLowerCase().includes(query);
        const matchesLocation = item.location.toLowerCase().includes(query);
        const matchesCategory = item.category.toLowerCase().includes(query);

        return matchesTitle || matchesLocation || matchesCategory;
      }

      return true;
    });
  }, [items, searchQuery, selectedFilter]);

  // Counts for filter pills (excluding resolved items from student counts)
  const counts = useMemo(() => {
    const activeItems = items.filter((i) => i.status !== 'resolved');
    const lost = activeItems.filter((i) => i.type === 'lost').length;
    const found = activeItems.filter((i) => i.type === 'found').length;
    const inCustody = activeItems.filter(
      (i) => isCustodySecured(i.id) || i.status === 'in_custody'
    ).length;
    return { all: activeItems.length, lost, found, inCustody };
  }, [items]);

  const handleCardPress = (item: LostFoundItem) => {
    router.push({
      pathname: '/item-details',
      params: { id: item.id },
    });
  };

  const handleReportPress = (type: 'lost' | 'found') => {
    if (!user) {
      Alert.alert(
        'Student Sign In Required',
        'You need to sign in with your official @builderscollege.edu.in account to publish a report.',
        [
          { text: 'Browse as Guest', style: 'cancel' },
          {
            text: 'Sign In',
            onPress: () =>
              router.push({
                pathname: '/auth/login',
                params: { returnUrl: '/report', type },
              }),
          },
        ]
      );
      return;
    }

    if (!user.email_confirmed_at) {
      Alert.alert(
        'Email Verification Required',
        'Please verify your Builders College email before submitting reports.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Verify Email',
            onPress: () =>
              router.push({
                pathname: '/auth/verify-email',
                params: { email: user.email ?? '', returnUrl: '/report', type },
              }),
          },
        ]
      );
      return;
    }

    router.push({
      pathname: '/report',
      params: { type },
    });
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#3B82F6"
            colors={['#3B82F6']}
          />
        }
      >
        <View style={styles.contentContainer}>
          {/* 1. Header with Auth Status & Notification Bell */}
          <View style={styles.header}>
            <View style={styles.brandContainer}>
              <View style={styles.brandIconDot} />
              <Text style={styles.brandTitle}>CampusFind</Text>
            </View>
            {user ? (
              <View style={styles.authRow}>
                {/* Notification Bell Button with Badge */}
                <Pressable
                  style={({ pressed }) => [styles.bellBtn, { opacity: pressed ? 0.75 : 1 }]}
                  onPress={() => setNotificationModalVisible(true)}
                  hitSlop={8}
                  accessibilityLabel="View notifications"
                >
                  {/* Clean outline bell icon */}
                  <View style={styles.bellOutlineIcon}>
                    <View style={styles.bellDome} />
                    <View style={styles.bellRim} />
                    <View style={styles.bellClapper} />
                  </View>
                  {unreadNotificationCount > 0 && (
                    <View style={styles.bellBadge}>
                      <Text style={styles.bellBadgeText}>
                        {unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}
                      </Text>
                    </View>
                  )}
                </Pressable>

                <View style={styles.collegeBadge}>
                  <View style={styles.collegeBadgeDot} />
                  <Text style={styles.collegeBadgeText} numberOfLines={1}>
                    {user.user_metadata?.full_name?.split(' ')[0] || user.email?.split('@')[0] || 'Student'}
                  </Text>
                </View>
                <Pressable
                  style={({ pressed }) => [styles.signOutBtn, { opacity: pressed ? 0.7 : 1 }]}
                  onPress={() => {
                    Alert.alert('Sign Out', 'Do you want to sign out of your college account?', [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Sign Out', style: 'destructive', onPress: () => signOut() },
                    ]);
                  }}
                  hitSlop={8}
                >
                  <Text style={styles.signOutText}>Sign Out</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                style={({ pressed }) => [styles.loginBadge, { opacity: pressed ? 0.8 : 1 }]}
                onPress={() => router.push('/auth/login')}
                hitSlop={8}
              >
                <View style={styles.loginAvatarDot} />
                <Text style={styles.loginBadgeText}>Log In</Text>
              </Pressable>
            )}
          </View>

          {/* 2. Compact Search Bar */}
          <View style={styles.searchBar}>
            <View style={styles.searchIconSymbol}>
              <View style={styles.searchLensRing} />
              <View style={styles.searchLensHandle} />
            </View>
            <TextInput
              style={styles.searchInput}
              placeholder="Search items, categories, or locations..."
              placeholderTextColor="#64748B"
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCapitalize="none"
              returnKeyType="search"
            />
            {searchQuery.length > 0 && (
              <Pressable
                onPress={() => setSearchQuery('')}
                hitSlop={10}
                style={styles.clearButton}
              >
                <Text style={styles.clearButtonText}>✕</Text>
              </Pressable>
            )}
          </View>

          {/* 3. Action Cards: Report Lost & Report Found */}
          <View style={styles.actionRow}>
            {/* Report Lost Card */}
            <Pressable
              style={({ pressed }) => [
                styles.actionCard,
                styles.lostActionCard,
                { opacity: pressed ? 0.9 : 1 },
              ]}
              onPress={() => handleReportPress('lost')}
              android_ripple={{ color: 'rgba(239, 68, 68, 0.12)' }}
            >
              <View style={[styles.actionIconBox, styles.lostIconBox]}>
                <View style={styles.actionCrossbarH} />
                <View style={styles.actionCrossbarV} />
              </View>
              <View style={styles.actionTextBox}>
                <Text style={styles.lostActionTitle}>Report Lost</Text>
                <Text style={styles.lostActionSub}>Missing an item?</Text>
              </View>
            </Pressable>

            {/* Report Found Card */}
            <Pressable
              style={({ pressed }) => [
                styles.actionCard,
                styles.foundActionCard,
                { opacity: pressed ? 0.9 : 1 },
              ]}
              onPress={() => handleReportPress('found')}
              android_ripple={{ color: 'rgba(16, 185, 129, 0.12)' }}
            >
              <View style={[styles.actionIconBox, styles.foundIconBox]}>
                <View style={styles.foundCheckmarkStem} />
                <View style={styles.foundCheckmarkKick} />
              </View>
              <View style={styles.actionTextBox}>
                <Text style={styles.foundActionTitle}>Report Found</Text>
                <Text style={styles.foundActionSub}>Found an item?</Text>
              </View>
            </Pressable>
          </View>

          {/* 4. Filter Pills */}
          <View style={styles.filterRow}>
            {[
              { id: 'all' as const, label: `All (${counts.all})` },
              { id: 'lost' as const, label: `Lost (${counts.lost})` },
              { id: 'found' as const, label: `Found (${counts.found})` },
              ...(isAdmin
                ? [{ id: 'in_custody' as const, label: `Custody (${counts.inCustody})` }]
                : []),
            ].map((filter) => {
              const isActive = selectedFilter === filter.id;
              return (
                <Pressable
                  key={filter.id}
                  onPress={() => setSelectedFilter(filter.id)}
                  style={[
                    styles.filterChip,
                    isActive ? styles.activeFilterChip : styles.inactiveFilterChip,
                  ]}
                  android_ripple={{ color: 'rgba(59, 130, 246, 0.1)' }}
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      isActive ? styles.activeFilterText : styles.inactiveFilterText,
                    ]}
                  >
                    {filter.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* 5. Section Header */}
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              <Text style={styles.sectionTitle}>Recently Reported</Text>
              {isFallback ? (
                <View style={styles.demoBadge}>
                  <View style={styles.demoBadgeDot} />
                  <Text style={styles.demoBadgeText}>Demo Samples</Text>
                </View>
              ) : (
                <View style={styles.liveDbBadge}>
                  <View style={styles.liveDbBadgeDot} />
                  <Text style={styles.liveDbBadgeText}>Live Cloud</Text>
                </View>
              )}
            </View>
            <Text style={styles.sectionCount}>
              {filteredItems.length} {filteredItems.length === 1 ? 'item' : 'items'}
            </Text>
          </View>

          {/* 6. Two-Column Grid */}
          {filteredItems.length > 0 ? (
            <View style={styles.grid}>
              {filteredItems.map((item) => (
                <ItemCard key={item.id} item={item} onPress={handleCardPress} />
              ))}
            </View>
          ) : (
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconRing}>
                <View style={styles.emptyIconLens} />
                <View style={styles.emptyIconStem} />
              </View>
              <Text style={styles.emptyTitle}>No items found</Text>
              <Text style={styles.emptyDescription}>
                {searchQuery
                  ? `No matches for "${searchQuery}". Try a different keyword.`
                  : 'No items reported under this filter.'}
              </Text>
              {searchQuery ? (
                <Pressable
                  style={styles.resetButton}
                  onPress={() => setSearchQuery('')}
                >
                  <Text style={styles.resetButtonText}>Clear Search</Text>
                </Pressable>
              ) : null}
            </View>
          )}
        </View>
      </ScrollView>

      {/* In-App Notification Center Modal */}
      <NotificationModal
        visible={notificationModalVisible}
        onClose={() => setNotificationModalVisible(false)}
        onSelectNotification={(itemId) => {
          router.push({
            pathname: '/item-details',
            params: { id: itemId },
          });
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0A0F1D',
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 40,
    alignItems: 'center',
  },
  contentContainer: {
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
    marginTop: Platform.OS === 'android' ? 4 : 0,
  },
  brandContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  brandIconDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#3B82F6',
  },
  brandTitle: {
    color: '#F8FAFC',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  collegeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#10192E',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1E293B',
    gap: 6,
  },
  collegeBadgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#38BDF8',
  },
  collegeBadgeText: {
    color: '#CBD5E1',
    fontSize: 11.5,
    fontWeight: '600',
    maxWidth: 110,
  },
  authRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bellBtn: {
    position: 'relative',
    backgroundColor: '#10192E',
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellOutlineIcon: {
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellDome: {
    width: 10,
    height: 9,
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
    borderWidth: 1.5,
    borderColor: '#94A3B8',
    borderBottomWidth: 0,
  },
  bellRim: {
    width: 14,
    height: 2,
    borderRadius: 1,
    backgroundColor: '#94A3B8',
  },
  bellClapper: {
    width: 3,
    height: 2,
    borderBottomLeftRadius: 1.5,
    borderBottomRightRadius: 1.5,
    backgroundColor: '#94A3B8',
    marginTop: 1,
  },
  bellBadge: {
    position: 'absolute',
    top: -3,
    right: -3,
    backgroundColor: '#EF4444',
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#0A0F1D',
  },
  bellBadgeText: {
    color: '#FFFFFF',
    fontSize: 8.5,
    fontWeight: '800',
  },
  signOutBtn: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.25)',
  },
  signOutText: {
    color: '#F87171',
    fontSize: 11,
    fontWeight: '700',
  },
  loginBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#10192E',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#2563EB',
    gap: 6,
  },
  loginAvatarDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#3B82F6',
  },
  loginBadgeText: {
    color: '#60A5FA',
    fontSize: 12,
    fontWeight: '700',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#10192E',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
    paddingHorizontal: 12,
    height: 44,
    marginBottom: 14,
  },
  searchIconSymbol: {
    width: 16,
    height: 16,
    marginRight: 9,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchLensRing: {
    width: 11,
    height: 11,
    borderRadius: 5.5,
    borderWidth: 1.8,
    borderColor: '#64748B',
    position: 'absolute',
    top: 0,
    left: 0,
  },
  searchLensHandle: {
    width: 5,
    height: 1.8,
    backgroundColor: '#64748B',
    borderRadius: 1,
    position: 'absolute',
    bottom: 1.5,
    right: 0.5,
    transform: [{ rotate: '45deg' }],
  },
  searchInput: {
    flex: 1,
    color: '#F8FAFC',
    fontSize: 13.5,
    height: '100%',
  },
  clearButton: {
    padding: 4,
  },
  clearButtonText: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '700',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  actionCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  lostActionCard: {
    backgroundColor: '#16131F',
    borderColor: 'rgba(239, 68, 68, 0.28)',
  },
  foundActionCard: {
    backgroundColor: '#0D1C1B',
    borderColor: 'rgba(16, 185, 129, 0.28)',
  },
  actionIconBox: {
    width: 34,
    height: 34,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 9,
    position: 'relative',
  },
  lostIconBox: {
    backgroundColor: 'rgba(239, 68, 68, 0.14)',
  },
  foundIconBox: {
    backgroundColor: 'rgba(16, 185, 129, 0.14)',
  },
  actionCrossbarH: {
    width: 14,
    height: 2.2,
    borderRadius: 1.1,
    backgroundColor: '#F87171',
    position: 'absolute',
  },
  actionCrossbarV: {
    width: 2.2,
    height: 14,
    borderRadius: 1.1,
    backgroundColor: '#F87171',
    position: 'absolute',
  },
  foundCheckmarkStem: {
    width: 2.2,
    height: 10,
    borderRadius: 1.1,
    backgroundColor: '#34D399',
    position: 'absolute',
    transform: [{ rotate: '40deg' }, { translateX: 2 }, { translateY: -1 }],
  },
  foundCheckmarkKick: {
    width: 2.2,
    height: 5.5,
    borderRadius: 1.1,
    backgroundColor: '#34D399',
    position: 'absolute',
    transform: [{ rotate: '-45deg' }, { translateX: -3 }, { translateY: 1 }],
  },
  actionTextBox: {
    flex: 1,
  },
  lostActionTitle: {
    color: '#F87171',
    fontSize: 13.5,
    fontWeight: '700',
  },
  lostActionSub: {
    color: '#FCA5A5',
    fontSize: 10.5,
    marginTop: 1,
  },
  foundActionTitle: {
    color: '#34D399',
    fontSize: 13.5,
    fontWeight: '700',
  },
  foundActionSub: {
    color: '#A7F3D0',
    fontSize: 10.5,
    marginTop: 1,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  filterChip: {
    paddingHorizontal: 13,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  activeFilterChip: {
    backgroundColor: '#1E3A8A',
    borderColor: '#3B82F6',
  },
  inactiveFilterChip: {
    backgroundColor: '#10192E',
    borderColor: '#1E293B',
  },
  filterChipText: {
    fontSize: 12,
  },
  activeFilterText: {
    color: '#93C5FD',
    fontWeight: '700',
  },
  inactiveFilterText: {
    color: '#94A3B8',
    fontWeight: '500',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  demoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4.5,
    backgroundColor: 'rgba(234, 179, 8, 0.12)',
    borderColor: 'rgba(234, 179, 8, 0.35)',
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  demoBadgeDot: {
    width: 4.5,
    height: 4.5,
    borderRadius: 2.25,
    backgroundColor: '#EAB308',
  },
  demoBadgeText: {
    color: '#FDE047',
    fontSize: 9.5,
    fontWeight: '700',
  },
  liveDbBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4.5,
    backgroundColor: 'rgba(37, 99, 235, 0.12)',
    borderColor: 'rgba(59, 130, 246, 0.35)',
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  liveDbBadgeDot: {
    width: 4.5,
    height: 4.5,
    borderRadius: 2.25,
    backgroundColor: '#38BDF8',
  },
  liveDbBadgeText: {
    color: '#93C5FD',
    fontSize: 9.5,
    fontWeight: '700',
  },
  sectionTitle: {
    color: '#F8FAFC',
    fontSize: 15.5,
    fontWeight: '700',
  },
  sectionCount: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '600',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  emptyContainer: {
    backgroundColor: '#10192E',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1E293B',
    padding: 28,
    alignItems: 'center',
    marginTop: 6,
  },
  emptyIconRing: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(30, 41, 59, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#334155',
    position: 'relative',
  },
  emptyIconLens: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#94A3B8',
  },
  emptyIconStem: {
    width: 6,
    height: 2,
    backgroundColor: '#94A3B8',
    borderRadius: 1,
    position: 'absolute',
    bottom: 12,
    right: 12,
    transform: [{ rotate: '45deg' }],
  },
  emptyTitle: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  emptyDescription: {
    color: '#64748B',
    fontSize: 12.5,
    textAlign: 'center',
    lineHeight: 18,
  },
  resetButton: {
    marginTop: 14,
    backgroundColor: '#1E3A8A',
    borderWidth: 1,
    borderColor: '#3B82F6',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 18,
  },
  resetButtonText: {
    color: '#93C5FD',
    fontSize: 12,
    fontWeight: '700',
  },
});

