import React, { useState } from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { CATEGORY_FALLBACK_IMAGES, resolveItemImage } from '@/constants/categoryImages';
import { LostFoundItem } from '@/types/item';

interface ItemCardProps {
  item: LostFoundItem;
  onPress: (item: LostFoundItem) => void;
}

// Clean typographic abbreviations for categories - zero emojis
const CATEGORY_LABELS: Record<string, string> = {
  'Electronics': 'TECH',
  'Cards & IDs': 'ID CARD',
  'Keys': 'KEYS',
  'Books & Notes': 'STUDY',
  'Accessories': 'ACCESSORY',
  'Bottles & Containers': 'BOTTLE',
  'Clothing': 'APPAREL',
  'Other': 'GENERAL',
};

export function ItemCard({ item, onPress }: ItemCardProps) {
  const [imageError, setImageError] = useState(false);
  const [fallbackError, setFallbackError] = useState(false);
  const isLost = item.type === 'lost';
  const categoryTag = CATEGORY_LABELS[item.category] || 'ITEM';

  // Resolves primary image source (user-uploaded vs predefined category fallback)
  const { uri: primaryUri, isIllustrative: primaryIsIllustrative } = resolveItemImage(item);
  const categoryFallbackUri =
    CATEGORY_FALLBACK_IMAGES[item.category] || CATEGORY_FALLBACK_IMAGES.Other;

  // When a real image fails to load, gracefully fall back to the category illustration
  const activeUri = !imageError && primaryUri ? primaryUri : categoryFallbackUri;
  const isIllustrative = primaryIsIllustrative || imageError;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        {
          opacity: pressed ? 0.9 : 1,
          transform: [{ scale: pressed ? 0.985 : 1 }],
        },
      ]}
      onPress={() => onPress(item)}
      android_ripple={{ color: 'rgba(59, 130, 246, 0.12)' }}
    >
      {/* Thumbnail Area with Floating Badges */}
      <View style={styles.imageWrapper}>
        {activeUri && (!imageError || !fallbackError) ? (
          <Image
            source={{ uri: activeUri }}
            style={styles.image}
            resizeMode="cover"
            onError={() => {
              if (!imageError && primaryUri) {
                setImageError(true);
              } else {
                setFallbackError(true);
              }
            }}
          />
        ) : (
          <View style={styles.placeholderContainer}>
            <View style={styles.placeholderIconRing}>
              <View style={styles.placeholderInnerDot} />
            </View>
            <Text style={styles.placeholderCategoryText}>{item.category || 'Item'}</Text>
          </View>
        )}

        {/* Status Badge (LOST / FOUND / HANDOVER) */}
        <View
          style={[
            styles.statusBadge,
            item.status === 'in_custody'
              ? styles.custodyBadge
              : isLost
              ? styles.lostBadge
              : styles.foundBadge,
          ]}
        >
          <View
            style={[
              styles.statusDot,
              item.status === 'in_custody'
                ? styles.custodyDot
                : isLost
                ? styles.lostDot
                : styles.foundDot,
            ]}
          />
          <Text
            style={[
              styles.statusBadgeText,
              item.status === 'in_custody'
                ? styles.custodyBadgeText
                : isLost
                ? styles.lostBadgeText
                : styles.foundBadgeText,
            ]}
          >
            {item.status === 'in_custody' ? 'HANDOVER' : isLost ? 'LOST' : 'FOUND'}
          </Text>
        </View>

        {/* Category Pill Tag (Zero emojis) */}
        <View style={styles.categoryTag}>
          <Text style={styles.categoryTagLabel} numberOfLines={1}>
            {categoryTag}
          </Text>
        </View>

        {/* Image Type Badge (Illustrative vs Photo - Zero emojis) */}
        {isIllustrative ? (
          <View style={styles.illustrativePill}>
            <View style={styles.illustrativeDot} />
            <Text style={styles.illustrativeText}>Illustration</Text>
          </View>
        ) : (
          <View style={styles.photoPill}>
            <View style={styles.photoDot} />
            <Text style={styles.photoText}>Photo</Text>
          </View>
        )}
      </View>

      {/* Card Info */}
      <View style={styles.infoContainer}>
        <Text style={styles.title} numberOfLines={1}>
          {item.title}
        </Text>
        <View style={styles.locationRow}>
          {/* Subtle outline pin icon mark */}
          <View style={styles.locationPinDot} />
          <Text style={styles.locationText} numberOfLines={1}>
            {item.location}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '48.2%',
    backgroundColor: '#10192E',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1E293B',
    marginBottom: 12,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 3,
  },
  imageWrapper: {
    width: '100%',
    height: 120,
    backgroundColor: '#0F172A',
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  placeholderContainer: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    gap: 6,
  },
  placeholderIconRing: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#334155',
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderInnerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#64748B',
  },
  placeholderCategoryText: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statusBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 7,
    paddingVertical: 3.5,
    borderRadius: 6,
    borderWidth: 1,
  },
  lostBadge: {
    backgroundColor: 'rgba(239, 68, 68, 0.16)',
    borderColor: 'rgba(239, 68, 68, 0.45)',
  },
  foundBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.16)',
    borderColor: 'rgba(16, 185, 129, 0.45)',
  },
  custodyBadge: {
    backgroundColor: 'rgba(245, 158, 11, 0.16)',
    borderColor: 'rgba(245, 158, 11, 0.45)',
  },
  statusDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  lostDot: {
    backgroundColor: '#EF4444',
  },
  foundDot: {
    backgroundColor: '#10B981',
  },
  custodyDot: {
    backgroundColor: '#F59E0B',
  },
  statusBadgeText: {
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  lostBadgeText: {
    color: '#FCA5A5',
  },
  foundBadgeText: {
    color: '#86EFAC',
  },
  custodyBadgeText: {
    color: '#FCD34D',
  },
  categoryTag: {
    position: 'absolute',
    top: 8,
    right: 8,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 5,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.25)',
  },
  categoryTagLabel: {
    color: '#E2E8F0',
    fontSize: 8.5,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  illustrativePill: {
    position: 'absolute',
    bottom: 6,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4.5,
    backgroundColor: 'rgba(15, 23, 42, 0.90)',
    paddingHorizontal: 6.5,
    paddingVertical: 2.5,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: 'rgba(234, 179, 8, 0.4)',
  },
  illustrativeDot: {
    width: 4.5,
    height: 4.5,
    borderRadius: 2.25,
    backgroundColor: '#FACC15',
  },
  illustrativeText: {
    color: '#FDE047',
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  photoPill: {
    position: 'absolute',
    bottom: 6,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4.5,
    backgroundColor: 'rgba(15, 23, 42, 0.90)',
    paddingHorizontal: 6.5,
    paddingVertical: 2.5,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.4)',
  },
  photoDot: {
    width: 4.5,
    height: 4.5,
    borderRadius: 2.25,
    backgroundColor: '#38BDF8',
  },
  photoText: {
    color: '#7DD3FC',
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  infoContainer: {
    paddingHorizontal: 11,
    paddingVertical: 10,
  },
  title: {
    color: '#F8FAFC',
    fontSize: 13.5,
    fontWeight: '700',
    lineHeight: 18,
    marginBottom: 5,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  locationPinDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#38BDF8',
  },
  locationText: {
    color: '#94A3B8',
    fontSize: 11.5,
    fontWeight: '500',
    flex: 1,
  },
});

