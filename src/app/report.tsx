import React, { useState, useEffect } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';

import { CATEGORY_FALLBACK_IMAGES } from '@/constants/categoryImages';
import { useAuth } from '@/context/AuthContext';
import { itemsStore } from '@/data/itemsStore';
import { createItem } from '@/services/itemsService';
import { ItemCategory, ItemType, LostFoundItem } from '@/types/item';

const CATEGORIES: { label: ItemCategory; icon: string }[] = [
  { label: 'Electronics', icon: '💻' },
  { label: 'Cards & IDs', icon: '🪪' },
  { label: 'Keys', icon: '🔑' },
  { label: 'Books & Notes', icon: '📚' },
  { label: 'Bottles & Containers', icon: '🥤' },
  { label: 'Clothing', icon: '👕' },
  { label: 'Accessories', icon: '🎒' },
  { label: 'Other', icon: '📦' },
];

export default function ReportScreen() {
  const { user } = useAuth();
  const params = useLocalSearchParams<{ type?: 'lost' | 'found' }>();
  const initialType: ItemType = params.type === 'found' ? 'found' : 'lost';

  // Form State
  const [reportType, setReportType] = useState<ItemType>(initialType);
  const [title, setTitle] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<ItemCategory>('Electronics');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [dateString, setDateString] = useState('Today, ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [selectedImageBase64, setSelectedImageBase64] = useState<string | null>(null);
  const [selectedImageMimeType, setSelectedImageMimeType] = useState<string | null>(null);
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');

  // Picker & Validation State
  const [isPickingImage, setIsPickingImage] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Auth Guard: Ensure only authenticated and verified users access the report form
  useEffect(() => {
    if (!user) {
      Alert.alert(
        'Student Sign In Required',
        'You must sign in with your @builderscollege.edu.in account to publish a report.',
        [
          {
            text: 'Sign In',
            onPress: () =>
              router.replace({
                pathname: '/auth/login',
                params: { returnUrl: '/report', type: reportType },
              }),
          },
          {
            text: 'Cancel',
            style: 'cancel',
            onPress: () => router.replace('/'),
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
          {
            text: 'Verify Email',
            onPress: () =>
              router.replace({
                pathname: '/auth/verify-email',
                params: { email: user.email ?? '', returnUrl: '/report', type: reportType },
              }),
          },
          {
            text: 'Cancel',
            style: 'cancel',
            onPress: () => router.replace('/'),
          },
        ]
      );
      return;
    }

    // Prepopulate reporter contact details from verified session
    if (user.user_metadata?.full_name && !contactName) {
      setContactName(user.user_metadata.full_name);
    }
    if (user.email && !contactPhone) {
      setContactPhone(user.email);
    }
  }, [user]);

  const pickImageFromGallery = async () => {
    if (isPickingImage) return;
    setIsPickingImage(true);

    try {
      // 1. Request Media Library Permission
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permissionResult.granted) {
        Alert.alert(
          'Permission Required',
          'CampusFind needs permission to access your photo gallery to attach an item photo. You can grant photo permission in your device Settings.',
          [{ text: 'OK' }]
        );
        return;
      }

      // 2. Launch Device Image Library with base64 enabled
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.8,
        base64: true,
      });

      // 3. Gracefully handle user cancellation
      if (result.canceled) {
        return;
      }

      // 4. Update selected image state with picked asset URI and base64 payload
      if (result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        if (asset.uri) {
          setSelectedImage(asset.uri);
          setSelectedImageBase64(asset.base64 ?? null);
          setSelectedImageMimeType(asset.mimeType ?? null);
        }
      }
    } catch (error) {
      Alert.alert(
        'Gallery Selection Error',
        'Unable to access the photo gallery. Please check permissions and try again.',
        [{ text: 'OK' }]
      );
    } finally {
      setIsPickingImage(false);
    }
  };

  const isLost = reportType === 'lost';
  const categoryFallbackImage = CATEGORY_FALLBACK_IMAGES[selectedCategory] || CATEGORY_FALLBACK_IMAGES.Other;

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!title.trim()) {
      newErrors.title = 'Item name is required';
    }
    if (!location.trim()) {
      newErrors.location = 'Campus location is required';
    }
    if (!description.trim()) {
      newErrors.description = 'Please provide a brief description';
    }
    if (!dateString.trim()) {
      newErrors.date = 'Date is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!user) {
      Alert.alert('Sign In Required', 'You must sign in with your college account to submit a report.');
      router.replace({ pathname: '/auth/login', params: { returnUrl: '/report', type: reportType } });
      return;
    }

    if (!user.email_confirmed_at) {
      Alert.alert('Email Verification Required', 'Please verify your Builders College email before submitting.');
      router.replace({
        pathname: '/auth/verify-email',
        params: { email: user.email ?? '', returnUrl: '/report', type: reportType },
      });
      return;
    }

    if (!validateForm()) {
      Alert.alert(
        'Missing Information',
        'Please complete all required fields (Item Name, Category, Location, Description).',
        [{ text: 'OK' }]
      );
      return;
    }

    setIsSubmitting(true);

    try {
      // Upload image to Supabase Storage (if selected) and save report to Supabase PostgreSQL items table
      const { item, error } = await createItem({
        title: title.trim(),
        description: description.trim(),
        type: reportType,
        category: selectedCategory,
        location: location.trim(),
        date: dateString.trim(),
        imageUrl: selectedImage,
        imageBase64: selectedImageBase64,
        imageMimeType: selectedImageMimeType,
        contactName:
          contactName.trim() || user.user_metadata?.full_name || (isLost ? 'Student Owner' : 'Finder / Campus Desk'),
        contactPhone: contactPhone.trim() || user.email || '+1 (555) 019-2000',
      });

      if (error || !item) {
        Alert.alert(
          'Submission Error',
          `Could not publish your report: ${error || 'Unknown error'}. Please try again.`,
          [{ text: 'OK' }]
        );
        return;
      }

      // Add verified database item to the reactive store
      itemsStore.addItem(item);

      const imageNotice = item.imagePath
        ? '\n\n📷 Photo uploaded and stored securely in campus cloud storage.'
        : '';

      // Confirmation dialog and return to Home
      Alert.alert(
        '🎉 Report Published!',
        `"${item.title}" has been saved to the database under ${isLost ? 'LOST' : 'FOUND'} items.${imageNotice}`,
        [
          {
            text: 'View on Home',
            onPress: () => router.replace('/'),
          },
        ]
      );
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to submit report to database.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {/* Top Header */}
      <View style={styles.topBar}>
        <Pressable
          style={({ pressed }) => [styles.backButton, { opacity: pressed ? 0.7 : 1 }]}
          onPress={() => router.back()}
          hitSlop={12}
        >
          <Text style={styles.backArrow}>←</Text>
          <Text style={styles.backText}>Cancel</Text>
        </Pressable>

        <Text style={styles.topBarTitle}>
          {isLost ? 'Report Lost Item' : 'Report Found Item'}
        </Text>

        <View style={{ width: 50 }} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* 1. Report Type Switcher Pill */}
          <View style={styles.typeSwitcher}>
            <Pressable
              style={[
                styles.typeOption,
                isLost && styles.lostActiveOption,
              ]}
              onPress={() => setReportType('lost')}
            >
              <Text style={[styles.typeText, isLost && styles.lostActiveText]}>
                📢 Report Lost
              </Text>
            </Pressable>

            <Pressable
              style={[
                styles.typeOption,
                !isLost && styles.foundActiveOption,
              ]}
              onPress={() => setReportType('found')}
            >
              <Text style={[styles.typeText, !isLost && styles.foundActiveText]}>
                🎁 Report Found
              </Text>
            </Pressable>
          </View>

          {/* Type Header Note */}
          <View
            style={[
              styles.infoBanner,
              isLost ? styles.lostBanner : styles.foundBanner,
            ]}
          >
            <Text style={styles.infoBannerIcon}>{isLost ? '🔍' : '🤝'}</Text>
            <Text
              style={[
                styles.infoBannerText,
                isLost ? styles.lostBannerText : styles.foundBannerText,
              ]}
            >
              {isLost
                ? 'Report an item you lost on campus so fellow students can help you find it.'
                : 'Report an item you found so the rightful owner can identify and claim it.'}
            </Text>
          </View>

          {/* 2. Item Name */}
          <View style={styles.fieldBlock}>
            <View style={styles.labelRow}>
              <Text style={styles.label}>ITEM NAME</Text>
              <Text style={styles.requiredMark}>*Required</Text>
            </View>
            <TextInput
              style={[styles.input, errors.title && styles.inputError]}
              placeholder="e.g. Casio FX-991EX Calculator"
              placeholderTextColor="#64748B"
              value={title}
              onChangeText={(text) => {
                setTitle(text);
                if (errors.title) setErrors((prev) => ({ ...prev, title: '' }));
              }}
            />
            {errors.title ? <Text style={styles.errorText}>{errors.title}</Text> : null}
          </View>

          {/* 3. Category Selector */}
          <View style={styles.fieldBlock}>
            <View style={styles.labelRow}>
              <Text style={styles.label}>CATEGORY</Text>
              <Text style={styles.requiredMark}>*Required</Text>
            </View>
            <View style={styles.categoryGrid}>
              {CATEGORIES.map((cat) => {
                const isSelected = selectedCategory === cat.label;
                return (
                  <Pressable
                    key={cat.label}
                    onPress={() => setSelectedCategory(cat.label)}
                    style={[
                      styles.categoryChip,
                      isSelected && styles.categoryChipSelected,
                    ]}
                  >
                    <Text style={styles.categoryChipIcon}>{cat.icon}</Text>
                    <Text
                      style={[
                        styles.categoryChipText,
                        isSelected && styles.categoryChipTextSelected,
                      ]}
                      numberOfLines={1}
                    >
                      {cat.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* 4. Location */}
          <View style={styles.fieldBlock}>
            <View style={styles.labelRow}>
              <Text style={styles.label}>CAMPUS LOCATION</Text>
              <Text style={styles.requiredMark}>*Required</Text>
            </View>
            <TextInput
              style={[styles.input, errors.location && styles.inputError]}
              placeholder="e.g. Library 2nd Floor, Quiet Study Area"
              placeholderTextColor="#64748B"
              value={location}
              onChangeText={(text) => {
                setLocation(text);
                if (errors.location) setErrors((prev) => ({ ...prev, location: '' }));
              }}
            />
            {errors.location ? <Text style={styles.errorText}>{errors.location}</Text> : null}
          </View>

          {/* 5. Date Lost / Found */}
          <View style={styles.fieldBlock}>
            <View style={styles.labelRow}>
              <Text style={styles.label}>DATE & TIME</Text>
              <Text style={styles.requiredMark}>*Required</Text>
            </View>
            {/* Quick preset chips */}
            <View style={styles.datePresets}>
              {['Today', 'Yesterday', '2 days ago'].map((preset) => (
                <Pressable
                  key={preset}
                  style={styles.datePresetChip}
                  onPress={() =>
                    setDateString(
                      `${preset}, ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                    )
                  }
                >
                  <Text style={styles.datePresetText}>{preset}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              style={[styles.input, errors.date && styles.inputError]}
              placeholder="e.g. Today, 2:30 PM"
              placeholderTextColor="#64748B"
              value={dateString}
              onChangeText={(text) => {
                setDateString(text);
                if (errors.date) setErrors((prev) => ({ ...prev, date: '' }));
              }}
            />
            {errors.date ? <Text style={styles.errorText}>{errors.date}</Text> : null}
          </View>

          {/* 6. Description */}
          <View style={styles.fieldBlock}>
            <View style={styles.labelRow}>
              <Text style={styles.label}>DESCRIPTION & IDENTIFYING MARKS</Text>
              <Text style={styles.requiredMark}>*Required</Text>
            </View>
            <TextInput
              style={[styles.input, styles.textArea, errors.description && styles.inputError]}
              placeholder="Include unique stickers, scratches, colors, case type, or specific distinguishing details..."
              placeholderTextColor="#64748B"
              value={description}
              onChangeText={(text) => {
                setDescription(text);
                if (errors.description) setErrors((prev) => ({ ...prev, description: '' }));
              }}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
            {errors.description ? (
              <Text style={styles.errorText}>{errors.description}</Text>
            ) : null}
          </View>

          {/* 7. Image Selection & Live Preview (Rules 3, 4, 5, 7) */}
          <View style={styles.fieldBlock}>
            <View style={styles.labelRow}>
              <Text style={styles.label}>ITEM PHOTO (OPTIONAL)</Text>
              <Text style={styles.optionalMark}>Optional</Text>
            </View>

            {selectedImage ? (
              // Selected Image Preview
              <View style={styles.imagePreviewBox}>
                <Image
                  source={{ uri: selectedImage }}
                  style={styles.previewImage}
                  resizeMode="cover"
                />
                <View style={styles.previewBadgeOverlay}>
                  <Text style={styles.previewBadgeText}>📷 Actual Item Photo</Text>
                </View>
                <View style={styles.previewActions}>
                  <Pressable
                    style={[styles.changePhotoButton, isPickingImage && { opacity: 0.6 }]}
                    onPress={pickImageFromGallery}
                    disabled={isPickingImage}
                  >
                    {isPickingImage ? (
                      <ActivityIndicator size="small" color="#38BDF8" style={{ marginRight: 4 }} />
                    ) : null}
                    <Text style={styles.changePhotoText}>
                      {isPickingImage ? 'Opening...' : '🔄 Change Photo'}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={styles.removePhotoButton}
                    onPress={() => {
                      setSelectedImage(null);
                      setSelectedImageBase64(null);
                      setSelectedImageMimeType(null);
                    }}
                    disabled={isPickingImage}
                  >
                    <Text style={styles.removePhotoText}>✕ Remove</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              // No image selected: Trigger button to pick real photo + Category Fallback illustration
              <View>
                <Pressable
                  style={[styles.uploadBox, isPickingImage && { opacity: 0.6 }]}
                  onPress={pickImageFromGallery}
                  disabled={isPickingImage}
                >
                  {isPickingImage ? (
                    <ActivityIndicator size="large" color="#38BDF8" style={{ marginBottom: 6 }} />
                  ) : (
                    <Text style={styles.uploadIcon}>🖼️</Text>
                  )}
                  <Text style={styles.uploadTitle}>
                    {isPickingImage ? 'Opening Device Gallery...' : 'Choose Photo from Phone Gallery'}
                  </Text>
                  <Text style={styles.uploadSub}>
                    Tap to open your phone gallery and select an item picture
                  </Text>
                </Pressable>

                {/* Predefined Fallback Preview Card (Rule 5 & Requirement 7) */}
                <View style={styles.fallbackNoticeBox}>
                  <Image
                    source={{ uri: categoryFallbackImage }}
                    style={styles.fallbackThumb}
                    resizeMode="cover"
                  />
                  <View style={styles.fallbackInfo}>
                    <Text style={styles.fallbackTitle}>
                      🎨 Predefined {selectedCategory} Fallback (Illustrative)
                    </Text>
                    <Text style={styles.fallbackSub}>
                      No photo attached. This generic category illustration will be used with an illustrative label.
                    </Text>
                  </View>
                </View>
              </View>
            )}
          </View>

          {/* 8. Reporter Contact Info (Optional) */}
          <View style={styles.fieldBlock}>
            <View style={styles.labelRow}>
              <Text style={styles.label}>YOUR CONTACT INFO (OPTIONAL)</Text>
              <Text style={styles.optionalMark}>Optional</Text>
            </View>
            <TextInput
              style={[styles.input, { marginBottom: 10 }]}
              placeholder="Your Name (e.g. Alex Rivera)"
              placeholderTextColor="#64748B"
              value={contactName}
              onChangeText={setContactName}
            />
            <TextInput
              style={styles.input}
              placeholder="Phone or Student Email"
              placeholderTextColor="#64748B"
              value={contactPhone}
              onChangeText={setContactPhone}
              keyboardType="email-address"
            />
          </View>

          {/* Submit Button */}
          <Pressable
            style={({ pressed }) => [
              styles.submitButton,
              isLost ? styles.lostSubmitButton : styles.foundSubmitButton,
              isSubmitting && { opacity: 0.6 },
              { opacity: pressed && !isSubmitting ? 0.9 : isSubmitting ? 0.6 : 1 },
            ]}
            onPress={handleSubmit}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={styles.submitButtonText}>
                {isLost ? '📢 Publish Lost Item Report' : '🎁 Publish Found Item Report'}
              </Text>
            )}
          </Pressable>

          <Text style={styles.disclaimerText}>
            Reports are permanently saved to the Supabase database. Only verified @builderscollege.edu.in students can submit reports.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0B0F17',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
  },
  backArrow: {
    color: '#38BDF8',
    fontSize: 20,
    fontWeight: '700',
  },
  backText: {
    color: '#38BDF8',
    fontSize: 14.5,
    fontWeight: '600',
  },
  topBarTitle: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700',
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 40,
  },
  typeSwitcher: {
    flexDirection: 'row',
    backgroundColor: '#131B2E',
    borderRadius: 14,
    padding: 4,
    borderWidth: 1,
    borderColor: '#1E293B',
    marginBottom: 14,
  },
  typeOption: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 10,
  },
  lostActiveOption: {
    backgroundColor: '#E11D48',
  },
  foundActiveOption: {
    backgroundColor: '#059669',
  },
  typeText: {
    color: '#94A3B8',
    fontSize: 13.5,
    fontWeight: '600',
  },
  lostActiveText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  foundActiveText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 18,
  },
  lostBanner: {
    backgroundColor: 'rgba(225, 29, 72, 0.1)',
    borderColor: 'rgba(225, 29, 72, 0.3)',
  },
  foundBanner: {
    backgroundColor: 'rgba(5, 150, 105, 0.1)',
    borderColor: 'rgba(5, 150, 105, 0.3)',
  },
  infoBannerIcon: {
    fontSize: 18,
  },
  infoBannerText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
  lostBannerText: {
    color: '#FDA4AF',
  },
  foundBannerText: {
    color: '#A7F3D0',
  },
  fieldBlock: {
    marginBottom: 18,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 8,
  },
  label: {
    color: '#94A3B8',
    fontSize: 11.5,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  requiredMark: {
    color: '#F43F5E',
    fontSize: 11,
    fontWeight: '600',
  },
  optionalMark: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '500',
  },
  input: {
    backgroundColor: '#131B2E',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#F8FAFC',
    fontSize: 14,
  },
  textArea: {
    height: 90,
  },
  inputError: {
    borderColor: '#E11D48',
  },
  errorText: {
    color: '#FB7185',
    fontSize: 11.5,
    marginTop: 4,
    fontWeight: '500',
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#131B2E',
    borderWidth: 1,
    borderColor: '#1E293B',
    width: '48.5%',
  },
  categoryChipSelected: {
    backgroundColor: '#1E293B',
    borderColor: '#38BDF8',
  },
  categoryChipIcon: {
    fontSize: 14,
  },
  categoryChipText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  categoryChipTextSelected: {
    color: '#38BDF8',
    fontWeight: '700',
  },
  datePresets: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  datePresetChip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: '#1A233A',
    borderWidth: 1,
    borderColor: '#334155',
  },
  datePresetText: {
    color: '#94A3B8',
    fontSize: 11.5,
    fontWeight: '600',
  },
  uploadBox: {
    borderWidth: 1.5,
    borderColor: '#334155',
    borderStyle: 'dashed',
    borderRadius: 14,
    padding: 18,
    alignItems: 'center',
    backgroundColor: '#131D33',
  },
  uploadIcon: {
    fontSize: 28,
    marginBottom: 4,
  },
  uploadTitle: {
    color: '#38BDF8',
    fontSize: 14,
    fontWeight: '700',
  },
  uploadSub: {
    color: '#64748B',
    fontSize: 11.5,
    marginTop: 2,
  },
  fallbackNoticeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#131B2E',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
    padding: 10,
    marginTop: 10,
  },
  fallbackThumb: {
    width: 48,
    height: 48,
    borderRadius: 8,
  },
  fallbackInfo: {
    flex: 1,
  },
  fallbackTitle: {
    color: '#FDE047',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 2,
  },
  fallbackSub: {
    color: '#94A3B8',
    fontSize: 11,
    lineHeight: 15,
  },
  imagePreviewBox: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1E293B',
    backgroundColor: '#131B2E',
    overflow: 'hidden',
  },
  previewImage: {
    width: '100%',
    height: 180,
  },
  previewBadgeOverlay: {
    position: 'absolute',
    top: 10,
    left: 10,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#38BDF8',
  },
  previewBadgeText: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '700',
  },
  previewActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 10,
    backgroundColor: '#131B2E',
  },
  changePhotoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#1E293B',
  },
  changePhotoText: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '600',
  },
  removePhotoButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(225, 29, 72, 0.15)',
  },
  removePhotoText: {
    color: '#FB7185',
    fontSize: 12,
    fontWeight: '600',
  },
  submitButton: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  lostSubmitButton: {
    backgroundColor: '#E11D48',
  },
  foundSubmitButton: {
    backgroundColor: '#059669',
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: 15.5,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  disclaimerText: {
    color: '#64748B',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 16,
  },
});
