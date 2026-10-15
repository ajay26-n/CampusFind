import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';

interface ReportModalProps {
  visible: boolean;
  type: 'lost' | 'found';
  onClose: () => void;
}

const CATEGORIES = ['Electronics', 'Cards & IDs', 'Keys', 'Books & Notes', 'Bottles', 'Other'];

export function ReportModal({ visible, type, onClose }: ReportModalProps) {
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState('Electronics');
  const [isPickingPhoto, setIsPickingPhoto] = useState(false);
  const isLost = type === 'lost';

  const pickPhotoFromGallery = async () => {
    if (isPickingPhoto) return;
    setIsPickingPhoto(true);

    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          'Permission Required',
          'Access to your device photo gallery is needed to select a photo.',
          [{ text: 'OK' }]
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        setSelectedPhoto(result.assets[0].uri);
      }
    } catch {
      Alert.alert('Error', 'Unable to open gallery. Please try again.');
    } finally {
      setIsPickingPhoto(false);
    }
  };

  const handleSubmit = () => {
    Alert.alert(
      'Form Preview Recorded',
      `This is a preview of the ${isLost ? 'Report Lost' : 'Report Found'} form design with photo attachment.\n\nFull database submission will be connected in Module 2!`,
      [{ text: 'OK', onPress: onClose }]
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>
                {isLost ? 'Report Lost Item' : 'Report Found Item'}
              </Text>
              <Text style={styles.subtitle}>Module 2 Form Design Preview</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} style={styles.closeButton}>
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
            {/* Category Selector */}
            <Text style={styles.label}>CATEGORY</Text>
            <View style={styles.chipRow}>
              {CATEGORIES.map((cat) => {
                const active = selectedCategory === cat;
                return (
                  <Pressable
                    key={cat}
                    onPress={() => setSelectedCategory(cat)}
                    style={[styles.chip, active && styles.activeChip]}
                  >
                    <Text style={[styles.chipText, active && styles.activeChipText]}>{cat}</Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Title Mock Input */}
            <Text style={styles.label}>ITEM NAME</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Navy Blue Hydro Flask"
              placeholderTextColor="#64748B"
              editable={true}
            />

            {/* Location Mock Input */}
            <Text style={styles.label}>CAMPUS LOCATION</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Central Library 2nd Floor"
              placeholderTextColor="#64748B"
              editable={true}
            />

            {/* Image Selection & Preview */}
            <Text style={styles.label}>PHOTO ATTACHMENT (OPTIONAL)</Text>
            {selectedPhoto ? (
              <View style={styles.previewContainer}>
                <Image source={{ uri: selectedPhoto }} style={styles.previewImage} resizeMode="cover" />
                <View style={styles.previewActions}>
                  <Pressable
                    style={styles.changePhotoButton}
                    onPress={pickPhotoFromGallery}
                    disabled={isPickingPhoto}
                  >
                    <Text style={styles.changePhotoText}>
                      {isPickingPhoto ? 'Opening...' : '🔄 Change Photo'}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={styles.removePhotoButton}
                    onPress={() => setSelectedPhoto(null)}
                  >
                    <Text style={styles.removePhotoText}>✕ Remove</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <Pressable
                style={[styles.uploadPlaceholder, isPickingPhoto && { opacity: 0.6 }]}
                onPress={pickPhotoFromGallery}
                disabled={isPickingPhoto}
              >
                {isPickingPhoto ? (
                  <ActivityIndicator size="small" color="#38BDF8" style={{ marginBottom: 6 }} />
                ) : (
                  <Text style={styles.cameraIcon}>📸</Text>
                )}
                <Text style={styles.uploadTitle}>
                  {isPickingPhoto ? 'Opening Gallery...' : 'Choose Photo from Gallery'}
                </Text>
                <Text style={styles.uploadSubtitle}>
                  Select an image from your phone's photo library
                </Text>
              </Pressable>
            )}

            {/* Submit Button */}
            <Pressable
              style={[styles.submitButton, isLost ? styles.lostButton : styles.foundButton]}
              onPress={handleSubmit}
            >
              <Text style={styles.submitText}>
                {isLost ? 'Submit Lost Report' : 'Submit Found Report'}
              </Text>
            </Pressable>
            <Text style={styles.footerNotice}>
              Database storage and live photo upload will be wired in Module 2.
            </Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: '#0F172A',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 28,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  title: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '800',
  },
  subtitle: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#1E293B',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeText: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '700',
  },
  scroll: {
    paddingBottom: 20,
  },
  label: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginTop: 12,
    marginBottom: 8,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: '#1E293B',
  },
  activeChip: {
    backgroundColor: '#38BDF8',
  },
  chipText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  activeChipText: {
    color: '#0F172A',
    fontWeight: '700',
  },
  input: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#F8FAFC',
    fontSize: 14,
  },
  uploadPlaceholder: {
    borderWidth: 1.5,
    borderColor: '#334155',
    borderStyle: 'dashed',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    backgroundColor: '#131D33',
  },
  cameraIcon: {
    fontSize: 28,
    marginBottom: 6,
  },
  uploadTitle: {
    color: '#E2E8F0',
    fontSize: 14,
    fontWeight: '700',
  },
  uploadSubtitle: {
    color: '#64748B',
    fontSize: 11.5,
    marginVertical: 6,
    textAlign: 'center',
  },
  previewContainer: {
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
    height: 180,
    backgroundColor: '#1E293B',
  },
  previewImage: {
    width: '100%',
    height: 135,
  },
  previewActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 8,
    backgroundColor: '#131B2E',
  },
  changePhotoButton: {
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
    marginTop: 20,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  lostButton: {
    backgroundColor: '#E11D48',
  },
  foundButton: {
    backgroundColor: '#059669',
  },
  submitText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  footerNotice: {
    color: '#64748B',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 10,
  },
});
