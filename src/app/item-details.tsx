import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';

import { CATEGORY_FALLBACK_IMAGES, resolveItemImage } from '@/constants/categoryImages';
import { useAuth } from '@/context/AuthContext';
import { itemsStore, useItems } from '@/data/itemsStore';
import { MOCK_ITEMS } from '@/data/mockItems';
import { findMatchSuggestions, MatchSuggestion } from '@/services/matchingService';
import {
  Claim,
  CENTRAL_ADMIN_EMAIL,
  createClaimRequest,
  fetchClaimsForItem,
  getClaimantStatus,
  isCentralAdmin,
  isCustodySecured,
  setCustodySecured,
  updateClaimStatus,
} from '@/services/claimsService';
import {
  fetchItemById,
  getSignedImageUrl,
  reportLostItemFound,
  resolveItem,
  updateItemCustody,
} from '@/services/itemsService';
import { notificationsStore } from '@/services/notificationsService';
import { LostFoundItem } from '@/types/item';

const CATEGORY_ICONS: Record<string, string> = {
  'Electronics': '💻',
  'Cards & IDs': '🪪',
  'Keys': '🔑',
  'Books & Notes': '📚',
  'Accessories': '🎒',
  'Bottles & Containers': '🥤',
  'Clothing': '👕',
  'Other': '📦',
};

export default function ItemDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();

  const [imageError, setImageError] = useState(false);
  const [fallbackError, setFallbackError] = useState(false);
  const [fetchedItem, setFetchedItem] = useState<LostFoundItem | null>(null);

  // Claims & Custody states
  const [claims, setClaims] = useState<Claim[]>([]);
  const [custodySecured, setCustodySecuredState] = useState(false);
  const [isSubmittingClaim, setIsSubmittingClaim] = useState(false);
  const [isProcessingAdminAction, setIsProcessingAdminAction] = useState(false);
  const [isResolving, setIsResolving] = useState(false);

  // Claim Request Modal states
  const [claimModalVisible, setClaimModalVisible] = useState(false);
  const [claimantName, setClaimantName] = useState('');
  const [claimantPhone, setClaimantPhone] = useState('');
  const [studentIdNumber, setStudentIdNumber] = useState('');
  const [proofDescription, setProofDescription] = useState('');
  const [modalValidationError, setModalValidationError] = useState<string | null>(null);

  // Found Report Modal states (when a student reports finding a lost item)
  const [foundModalVisible, setFoundModalVisible] = useState(false);
  const [finderName, setFinderName] = useState('');
  const [finderPhone, setFinderPhone] = useState('');
  const [finderNote, setFinderNote] = useState('');
  const [isSubmittingFoundReport, setIsSubmittingFoundReport] = useState(false);
  const [foundModalValidationError, setFoundModalValidationError] = useState<string | null>(null);
  const [hasReportedFound, setHasReportedFound] = useState(false);

  const storeItem = id ? itemsStore.getItemById(id) : undefined;

  useEffect(() => {
    if (id && !storeItem) {
      fetchItemById(id).then((found) => {
        if (found) {
          setFetchedItem(found);
        }
      });
    }
  }, [id, storeItem]);

  const item = storeItem || fetchedItem || MOCK_ITEMS[0];
  const isLost = item.type === 'lost';
  const isResolved = item.status === 'resolved';
  const isInCustody = item.status === 'in_custody';
  const categoryIcon = CATEGORY_ICONS[item.category] || '📦';

  // Role checks
  const isAdmin = isCentralAdmin(user);
  // Rule: The student who created a Report Found item must never be able to claim that same item.
  const isCreator = Boolean(user?.id && item.userId && user.id === item.userId);

  // Load custody and claims state for found items (refreshed on mount and focus)
  const refreshClaims = useCallback(() => {
    if (item?.id) {
      setCustodySecuredState(isCustodySecured(item.id));
      if (!isLost) {
        fetchClaimsForItem(item.id).then((loadedClaims) => {
          setClaims(loadedClaims);
        });
      }
    }
  }, [item?.id, isLost]);

  useEffect(() => {
    refreshClaims();
  }, [refreshClaims]);

  useFocusEffect(
    useCallback(() => {
      refreshClaims();
    }, [refreshClaims])
  );

  // Refresh signed URL if item has an imagePath but image failed or expired
  useEffect(() => {
    if (item.imagePath && (!item.imageUrl || imageError)) {
      getSignedImageUrl(item.imagePath).then((freshUrl) => {
        if (freshUrl && freshUrl !== item.imageUrl) {
          setFetchedItem((prev) => (prev ? { ...prev, imageUrl: freshUrl } : { ...item, imageUrl: freshUrl }));
          setImageError(false);
        }
      });
    }
  }, [item.imagePath, item.imageUrl, imageError]);

  // Resolves primary image source (user-uploaded vs predefined category fallback)
  const { uri: primaryUri, isIllustrative: primaryIsIllustrative } = resolveItemImage(item);
  const categoryFallbackUri =
    CATEGORY_FALLBACK_IMAGES[item.category] || CATEGORY_FALLBACK_IMAGES.Other;

  // When a primary user image fails to load, gracefully fall back to the category illustrative image
  const activeUri = !imageError && primaryUri ? primaryUri : categoryFallbackUri;
  const isIllustrative = primaryIsIllustrative || imageError;

  // Find authenticated claimant's latest claim for this item
  const userClaim = useMemo(() => {
    if (!user) return null;
    return claims.find((c) => c.claimant_id === user.id) || null;
  }, [user, claims]);

  const userHasClaimed = Boolean(userClaim);

  // Suggested matches (Lost <-> Found) using reactive store & database items
  const allItems = useItems();
  const matchSuggestions = useMemo(() => {
    if (!item) return [];
    return findMatchSuggestions(item, allItems, { minScore: 28, maxResults: 4 });
  }, [item, allItems]);

  /**
   * Submits a claim request from the Claim Request Modal with all required fields:
   * itemId, claimantId, claimantName, claimantPhone, studentIdNumber, proofDescription.
   * Validates every required field before submitting.
   * Does not fabricate values or use finder's details.
   * Shows actual database error on failure, and confirms success after Supabase insert.
   */
  const handleSubmitClaimModal = async () => {
    if (!user) return;

    const trimmedName = claimantName.trim();
    const trimmedPhone = claimantPhone.trim();
    const trimmedStudentId = studentIdNumber.trim();
    const trimmedProof = proofDescription.trim();

    if (!trimmedName) {
      setModalValidationError('Full name is required.');
      return;
    }
    if (!trimmedStudentId) {
      setModalValidationError('College / Student ID number is required.');
      return;
    }
    if (!trimmedPhone) {
      setModalValidationError('Contact phone number is required.');
      return;
    }
    if (!trimmedProof) {
      setModalValidationError('Proof of ownership description is required.');
      return;
    }

    setModalValidationError(null);
    setIsSubmittingClaim(true);

    try {
      const { claim, error } = await createClaimRequest({
        itemId: item.id,
        claimantId: user.id,
        claimantName: trimmedName,
        claimantPhone: trimmedPhone,
        studentIdNumber: trimmedStudentId,
        proofDescription: trimmedProof,
        itemCreatorId: item.userId,
        claimantEmail: user.email ?? undefined,
      });

      if (error) {
        setModalValidationError(error);
        Alert.alert('Claim Request Failed', error);
        return;
      }

      if (claim) {
        setClaims((prev) => [claim, ...prev.filter((c) => c.id !== claim.id)]);
        setClaimModalVisible(false);
        notificationsStore.refreshFromDatabase();
        Alert.alert(
          'Claim Request Submitted',
          'Your claim request has been registered in the database with pending status.\n\nPlease visit the Central Security Office with your college ID to verify ownership and collect your item.'
        );
      }
    } catch (err: any) {
      const msg = err?.message || 'Failed to submit claim request. Please try again.';
      setModalValidationError(msg);
      Alert.alert('Error', msg);
    } finally {
      setIsSubmittingClaim(false);
    }
  };

  /**
   * Submits a report from a student who found this lost item.
   * Notifies the lost item owner and Central Admin, and directs the finder
   * to physically hand over the item to the Central Security Office.
   */
  const handleSubmitFoundModal = async () => {
    if (!user) return;

    const trimmedName = finderName.trim();
    const trimmedPhone = finderPhone.trim();
    const trimmedNote = finderNote.trim();

    if (!trimmedName) {
      setFoundModalValidationError('Your full name is required.');
      return;
    }
    if (!trimmedPhone) {
      setFoundModalValidationError('Your contact phone number is required.');
      return;
    }
    if (!trimmedNote) {
      setFoundModalValidationError('Where you found the item or handover details is required.');
      return;
    }

    setFoundModalValidationError(null);
    setIsSubmittingFoundReport(true);

    try {
      const { success, error } = await reportLostItemFound({
        itemId: item.id,
        finderName: trimmedName,
        finderPhone: trimmedPhone,
        finderNote: trimmedNote,
        item,
      });

      if (!success) {
        setFoundModalValidationError(error || 'Failed to submit found report.');
        Alert.alert('Submission Failed', error || 'Could not register found report.');
        return;
      }

      setHasReportedFound(true);
      setFetchedItem((prev) =>
        prev ? { ...prev, status: 'in_custody' } : { ...item, status: 'in_custody' }
      );
      itemsStore.updateItemStatus(item.id, 'in_custody');
      setFoundModalVisible(false);
      notificationsStore.refreshFromDatabase();

      Alert.alert(
        'Found Report Registered! 🎉',
        'Thank you! The student who lost this item and the Central Security Office have both been notified.\n\n🛡️ Next Step: Please physically drop off this item at the Central Security Office desk so security can confirm custody and return it to the verified owner.'
      );
    } catch (err: any) {
      const msg = err?.message || 'Failed to submit found report. Please try again.';
      setFoundModalValidationError(msg);
      Alert.alert('Error', msg);
    } finally {
      setIsSubmittingFoundReport(false);
    }
  };

  /**
   * Central Admin claim & custody management actions.
   */
  const handleAdminClaimActions = () => {
    const custodyLabel = custodySecured
      ? 'SECURED at Central Security Office'
      : 'PENDING physical handover from finder';

    const pendingClaims = claims.filter((c) => c.status === 'pending');

    Alert.alert(
      '🛡️ Central Admin Console',
      `Admin: ${CENTRAL_ADMIN_EMAIL}\nCustody: ${custodyLabel}\nClaims: ${claims.length} total (${pendingClaims.length} pending)\nStatus: ${isResolved ? 'RESOLVED / RETURNED' : 'ACTIVE'}\n\nRequirement: The finder must hand the physical item to the Central Security Office before custody is marked as secured.`,
      [
        { text: 'Close', style: 'cancel' },
        ...(custodySecured && !isResolved
          ? [
              {
                text: '🎁 Mark as Returned / Resolve',
                onPress: promptResolveConfirmation,
              },
            ]
          : []),
        {
          text: custodySecured
            ? '🔄 Revert Custody to Pending'
            : '📥 Mark Custody Secured (Received)',
          onPress: handleToggleCustody,
        },
        ...(pendingClaims.length > 0
          ? [
              {
                text: `Review Pending Claims (${pendingClaims.length})`,
                onPress: () => handleReviewPendingClaims(pendingClaims),
              },
            ]
          : []),
      ]
    );
  };

  /**
   * Prompts Central Admin with a confirmation dialog before resolving the item.
   * Clearly separates isolated local simulation from real Supabase updates.
   */
  const promptResolveConfirmation = () => {
    Alert.alert(
      'Mark as Returned / Resolve Item',
      `Has this item been physically handed over to the verified owner at the Central Security Office?\n\nItem: "${item.title}"\n\nMarking as returned will update its status to RESOLVED in Supabase and archive it from the active student feed. All claims and custody audit history will remain permanently preserved.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: '🧪 Simulate in Test Mode',
          onPress: () => handleResolveItem(true),
        },
        {
          text: '✅ Confirm & Resolve in Supabase',
          onPress: () => handleResolveItem(false),
        },
      ]
    );
  };

  /**
   * Performs the item return workflow.
   * Enforces admin authorization, updates status to 'resolved' in Supabase,
   * hides the item from the feed, and provides clear success / error alerts.
   */
  const handleResolveItem = async (simulateOnly: boolean = false) => {
    if (!isAdmin) {
      Alert.alert('Unauthorized', 'Only the Central Admin can mark items as returned.');
      return;
    }

    setIsResolving(true);
    try {
      const { success, error, isSimulated } = await resolveItem(item.id, {
        simulate: simulateOnly,
      });

      if (!success) {
        Alert.alert(
          'Return Workflow Failed',
          error || 'Failed to update item status in Supabase database.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Simulate in Test Mode',
              onPress: () => handleResolveItem(true),
            },
          ]
        );
        return;
      }

      setFetchedItem((prev) =>
        prev ? { ...prev, status: 'resolved' } : { ...item, status: 'resolved' }
      );
      itemsStore.updateItemStatus(item.id, 'resolved');
      notificationsStore.refreshFromDatabase();

      Alert.alert(
        isSimulated ? 'Return Simulated (Test Mode)' : 'Item Successfully Returned',
        isSimulated
          ? 'The item has been marked as RESOLVED locally in this test session. No changes were made to Supabase.'
          : 'The item status has been updated to RESOLVED in Supabase. It is now archived from the active student feed while preserving all claim and custody records.'
      );
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to resolve item.');
    } finally {
      setIsResolving(false);
    }
  };

  /**
   * Toggles custody status with explicit verification confirmation.
   * Syncs with Supabase if the item is a database record.
   */
  const handleToggleCustody = () => {
    if (!custodySecured) {
      Alert.alert(
        'Confirm Physical Handover',
        'Has the finder physically handed this item over to the Central Security Office before custody is marked as secured?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Confirm & Secure Custody',
            onPress: async () => {
              setCustodySecured(item.id, true);
              setCustodySecuredState(true);
              const { error } = await updateItemCustody(item.id, true);
              if (error) {
                console.warn('[CampusFind Custody] Custody update notice:', error);
              } else {
                setFetchedItem((prev) => (prev ? { ...prev, status: 'in_custody' } : null));
                itemsStore.updateItemStatus(item.id, 'in_custody');
              }
              Alert.alert(
                'Custody Secured',
                'Item physical custody has been confirmed and marked as secured at the Central Security Office.'
              );
            },
          },
        ]
      );
    } else {
      Alert.alert(
        'Revert Custody Status',
        'Revert physical custody status back to pending handover?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Revert to Pending',
            onPress: async () => {
              setCustodySecured(item.id, false);
              setCustodySecuredState(false);
              const { error } = await updateItemCustody(item.id, false);
              if (error) {
                console.warn('[CampusFind Custody] Custody revert notice:', error);
              } else {
                setFetchedItem((prev) => (prev ? { ...prev, status: 'open' } : null));
                itemsStore.updateItemStatus(item.id, 'open');
              }
              Alert.alert('Status Updated', 'Custody marked as pending physical handover.');
            },
          },
        ]
      );
    }
  };

  /**
   * Handles review of pending claims by Central Admin.
   * Displays claimant phone, student ID, and proof description exclusively to admin.
   */
  const handleReviewPendingClaims = (pendingClaims: Claim[]) => {
    const first = pendingClaims[0];
    const claimantDisplay = first.claimant_name
      ? `${first.claimant_name} (${first.claimant_email || first.claimant_id})`
      : first.claimant_email || first.claimant_id || 'Student Claimant';
    Alert.alert(
      'Review Claim Request',
      `Claimant: ${claimantDisplay}\nStudent ID: ${first.student_id_number || 'N/A'}\nPhone: ${first.claimant_phone || 'N/A'}\n\nProof of Ownership:\n"${first.proof_description || 'None provided'}"\n\nItem: ${item.title}\nStatus: PENDING\nSubmitted: ${new Date(first.created_at).toLocaleString()}\n\nVerify student identity at Central Security Office before approving.`,
      [
        { text: 'Dismiss', style: 'cancel' },
        {
          text: '❌ Reject Claim',
          style: 'destructive',
          onPress: () => handleAdminUpdateClaim(first.id, 'rejected'),
        },
        {
          text: '✅ Approve Claim',
          onPress: () => handleAdminUpdateClaim(first.id, 'approved'),
        },
      ]
    );
  };

  /**
   * Updates claim status (approve / reject) by Central Admin in the database.
   */
  const handleAdminUpdateClaim = async (claimId: string, newStatus: 'approved' | 'rejected') => {
    // If approving, check if another claim is already approved for this item
    if (newStatus === 'approved') {
      const otherApproved = claims.find((c) => c.id !== claimId && c.status === 'approved');
      if (otherApproved) {
        Alert.alert(
          'Conflicting Approved Claim',
          `Another claim (${otherApproved.claimant_name || 'Student'}) is already marked approved for this item. Per campus custody policy, a physical item can only be released to one verified owner. Please reject or resolve the previous claim before approving a different one.`,
          [{ text: 'OK' }]
        );
        return;
      }
    }

    setIsProcessingAdminAction(true);
    try {
      const { success, error } = await updateClaimStatus(claimId, item.id, newStatus);
      if (!success) {
        Alert.alert('Database Error', error || 'Failed to update claim in database.');
        return;
      }
      setClaims((prev) =>
        prev.map((c) => (c.id === claimId ? { ...c, status: newStatus } : c))
      );
      notificationsStore.refreshFromDatabase();
      Alert.alert(
        newStatus === 'approved' ? 'Claim Approved' : 'Claim Rejected',
        newStatus === 'approved'
          ? 'The student claim has been approved in the database. The claimant may now claim and retrieve the physical item from the Central Security Office upon showing their college ID.'
          : 'The claim request has been rejected in the database.'
      );
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to update claim status.');
    } finally {
      setIsProcessingAdminAction(false);
    }
  };

  /**
   * Primary action press handler.
   */
  const handleClaimPress = () => {
    if (isLost) {
      // 1. Central Admin flow on Lost Item: open admin management
      if (isAdmin) {
        handleAdminClaimActions();
        return;
      }

      // 2. Report Creator: cannot report finding their own lost item
      if (isCreator) {
        Alert.alert(
          'Your Lost Item Report',
          'You reported losing this item. When a fellow student finds it, they will hand it over to the Central Security Office. You will receive an instant notification here once custody is secured.',
          [{ text: 'OK' }]
        );
        return;
      }

      // 3. User must be signed in to submit a found report
      if (!user) {
        Alert.alert(
          'Student Sign In Required',
          'Please sign in with your official @builderscollege.edu.in account to report finding this item.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Sign In',
              onPress: () =>
                router.push({
                  pathname: '/auth/login',
                  params: { returnUrl: `/item-details?id=${item.id}` },
                }),
            },
          ]
        );
        return;
      }

      if (isInCustody || hasReportedFound) {
        Alert.alert(
          'Handover Pending',
          'This item has already been reported found and is currently awaiting physical handover at the Central Security Office desk.'
        );
        return;
      }

      // Open Found Report Modal for eligible finder
      const prefilledName =
        user.user_metadata?.full_name?.trim() ||
        user.user_metadata?.name?.trim() ||
        '';
      setFinderName(prefilledName);
      setFinderPhone('');
      setFinderNote('');
      setFoundModalValidationError(null);
      setFoundModalVisible(true);
      return;
    }

    // 1. Central Admin flow: provide admin claim-management actions
    if (isAdmin) {
      handleAdminClaimActions();
      return;
    }

    // 2. Report Creator Rule: The student who created a Report Found item must never be able to claim that same item.
    if (isCreator) {
      Alert.alert(
        'Action Not Allowed',
        'You reported finding this item. Per campus policy, report creators cannot submit claims for items they reported found.',
        [{ text: 'OK' }]
      );
      return;
    }

    // 3. Normal Student (or Guest):
    if (!user) {
      Alert.alert(
        'Student Sign In Required',
        'Please sign in with your official @builderscollege.edu.in account to submit a claim for this item.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Sign In',
            onPress: () =>
              router.push({
                pathname: '/auth/login',
                params: { returnUrl: `/item-details?id=${item.id}` },
              }),
          },
        ]
      );
      return;
    }

    if (userClaim) {
      if (userClaim.status === 'approved') {
        Alert.alert(
          'Claim Approved 🎉',
          'Claim Approved — Bring your college ID to the Central Security Office to complete collection.'
        );
        return;
      }
      if (userClaim.status === 'rejected') {
        Alert.alert(
          'Claim Rejected',
          'Claim Rejected — Your ownership proof was not approved. Contact Central Security Office if you need clarification.'
        );
        return;
      }
      Alert.alert(
        'Claim Pending Review',
        'Claim Pending Review — Central Security Office is reviewing your request.\n\nPlease visit the Central Security Office with your college ID.'
      );
      return;
    }

    // Open Claim Request modal for eligible student
    // Prefill claimant name from user profile/metadata and reset form state
    const prefilledName =
      user.user_metadata?.full_name?.trim() ||
      user.user_metadata?.name?.trim() ||
      '';
    setClaimantName(prefilledName);
    setClaimantPhone('');
    setStudentIdNumber('');
    setProofDescription('');
    setModalValidationError(null);
    setClaimModalVisible(true);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {/* Top Navigation Bar */}
      <View style={styles.topBar}>
        <Pressable
          style={({ pressed }) => [styles.backButton, { opacity: pressed ? 0.7 : 1 }]}
          onPress={() => router.back()}
          hitSlop={12}
        >
          <Text style={styles.backArrow}>←</Text>
          <Text style={styles.backText}>Back</Text>
        </Pressable>

        <View
          style={[
            styles.statusBadge,
            isResolved
              ? styles.resolvedBadge
              : isInCustody
              ? styles.pendingClaimButton
              : isLost
              ? styles.lostBadge
              : styles.foundBadge,
          ]}
        >
          <Text style={styles.statusBadgeText}>
            {isResolved
              ? '• RESOLVED / RETURNED'
              : isInCustody
              ? '• HANDOVER PENDING'
              : isLost
              ? '• REPORTED LOST'
              : '• REPORTED FOUND'}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero Image Section */}
        <View style={styles.heroImageWrapper}>
          {activeUri && (!imageError || !fallbackError) ? (
            <Image
              source={{ uri: activeUri }}
              style={styles.heroImage}
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
            <View style={styles.placeholderBox}>
              <Text style={styles.placeholderEmoji}>{categoryIcon}</Text>
            </View>
          )}

          {/* Category Tag Overlay */}
          <View style={styles.categoryBadgeFloat}>
            <Text style={styles.categoryBadgeText}>
              {categoryIcon} {item.category}
            </Text>
          </View>

          {/* Photo Source Tag Overlay */}
          <View
            style={[
              styles.photoStatusBadgeFloat,
              isIllustrative ? styles.illustrativeBadgeFloat : styles.actualBadgeFloat,
            ]}
          >
            <Text
              style={[
                styles.photoStatusTextFloat,
                isIllustrative ? styles.illustrativeTextFloat : styles.actualTextFloat,
              ]}
            >
              {isIllustrative ? '🎨 Illustrative Fallback' : '📷 Actual Item Photo'}
            </Text>
          </View>
        </View>

        {/* Illustrative Warning Banner */}
        {isIllustrative ? (
          <View style={styles.illustrativeNotice}>
            <Text style={styles.illustrativeNoticeIcon}>⚠️</Text>
            <View style={styles.illustrativeNoticeTextContainer}>
              <Text style={styles.illustrativeNoticeTitle}>
                Illustrative Photo (Reference Only)
              </Text>
              <Text style={styles.illustrativeNoticeDesc}>
                {primaryUri && imageError
                  ? 'The uploaded photo could not be loaded. Displaying a general category illustration instead.'
                  : 'The reporter did not upload a photo. This image is a general category illustration, not a photo of the actual item.'}
              </Text>
            </View>
          </View>
        ) : (
          <View style={styles.actualPhotoNotice}>
            <Text style={styles.actualPhotoIcon}>✓</Text>
            <Text style={styles.actualPhotoText}>
              Verified Photo: Uploaded by the person reporting this item.
            </Text>
          </View>
        )}

        {/* Title & Metadata Card */}
        <View style={styles.cardContainer}>
          <View style={styles.titleBadgeRow}>
            <Text style={styles.itemTitle}>{item.title}</Text>
            {item.isDatabaseRecord ? (
              <View style={styles.dbSourceBadge}>
                <Text style={styles.dbSourceBadgeText}>☁️ Supabase Live</Text>
              </View>
            ) : (
              <View style={styles.demoSourceBadge}>
                <Text style={styles.demoSourceBadgeText}>📋 Demo Fallback</Text>
              </View>
            )}
          </View>

          {/* Quick Info Grid */}
          <View style={styles.infoRow}>
            <View style={styles.infoPill}>
              <Text style={styles.infoIcon}>📍</Text>
              <View>
                <Text style={styles.infoLabel}>LOCATION FOUND</Text>
                <Text style={styles.infoValue}>{item.location}</Text>
              </View>
            </View>

            <View style={styles.infoPill}>
              <Text style={styles.infoIcon}>🕒</Text>
              <View>
                <Text style={styles.infoLabel}>REPORTED</Text>
                <Text style={styles.infoValue}>{item.date}</Text>
              </View>
            </View>
          </View>

          {/* Report Creator Notice: Visible when the report creator views their own found item */}
          {isCreator && !isLost && (
            <View style={styles.creatorBanner}>
              <Text style={styles.creatorBannerIcon}>ℹ️</Text>
              <View style={styles.creatorBannerTextContainer}>
                <Text style={styles.creatorBannerTitle}>You reported finding this item</Text>
                <Text style={styles.creatorBannerDesc}>
                  You are registered as the reporter for this item. Creators cannot submit ownership claims for items they reported found.
                </Text>
              </View>
            </View>
          )}

          {/* Item Resolved Status Banner (Visible to all students if item is returned/resolved) */}
          {isResolved && (
            <View style={styles.itemResolvedBanner}>
              <Text style={styles.statusBannerIcon}>✅</Text>
              <View style={styles.statusBannerTextContainer}>
                <Text style={styles.itemResolvedTitle}>Item Returned & Case Closed</Text>
                <Text style={styles.itemResolvedDesc}>
                  This item has been officially verified and returned to its owner by the Central Security Office. All claim and custody records are preserved.
                </Text>
              </View>
            </View>
          )}

          {/* Claimant In-Screen Feedback Banner (Visible ONLY to the authenticated student who submitted this claim) */}
          {!isAdmin && userClaim && !isResolved && (
            <View
              style={[
                styles.claimStatusBanner,
                userClaim.status === 'approved'
                  ? styles.claimStatusApproved
                  : userClaim.status === 'rejected'
                  ? styles.claimStatusRejected
                  : styles.claimStatusPending,
              ]}
            >
              <Text style={styles.statusBannerIcon}>
                {userClaim.status === 'approved'
                  ? '✅'
                  : userClaim.status === 'rejected'
                  ? '❌'
                  : '⏳'}
              </Text>
              <View style={styles.statusBannerTextContainer}>
                <Text
                  style={[
                    styles.claimStatusTitle,
                    userClaim.status === 'approved'
                      ? styles.claimStatusTitleApproved
                      : userClaim.status === 'rejected'
                      ? styles.claimStatusTitleRejected
                      : styles.claimStatusTitlePending,
                  ]}
                >
                  {userClaim.status === 'approved'
                    ? 'Claim Approved'
                    : userClaim.status === 'rejected'
                    ? 'Claim Rejected'
                    : 'Claim Pending Review'}
                </Text>
                <Text style={styles.claimStatusDesc}>
                  {userClaim.status === 'approved'
                    ? 'Claim Approved — Bring your college ID to the Central Security Office to complete collection.'
                    : userClaim.status === 'rejected'
                    ? 'Claim Rejected — Your ownership proof was not approved. Contact Central Security Office if you need clarification.'
                    : 'Claim Pending Review — Central Security Office is reviewing your request.'}
                </Text>
                <Text style={styles.claimStatusDate}>
                  Submitted on {new Date(userClaim.created_at).toLocaleDateString()} at{' '}
                  {new Date(userClaim.created_at).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
              </View>
            </View>
          )}

          {/* Reporter Guidance Banner (Visible to the student who reported this lost item) */}
          {isCreator && isLost && !isResolved && (
            <View style={[styles.claimStatusBanner, isInCustody ? styles.claimStatusApproved : styles.claimStatusPending]}>
              <Text style={styles.statusBannerIcon}>{isInCustody ? '🎉' : 'ℹ️'}</Text>
              <View style={styles.statusBannerTextContainer}>
                <Text style={[styles.claimStatusTitle, isInCustody ? styles.claimStatusTitleApproved : styles.claimStatusTitlePending]}>
                  {isInCustody ? 'Your Item Was Found!' : 'Your Lost Item Report is Active'}
                </Text>
                <Text style={styles.claimStatusDesc}>
                  {isInCustody
                    ? 'A fellow student reported finding your item and was directed to hand it over to Central Security Office. Once security confirms custody, you can bring your College ID to collect it!'
                    : 'If a fellow student finds your item, they are instructed to hand it over to the Central Security Office. You will receive an immediate in-app notification here.'}
                </Text>
              </View>
            </View>
          )}

          {/* Finder / Student In-Screen Status Banner (Visible when lost item has been reported found) */}
          {!isCreator && isLost && (isInCustody || hasReportedFound) && !isResolved && (
            <View style={[styles.claimStatusBanner, styles.claimStatusApproved]}>
              <Text style={styles.statusBannerIcon}>🤝</Text>
              <View style={styles.statusBannerTextContainer}>
                <Text style={[styles.claimStatusTitle, styles.claimStatusTitleApproved]}>
                  Item Found — Handover Pending
                </Text>
                <Text style={styles.claimStatusDesc}>
                  This lost item was reported found. It must be dropped off at the Central Security Office desk for verification and safe return to the owner.
                </Text>
              </View>
            </View>
          )}

          {/* Central Admin Management Console Block (Visible to Central Admin on both Lost and Found Items) */}
          {isAdmin && (
            <View style={styles.adminConsoleCard}>
              <View style={styles.adminHeaderRow}>
                <View style={styles.adminBadge}>
                  <Text style={styles.adminBadgeText}>🛡️ CENTRAL ADMIN CONSOLE</Text>
                </View>
                <Text style={styles.adminEmailText}>{CENTRAL_ADMIN_EMAIL}</Text>
              </View>

              {/* Physical Custody Status */}
              <View style={styles.adminSection}>
                <Text style={styles.adminSectionLabel}>PHYSICAL CUSTODY</Text>
                <View
                  style={[
                    styles.adminCustodyBadge,
                    custodySecured ? styles.adminCustodySecured : styles.adminCustodyPending,
                  ]}
                >
                  <Text style={styles.adminCustodyText}>
                    {custodySecured
                      ? '✅ SECURED AT CENTRAL SECURITY OFFICE'
                      : '⏳ PENDING HANDOVER FROM FINDER'}
                  </Text>
                </View>
                <Text style={styles.adminHelperText}>
                  The finder must hand the physical item to the Central Security Office before custody is marked as secured.
                </Text>

                {/* Finder Information (Visible only to Admin to facilitate physical drop-off) */}
                <View style={styles.adminFinderRow}>
                  <Text style={styles.adminFinderLabel}>Reported Finder:</Text>
                  <Text style={styles.adminFinderVal}>
                    {item.contactName ?? 'Student'} ({item.contactPhone ?? 'No phone'})
                  </Text>
                </View>

                <Pressable
                  style={({ pressed }) => [
                    styles.adminActionButton,
                    custodySecured ? styles.adminRevertBtn : styles.adminSecureBtn,
                    { opacity: pressed ? 0.85 : 1 },
                  ]}
                  onPress={handleToggleCustody}
                >
                  <Text style={styles.adminActionButtonText}>
                    {custodySecured
                      ? '🔄 Revert Custody to Pending'
                      : '📥 Mark Custody Secured (Item Received)'}
                  </Text>
                </Pressable>
              </View>

              {/* For Found Items: Claim Requests Management. For Lost Items: Owner Info */}
              {!isLost ? (
                <View style={styles.adminSection}>
                  <View style={styles.adminSectionHeaderRow}>
                    <Text style={styles.adminSectionLabel}>
                      CLAIM REQUESTS ({claims.length})
                    </Text>
                    {isProcessingAdminAction && (
                      <ActivityIndicator size="small" color="#A855F7" />
                    )}
                  </View>

                  {claims.length === 0 ? (
                    <Text style={styles.adminEmptyClaimsText}>
                      No student claim requests submitted yet for this item.
                    </Text>
                  ) : (
                  claims.map((claim) => {
                    const isPending = claim.status === 'pending';
                    const isApproved = claim.status === 'approved';
                    return (
                      <View key={claim.id} style={styles.adminClaimCard}>
                        <View style={styles.adminClaimHeader}>
                          <Text style={styles.adminClaimEmail} numberOfLines={1}>
                            👤 {claim.claimant_name
                              ? `${claim.claimant_name} (${claim.claimant_email || claim.claimant_id})`
                              : claim.claimant_email || claim.claimant_id || 'Student Claimant'}
                          </Text>
                          <View
                            style={[
                              styles.adminClaimStatusBadge,
                              isApproved
                                ? styles.statusApprovedBadge
                                : isPending
                                ? styles.statusPendingBadge
                                : styles.statusRejectedBadge,
                            ]}
                          >
                            <Text style={styles.adminClaimStatusText}>
                              {claim.status.toUpperCase()}
                            </Text>
                          </View>
                        </View>

                        {/* Claimant Verification Details (Visible only to Central Admin) */}
                        <View style={styles.adminClaimDetailsBlock}>
                          <View style={styles.adminClaimDetailRow}>
                            <Text style={styles.adminClaimDetailLabel}>Student ID:</Text>
                            <Text style={styles.adminClaimDetailVal}>{claim.student_id_number || 'N/A'}</Text>
                          </View>
                          <View style={styles.adminClaimDetailRow}>
                            <Text style={styles.adminClaimDetailLabel}>Phone:</Text>
                            <Text style={styles.adminClaimDetailVal}>{claim.claimant_phone || 'N/A'}</Text>
                          </View>
                          {claim.claimant_email ? (
                            <View style={styles.adminClaimDetailRow}>
                              <Text style={styles.adminClaimDetailLabel}>Email:</Text>
                              <Text style={styles.adminClaimDetailVal}>{claim.claimant_email}</Text>
                            </View>
                          ) : null}
                          <View style={styles.adminClaimProofBox}>
                            <Text style={styles.adminClaimDetailLabel}>Proof of Ownership:</Text>
                            <Text style={styles.adminClaimProofText}>{claim.proof_description || 'None provided'}</Text>
                          </View>
                        </View>

                        <Text style={styles.adminClaimDate}>
                          Submitted: {new Date(claim.created_at).toLocaleDateString()}{' '}
                          {new Date(claim.created_at).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </Text>

                        {/* Admin Action Buttons for Claim */}
                        <View style={styles.adminClaimActionsRow}>
                          <Pressable
                            style={[
                              styles.claimActionBtn,
                              styles.claimApproveBtn,
                              isApproved && styles.claimActionDisabled,
                            ]}
                            disabled={isApproved || isProcessingAdminAction}
                            onPress={() => handleAdminUpdateClaim(claim.id, 'approved')}
                          >
                            <Text style={styles.claimActionBtnText}>
                              {isApproved ? '✓ Approved' : '✅ Approve Claim'}
                            </Text>
                          </Pressable>

                          <Pressable
                            style={[
                              styles.claimActionBtn,
                              styles.claimRejectBtn,
                              !isPending && styles.claimActionDisabled,
                            ]}
                            disabled={!isPending || isProcessingAdminAction}
                            onPress={() => handleAdminUpdateClaim(claim.id, 'rejected')}
                          >
                            <Text style={styles.claimActionBtnText}>
                              {claim.status === 'rejected' ? '✗ Rejected' : '❌ Reject'}
                            </Text>
                          </Pressable>
                        </View>
                      </View>
                    );
                  })
                )}
              </View>
              ) : (
                /* Lost Item Owner & Verification for Admin */
                <View style={styles.adminSection}>
                  <Text style={styles.adminSectionLabel}>LOST REPORT OWNER</Text>
                  <View style={styles.adminFinderRow}>
                    <Text style={styles.adminFinderLabel}>Reported By:</Text>
                    <Text style={styles.adminFinderVal}>
                      {item.contactName ?? 'Student'} ({item.contactPhone ?? 'No phone'})
                    </Text>
                  </View>
                  <Text style={styles.adminHelperText}>
                    When custody is secured and the owner arrives at Central Security Office, verify their College ID before marking this item returned.
                  </Text>
                </View>
              )}

              {/* Return / Resolution Section */}
              <View style={styles.adminSection}>
                <Text style={styles.adminSectionLabel}>ITEM RETURN & RESOLUTION</Text>
                {isResolved ? (
                  <View style={styles.adminResolvedBanner}>
                    <Text style={styles.adminResolvedBannerText}>
                      ✅ ITEM RETURNED & RESOLVED
                    </Text>
                    <Text style={styles.adminResolvedSubText}>
                      This item has been returned to its verified owner. It is now hidden from the student feed while all claim and audit records are preserved.
                    </Text>
                  </View>
                ) : (
                  <View style={styles.adminResolveActionBox}>
                    <Text style={styles.adminHelperText}>
                      {custodySecured
                        ? 'Custody is secured at Central Security Office. Once the student claimant is verified with their college ID and receives the item, mark it as returned.'
                        : 'Secure physical custody from the finder before returning this item.'}
                    </Text>
                    <Pressable
                      style={({ pressed }) => [
                        styles.adminActionButton,
                        styles.adminResolveBtn,
                        (!custodySecured || isResolving) && styles.claimActionDisabled,
                        { opacity: pressed && custodySecured && !isResolving ? 0.85 : 1 },
                      ]}
                      disabled={!custodySecured || isResolving}
                      onPress={promptResolveConfirmation}
                    >
                      {isResolving ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <Text style={styles.adminActionButtonText}>
                          {custodySecured
                            ? '🎁 Mark as Returned / Resolve Item'
                            : '⏳ Secure Custody First to Resolve'}
                        </Text>
                      )}
                    </Pressable>
                  </View>
                )}
              </View>
            </View>
          )}

          {/* Detailed Description */}
          <View style={styles.sectionBlock}>
            <Text style={styles.sectionHeading}>Description</Text>
            <Text style={styles.descriptionText}>{item.description}</Text>
          </View>

          {/* Suggested Matches Section */}
          <View style={styles.sectionBlock}>
            <View style={styles.matchSectionHeaderRow}>
              <Text style={[styles.sectionHeading, { marginBottom: 0 }]}>
                Suggested {isLost ? 'Found' : 'Lost'} Matches
              </Text>
              {matchSuggestions.length > 0 && (
                <View style={styles.matchCountBadge}>
                  <Text style={styles.matchCountBadgeText}>
                    {matchSuggestions.length} {matchSuggestions.length === 1 ? 'Candidate' : 'Candidates'}
                  </Text>
                </View>
              )}
            </View>

            {/* Disclaimer */}
            <View style={styles.suggestionDisclaimerBox}>
              <Text style={styles.suggestionDisclaimerIcon}>ℹ️</Text>
              <Text style={styles.suggestionDisclaimerText}>
                Unverified suggestion: These reports share similar details. This does not prove ownership.
              </Text>
            </View>

            {matchSuggestions.length > 0 ? (
              <View style={styles.suggestionsList}>
                {matchSuggestions.map((suggestion) => (
                  <SuggestionCard
                    key={suggestion.item.id}
                    suggestion={suggestion}
                    onPress={(candidate) =>
                      router.push({
                        pathname: '/item-details',
                        params: { id: candidate.id },
                      })
                    }
                  />
                ))}
              </View>
            ) : (
              <View style={styles.suggestionsEmptyBox}>
                <Text style={styles.suggestionsEmptyIcon}>🔎</Text>
                <Text style={styles.suggestionsEmptyTitle}>
                  No Matching {isLost ? 'Found' : 'Lost'} Reports Yet
                </Text>
                <Text style={styles.suggestionsEmptySub}>
                  No open reports currently meet the similarity threshold. We automatically compare category, keywords, location, and date proximity.
                </Text>
              </View>
            )}
          </View>

          {/* Custody / Contact Section */}
          <View style={styles.sectionBlock}>
            <Text style={styles.sectionHeading}>
              {isLost ? 'Reported By' : 'Custody & Collection Point'}
            </Text>

            {isLost ? (
              /* For Lost Items: contact info to coordinate returning */
              <View style={styles.contactCard}>
                <View style={styles.contactAvatar}>
                  <Text style={styles.contactAvatarText}>
                    {(item.contactName ?? 'S')[0]}
                  </Text>
                </View>
                <View style={styles.contactDetails}>
                  <Text style={styles.contactName}>{item.contactName ?? 'Student Reporter'}</Text>
                  <Text style={styles.contactPhone}>{item.contactPhone ?? 'Direct Contact'}</Text>
                </View>
              </View>
            ) : (
              /* For Found Items: Central Security Office custody point */
              <View style={styles.contactCard}>
                <View style={styles.securityAvatar}>
                  <Text style={styles.securityAvatarText}>🛡️</Text>
                </View>
                <View style={styles.contactDetails}>
                  <Text style={styles.contactName}>Central Security Office</Text>
                  <Text style={styles.contactSub}>
                    {custodySecured
                      ? '✅ Physical item secured in vault • Bring college ID to collect'
                      : '⏳ Physical drop-off pending from finder • Central Security Office'}
                  </Text>
                </View>
              </View>
            )}
          </View>
        </View>
      </ScrollView>

      {/* Fixed Bottom Action Bar */}
      <View style={styles.bottomBar}>
        {isResolved ? (
          /* Item Already Resolved */
          <Pressable
            style={[styles.actionButton, styles.resolvedButton]}
            disabled={true}
          >
            <Text style={styles.actionButtonText}>
              ✅ Item Returned & Case Closed
            </Text>
          </Pressable>
        ) : isAdmin ? (
          /* Central Admin Action: Manage Custody & Return */
          <Pressable
            style={({ pressed }) => [
              styles.actionButton,
              styles.adminButton,
              { opacity: pressed ? 0.9 : 1 },
            ]}
            onPress={handleAdminClaimActions}
          >
            <Text style={styles.actionButtonText}>
              🛡️ Admin: Manage {isLost ? 'Custody & Return' : 'Claims & Custody'}
            </Text>
          </Pressable>
        ) : isCreator ? (
          /* Report Creator Action: Disabled */
          <Pressable
            style={[styles.actionButton, styles.creatorDisabledButton]}
            disabled={true}
          >
            <Text style={styles.creatorDisabledButtonText}>
              📌 You Reported This {isLost ? 'Lost Item' : 'Item'}
            </Text>
          </Pressable>
        ) : isLost ? (
          /* Eligible Student Action on Lost Item: I Found This Item */
          <Pressable
            style={({ pressed }) => [
              styles.actionButton,
              isInCustody || hasReportedFound ? styles.pendingClaimButton : styles.contactButton,
              (isInCustody || hasReportedFound) && { opacity: 0.85 },
              { opacity: pressed && !isInCustody && !hasReportedFound ? 0.9 : 1 },
            ]}
            onPress={handleClaimPress}
            disabled={isInCustody || hasReportedFound || isSubmittingFoundReport}
          >
            {isSubmittingFoundReport ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={styles.actionButtonText}>
                {isInCustody || hasReportedFound
                  ? '⏳ Handover Pending (Drop at Security)'
                  : '🤝 I Found This Item'}
              </Text>
            )}
          </Pressable>
        ) : (
          /* Eligible Student Action on Found Item: Claim */
          <Pressable
            style={({ pressed }) => [
              styles.actionButton,
              userClaim?.status === 'approved'
                ? styles.approvedClaimButton
                : userClaim?.status === 'rejected'
                ? styles.rejectedClaimButton
                : userClaim?.status === 'pending'
                ? styles.pendingClaimButton
                : styles.claimButton,
              (isSubmittingClaim || userClaim?.status === 'pending') && { opacity: 0.8 },
              { opacity: pressed && !isSubmittingClaim ? 0.9 : 1 },
            ]}
            onPress={handleClaimPress}
            disabled={isSubmittingClaim}
          >
            {isSubmittingClaim ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={styles.actionButtonText}>
                {userClaim?.status === 'approved'
                  ? '✅ Claim Approved — Ready for Pickup'
                  : userClaim?.status === 'rejected'
                  ? '❌ Claim Rejected — View Details'
                  : userClaim?.status === 'pending'
                  ? '⏳ Claim Pending (Central Security)'
                  : '🎁 Claim This Item'}
              </Text>
            )}
          </Pressable>
        )}
      </View>
      {/* Claim Request Modal for Students */}
      <Modal
        visible={claimModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          if (!isSubmittingClaim) setClaimModalVisible(false);
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalBackdrop}
        >
          <View style={styles.modalContent}>
            {/* Header */}
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderTitleCol}>
                <Text style={styles.modalTitle}>Claim This Item</Text>
                <Text style={styles.modalSubtitle}>Provide ownership verification details</Text>
              </View>
              <Pressable
                onPress={() => setClaimModalVisible(false)}
                style={({ pressed }) => [styles.modalCloseButton, { opacity: pressed ? 0.6 : 1 }]}
                disabled={isSubmittingClaim}
                hitSlop={8}
              >
                <Text style={styles.modalCloseText}>✕</Text>
              </Pressable>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.modalScrollBody}
              keyboardShouldPersistTaps="handled"
            >
              {/* Notice */}
              <View style={styles.modalNoticeBox}>
                <Text style={styles.modalNoticeIcon}>ℹ️</Text>
                <Text style={styles.modalNoticeText}>
                  To claim this item, please provide your verification details below. You will also be asked to present your College ID at the Central Security Office.
                </Text>
              </View>

              {/* Error Message */}
              {modalValidationError ? (
                <View style={styles.modalErrorBox}>
                  <Text style={styles.modalErrorIcon}>⚠️</Text>
                  <Text style={styles.modalErrorText}>{modalValidationError}</Text>
                </View>
              ) : null}

              {/* Form Fields */}
              <View style={styles.modalFieldGroup}>
                <Text style={styles.modalFieldLabel}>
                  Full Name <Text style={styles.modalRequiredStar}>*</Text>
                </Text>
                <TextInput
                  style={styles.modalInput}
                  value={claimantName}
                  onChangeText={setClaimantName}
                  placeholder="e.g. John Doe"
                  placeholderTextColor="#64748B"
                  editable={!isSubmittingClaim}
                />
              </View>

              <View style={styles.modalFieldGroup}>
                <Text style={styles.modalFieldLabel}>
                  College / Student ID Number <Text style={styles.modalRequiredStar}>*</Text>
                </Text>
                <TextInput
                  style={styles.modalInput}
                  value={studentIdNumber}
                  onChangeText={setStudentIdNumber}
                  placeholder="e.g. CS2023-042"
                  placeholderTextColor="#64748B"
                  autoCapitalize="characters"
                  editable={!isSubmittingClaim}
                />
              </View>

              <View style={styles.modalFieldGroup}>
                <Text style={styles.modalFieldLabel}>
                  Contact Phone Number <Text style={styles.modalRequiredStar}>*</Text>
                </Text>
                <TextInput
                  style={styles.modalInput}
                  value={claimantPhone}
                  onChangeText={setClaimantPhone}
                  placeholder="e.g. +91 98765 43210"
                  placeholderTextColor="#64748B"
                  keyboardType="phone-pad"
                  editable={!isSubmittingClaim}
                />
              </View>

              <View style={styles.modalFieldGroup}>
                <Text style={styles.modalFieldLabel}>
                  Proof of Ownership Description <Text style={styles.modalRequiredStar}>*</Text>
                </Text>
                <TextInput
                  style={[styles.modalInput, styles.modalTextArea]}
                  value={proofDescription}
                  onChangeText={setProofDescription}
                  placeholder="Describe unique identifying marks, contents, lock screen wallpaper, stickers, or serial number."
                  placeholderTextColor="#64748B"
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                  editable={!isSubmittingClaim}
                />
              </View>

              {/* Privacy Notice */}
              <View style={styles.modalPrivacyBox}>
                <Text style={styles.modalPrivacyText}>
                  🔒 Privacy Guarantee: Your phone, student ID, and proof description are only visible to the Central Admin during ownership verification. They will never be shown to other students.
                </Text>
              </View>

              {/* Action Buttons */}
              <View style={styles.modalActionsRow}>
                <Pressable
                  style={({ pressed }) => [
                    styles.modalCancelBtn,
                    { opacity: pressed || isSubmittingClaim ? 0.7 : 1 },
                  ]}
                  onPress={() => setClaimModalVisible(false)}
                  disabled={isSubmittingClaim}
                >
                  <Text style={styles.modalCancelBtnText}>Cancel</Text>
                </Pressable>

                <Pressable
                  style={({ pressed }) => [
                    styles.modalSubmitBtn,
                    { opacity: pressed || isSubmittingClaim ? 0.8 : 1 },
                  ]}
                  onPress={handleSubmitClaimModal}
                  disabled={isSubmittingClaim}
                >
                  {isSubmittingClaim ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.modalSubmitBtnText}>Submit Claim</Text>
                  )}
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Found Item Modal for Students (When reporting finding a lost item) */}
      <Modal
        visible={foundModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          if (!isSubmittingFoundReport) setFoundModalVisible(false);
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalBackdrop}
        >
          <View style={styles.modalContent}>
            {/* Header */}
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderTitleCol}>
                <Text style={styles.modalTitle}>Report Found Item</Text>
                <Text style={styles.modalSubtitle}>Initiate Campus Security Handover</Text>
              </View>
              <Pressable
                onPress={() => setFoundModalVisible(false)}
                style={({ pressed }) => [styles.modalCloseButton, { opacity: pressed ? 0.6 : 1 }]}
                disabled={isSubmittingFoundReport}
                hitSlop={8}
              >
                <Text style={styles.modalCloseText}>✕</Text>
              </Pressable>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.modalScrollBody}
              keyboardShouldPersistTaps="handled"
            >
              {/* Security Handover Notice */}
              <View style={styles.modalNoticeBox}>
                <Text style={styles.modalNoticeIcon}>🛡️</Text>
                <Text style={styles.modalNoticeText}>
                  Campus Handover Policy: When you find an item reported lost, you must hand it in to the Central Security Office. The owner and Central Admin will be notified immediately.
                </Text>
              </View>

              {/* Error Message */}
              {foundModalValidationError ? (
                <View style={styles.modalErrorBox}>
                  <Text style={styles.modalErrorIcon}>⚠️</Text>
                  <Text style={styles.modalErrorText}>{foundModalValidationError}</Text>
                </View>
              ) : null}

              {/* Form Fields */}
              <View style={styles.modalFieldGroup}>
                <Text style={styles.modalFieldLabel}>
                  Your Full Name <Text style={styles.modalRequiredStar}>*</Text>
                </Text>
                <TextInput
                  style={styles.modalInput}
                  value={finderName}
                  onChangeText={setFinderName}
                  placeholder="e.g. John Doe"
                  placeholderTextColor="#64748B"
                  editable={!isSubmittingFoundReport}
                />
              </View>

              <View style={styles.modalFieldGroup}>
                <Text style={styles.modalFieldLabel}>
                  Your Contact Phone Number <Text style={styles.modalRequiredStar}>*</Text>
                </Text>
                <TextInput
                  style={styles.modalInput}
                  value={finderPhone}
                  onChangeText={setFinderPhone}
                  placeholder="e.g. +91 98765 43210"
                  placeholderTextColor="#64748B"
                  keyboardType="phone-pad"
                  editable={!isSubmittingFoundReport}
                />
              </View>

              <View style={styles.modalFieldGroup}>
                <Text style={styles.modalFieldLabel}>
                  Where Did You Find It? / Handover Note <Text style={styles.modalRequiredStar}>*</Text>
                </Text>
                <TextInput
                  style={[styles.modalInput, styles.modalTextArea]}
                  value={finderNote}
                  onChangeText={setFinderNote}
                  placeholder="e.g. Found on 2nd Floor Library Desk 4. Bringing it to Central Security Office desk now."
                  placeholderTextColor="#64748B"
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                  editable={!isSubmittingFoundReport}
                />
              </View>

              {/* Action Buttons */}
              <View style={styles.modalActionsRow}>
                <Pressable
                  style={({ pressed }) => [
                    styles.modalCancelBtn,
                    { opacity: pressed || isSubmittingFoundReport ? 0.7 : 1 },
                  ]}
                  onPress={() => setFoundModalVisible(false)}
                  disabled={isSubmittingFoundReport}
                >
                  <Text style={styles.modalCancelBtnText}>Cancel</Text>
                </Pressable>

                <Pressable
                  style={({ pressed }) => [
                    styles.modalSubmitBtn,
                    { opacity: pressed || isSubmittingFoundReport ? 0.8 : 1 },
                  ]}
                  onPress={handleSubmitFoundModal}
                  disabled={isSubmittingFoundReport}
                >
                  {isSubmittingFoundReport ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.modalSubmitBtnText}>Submit & Notify</Text>
                  )}
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

interface SuggestionCardProps {
  suggestion: MatchSuggestion;
  onPress: (item: LostFoundItem) => void;
}

function SuggestionCard({ suggestion, onPress }: SuggestionCardProps) {
  const { item: candidate, score, confidence, reasons } = suggestion;
  const [imageError, setImageError] = useState(false);
  const [fallbackError, setFallbackError] = useState(false);

  const { uri: primaryUri } = resolveItemImage(candidate);
  const categoryFallbackUri =
    CATEGORY_FALLBACK_IMAGES[candidate.category] || CATEGORY_FALLBACK_IMAGES.Other;
  const activeUri = !imageError && primaryUri ? primaryUri : categoryFallbackUri;
  const isCandidateLost = candidate.type === 'lost';

  const confidenceBadgeStyle =
    confidence === 'High Match'
      ? styles.confidenceBadgeHigh
      : confidence === 'Moderate Match'
      ? styles.confidenceBadgeModerate
      : styles.confidenceBadgePotential;

  const confidenceTextStyle =
    confidence === 'High Match'
      ? styles.confidenceTextHigh
      : confidence === 'Moderate Match'
      ? styles.confidenceTextModerate
      : styles.confidenceTextPotential;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.suggestionCard,
        { opacity: pressed ? 0.9 : 1, transform: [{ scale: pressed ? 0.99 : 1 }] },
      ]}
      onPress={() => onPress(candidate)}
      android_ripple={{ color: 'rgba(255, 255, 255, 0.08)' }}
    >
      <View style={styles.suggestionTopRow}>
        {/* Candidate Thumbnail */}
        <View style={styles.suggestionImageWrapper}>
          {activeUri && (!imageError || !fallbackError) ? (
            <Image
              source={{ uri: activeUri }}
              style={styles.suggestionImage}
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
            <View style={styles.suggestionPlaceholder}>
              <Text style={styles.suggestionPlaceholderIcon}>
                {CATEGORY_ICONS[candidate.category] || '📦'}
              </Text>
            </View>
          )}
          <View
            style={[
              styles.suggestionTypeBadge,
              isCandidateLost ? styles.lostTypeBadge : styles.foundTypeBadge,
            ]}
          >
            <Text style={styles.suggestionTypeBadgeText}>
              {isCandidateLost ? 'LOST' : 'FOUND'}
            </Text>
          </View>
        </View>

        {/* Candidate Info */}
        <View style={styles.suggestionContent}>
          <View style={styles.suggestionHeaderBadgeRow}>
            <View style={[styles.confidenceBadge, confidenceBadgeStyle]}>
              <Text style={[styles.confidenceBadgeText, confidenceTextStyle]}>
                {confidence} • {score}%
              </Text>
            </View>
          </View>

          <Text style={styles.suggestionTitle} numberOfLines={2}>
            {candidate.title}
          </Text>

          <View style={styles.suggestionMetaRow}>
            <Text style={styles.suggestionMetaText} numberOfLines={1}>
              📍 {candidate.location}
            </Text>
            <Text style={styles.suggestionMetaText} numberOfLines={1}>
              🕒 {candidate.date}
            </Text>
          </View>
        </View>
      </View>

      {/* Match Reasons */}
      {reasons.length > 0 && (
        <View style={styles.reasonsContainer}>
          <Text style={styles.reasonsLabel}>Matching Details:</Text>
          <View style={styles.reasonsPillRow}>
            {reasons.map((reason, idx) => (
              <View key={idx} style={styles.reasonPill}>
                <Text style={styles.reasonPillText}>✓ {reason}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Tap hint */}
      <View style={styles.suggestionFooterRow}>
        <Text style={styles.suggestionFooterHint}>Tap to view details</Text>
        <Text style={styles.suggestionFooterArrow}>→</Text>
      </View>
    </Pressable>
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
    gap: 6,
    paddingVertical: 4,
  },
  backArrow: {
    color: '#38BDF8',
    fontSize: 20,
    fontWeight: '700',
  },
  backText: {
    color: '#38BDF8',
    fontSize: 15,
    fontWeight: '600',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  lostBadge: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  foundBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  statusBadgeText: {
    color: '#F8FAFC',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  scrollContent: {
    paddingBottom: 110,
  },
  heroImageWrapper: {
    width: '100%',
    height: 280,
    backgroundColor: '#0F172A',
    position: 'relative',
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  placeholderBox: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1E293B',
  },
  placeholderEmoji: {
    fontSize: 72,
  },
  categoryBadgeFloat: {
    position: 'absolute',
    top: 14,
    left: 14,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  categoryBadgeText: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '600',
  },
  photoStatusBadgeFloat: {
    position: 'absolute',
    bottom: 14,
    right: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  illustrativeBadgeFloat: {
    backgroundColor: 'rgba(217, 119, 6, 0.9)',
  },
  actualBadgeFloat: {
    backgroundColor: 'rgba(16, 185, 129, 0.9)',
  },
  photoStatusTextFloat: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  illustrativeTextFloat: {
    color: '#FFFFFF',
  },
  actualTextFloat: {
    color: '#FFFFFF',
  },
  illustrativeNotice: {
    flexDirection: 'row',
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    marginHorizontal: 16,
    marginTop: 14,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
    gap: 10,
    alignItems: 'center',
  },
  illustrativeNoticeIcon: {
    fontSize: 22,
  },
  illustrativeNoticeTextContainer: {
    flex: 1,
  },
  illustrativeNoticeTitle: {
    color: '#FBBF24',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 2,
  },
  illustrativeNoticeDesc: {
    color: '#D1D5DB',
    fontSize: 12,
    lineHeight: 17,
  },
  actualPhotoNotice: {
    flexDirection: 'row',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    marginHorizontal: 16,
    marginTop: 14,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.25)',
    alignItems: 'center',
    gap: 8,
  },
  actualPhotoIcon: {
    color: '#34D399',
    fontSize: 16,
    fontWeight: '700',
  },
  actualPhotoText: {
    color: '#A7F3D0',
    fontSize: 12,
    fontWeight: '600',
  },
  cardContainer: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  titleBadgeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 14,
  },
  itemTitle: {
    flex: 1,
    color: '#F8FAFC',
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 28,
  },
  dbSourceBadge: {
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)',
  },
  dbSourceBadgeText: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '700',
  },
  demoSourceBadge: {
    backgroundColor: 'rgba(148, 163, 184, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.3)',
  },
  demoSourceBadgeText: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '700',
  },
  infoRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 18,
  },
  infoPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#131B2E',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
    gap: 10,
  },
  infoIcon: {
    fontSize: 18,
  },
  infoLabel: {
    color: '#64748B',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  infoValue: {
    color: '#E2E8F0',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
  },
  creatorBanner: {
    flexDirection: 'row',
    backgroundColor: 'rgba(51, 65, 85, 0.4)',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#475569',
    gap: 10,
    alignItems: 'center',
    marginBottom: 18,
  },
  creatorBannerIcon: {
    fontSize: 20,
  },
  creatorBannerTextContainer: {
    flex: 1,
  },
  creatorBannerTitle: {
    color: '#E2E8F0',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 2,
  },
  creatorBannerDesc: {
    color: '#94A3B8',
    fontSize: 12,
    lineHeight: 16,
  },
  adminConsoleCard: {
    backgroundColor: '#1E1B4B', // indigo-950
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#4F46E5', // indigo-600
    padding: 16,
    marginBottom: 22,
  },
  adminHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#312E81',
  },
  adminBadge: {
    backgroundColor: '#4338CA',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  adminBadgeText: {
    color: '#EEF2FF',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  adminEmailText: {
    color: '#A5B4FC',
    fontSize: 11,
    fontWeight: '600',
  },
  adminSection: {
    marginBottom: 16,
  },
  adminSectionLabel: {
    color: '#C7D2FE',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  adminCustodyBadge: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 6,
  },
  adminCustodySecured: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    borderWidth: 1,
    borderColor: '#10B981',
  },
  adminCustodyPending: {
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  adminCustodyText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  adminHelperText: {
    color: '#94A3B8',
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 8,
  },
  adminFinderRow: {
    flexDirection: 'row',
    gap: 6,
    backgroundColor: '#171439',
    padding: 8,
    borderRadius: 6,
    marginBottom: 10,
  },
  adminFinderLabel: {
    color: '#818CF8',
    fontSize: 11,
    fontWeight: '700',
  },
  adminFinderVal: {
    color: '#E0E7FF',
    fontSize: 11,
    fontWeight: '600',
  },
  adminActionButton: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  adminSecureBtn: {
    backgroundColor: '#059669', // emerald
  },
  adminRevertBtn: {
    backgroundColor: '#475569',
  },
  adminActionButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  adminSectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  adminEmptyClaimsText: {
    color: '#94A3B8',
    fontSize: 12,
    fontStyle: 'italic',
    paddingVertical: 8,
  },
  adminClaimCard: {
    backgroundColor: '#171439',
    borderRadius: 10,
    padding: 12,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#3730A3',
  },
  adminClaimHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  adminClaimEmail: {
    flex: 1,
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '700',
    marginRight: 8,
  },
  adminClaimStatusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusApprovedBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.25)',
  },
  statusPendingBadge: {
    backgroundColor: 'rgba(245, 158, 11, 0.25)',
  },
  statusRejectedBadge: {
    backgroundColor: 'rgba(239, 68, 68, 0.25)',
  },
  adminClaimStatusText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  adminClaimDate: {
    color: '#94A3B8',
    fontSize: 11,
    marginBottom: 10,
  },
  adminClaimActionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  claimActionBtn: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 6,
    alignItems: 'center',
  },
  claimApproveBtn: {
    backgroundColor: '#059669',
  },
  claimRejectBtn: {
    backgroundColor: '#DC2626',
  },
  claimActionDisabled: {
    opacity: 0.4,
  },
  claimActionBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  sectionBlock: {
    marginBottom: 22,
  },
  sectionHeading: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  descriptionText: {
    color: '#CBD5E1',
    fontSize: 15,
    lineHeight: 23,
    backgroundColor: '#131B2E',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  contactCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#131B2E',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
    gap: 12,
  },
  contactAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#2563EB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  contactAvatarText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  securityAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#4338CA',
    justifyContent: 'center',
    alignItems: 'center',
  },
  securityAvatarText: {
    fontSize: 20,
  },
  contactDetails: {
    flex: 1,
  },
  contactName: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700',
  },
  contactPhone: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 2,
  },
  contactSub: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#0B0F17',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
  },
  actionButton: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  claimButton: {
    backgroundColor: '#059669', // emerald-600
  },
  pendingClaimButton: {
    backgroundColor: '#D97706', // amber-600
  },
  contactButton: {
    backgroundColor: '#2563EB', // blue-600
  },
  adminButton: {
    backgroundColor: '#6D28D9', // purple-700
  },
  creatorDisabledButton: {
    backgroundColor: '#334155', // slate-700
  },
  creatorDisabledButtonText: {
    color: '#94A3B8', // slate-400
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  /* Admin Claim Card Details */
  adminClaimDetailsBlock: {
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1E293B',
    marginBottom: 8,
    gap: 6,
  },
  adminClaimDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  adminClaimDetailLabel: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '700',
  },
  adminClaimDetailVal: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  adminClaimProofBox: {
    marginTop: 4,
    gap: 2,
  },
  adminClaimProofText: {
    color: '#E2E8F0',
    fontSize: 12,
    lineHeight: 17,
    fontStyle: 'italic',
    backgroundColor: '#0F172A',
    padding: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#334155',
  },
  /* Modal Styles */
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#0F172A',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
    maxHeight: '90%',
    paddingBottom: 24,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  modalHeaderTitleCol: {
    flex: 1,
  },
  modalTitle: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '700',
  },
  modalSubtitle: {
    color: '#94A3B8',
    fontSize: 13,
    marginTop: 2,
  },
  modalCloseButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },
  modalCloseText: {
    color: '#94A3B8',
    fontSize: 16,
    fontWeight: '600',
  },
  modalScrollBody: {
    padding: 20,
  },
  modalNoticeBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.25)',
    padding: 12,
    marginBottom: 16,
    gap: 10,
  },
  modalNoticeIcon: {
    fontSize: 16,
  },
  modalNoticeText: {
    color: '#BAE6FD',
    fontSize: 13,
    lineHeight: 18,
    flex: 1,
  },
  modalErrorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    padding: 12,
    marginBottom: 16,
    gap: 10,
  },
  modalErrorIcon: {
    fontSize: 16,
  },
  modalErrorText: {
    color: '#FCA5A5',
    fontSize: 13,
    flex: 1,
  },
  modalFieldGroup: {
    marginBottom: 16,
  },
  modalFieldLabel: {
    color: '#E2E8F0',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
  },
  modalRequiredStar: {
    color: '#EF4444',
  },
  modalInput: {
    backgroundColor: '#131B2E',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#F8FAFC',
    fontSize: 14,
  },
  modalTextArea: {
    minHeight: 88,
  },
  modalPrivacyBox: {
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.2)',
    padding: 12,
    marginBottom: 20,
  },
  modalPrivacyText: {
    color: '#6EE7B7',
    fontSize: 12,
    lineHeight: 17,
  },
  modalActionsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  modalCancelBtn: {
    flex: 1,
    backgroundColor: '#1E293B',
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelBtnText: {
    color: '#94A3B8',
    fontSize: 15,
    fontWeight: '600',
  },
  modalSubmitBtn: {
    flex: 2,
    backgroundColor: '#059669',
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalSubmitBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  adminResolveBtn: {
    backgroundColor: '#059669', // emerald-600
    marginTop: 8,
  },
  adminResolvedBanner: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.35)',
    borderRadius: 10,
    padding: 12,
  },
  adminResolvedBannerText: {
    color: '#34D399',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  adminResolvedSubText: {
    color: '#CBD5E1',
    fontSize: 12,
    marginTop: 4,
    lineHeight: 16,
  },
  adminResolveActionBox: {
    marginTop: 4,
  },
  resolvedBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.4)',
  },
  resolvedButton: {
    backgroundColor: '#065F46', // emerald-800
  },
  /* Suggested Matches Styles */
  matchSectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  matchCountBadge: {
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)',
  },
  matchCountBadgeText: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '700',
  },
  suggestionDisclaimerBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.25)',
    borderRadius: 8,
    padding: 10,
    marginBottom: 14,
    gap: 8,
  },
  suggestionDisclaimerIcon: {
    fontSize: 14,
    marginTop: 1,
  },
  suggestionDisclaimerText: {
    flex: 1,
    color: '#FCD34D',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
  },
  suggestionsList: {
    gap: 12,
  },
  suggestionCard: {
    backgroundColor: '#0F172A',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1E293B',
    padding: 12,
  },
  suggestionTopRow: {
    flexDirection: 'row',
    gap: 12,
  },
  suggestionImageWrapper: {
    position: 'relative',
    width: 80,
    height: 80,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#1E293B',
  },
  suggestionImage: {
    width: '100%',
    height: '100%',
  },
  suggestionPlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#131B2E',
  },
  suggestionPlaceholderIcon: {
    fontSize: 32,
  },
  suggestionTypeBadge: {
    position: 'absolute',
    top: 4,
    left: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  lostTypeBadge: {
    backgroundColor: 'rgba(225, 29, 72, 0.85)',
  },
  foundTypeBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.85)',
  },
  suggestionTypeBadgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  suggestionContent: {
    flex: 1,
    justifyContent: 'space-between',
  },
  suggestionHeaderBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  confidenceBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 10,
    borderWidth: 1,
  },
  confidenceBadgeHigh: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderColor: 'rgba(16, 185, 129, 0.35)',
  },
  confidenceBadgeModerate: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderColor: 'rgba(245, 158, 11, 0.35)',
  },
  confidenceBadgePotential: {
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    borderColor: 'rgba(56, 189, 248, 0.35)',
  },
  confidenceBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  confidenceTextHigh: {
    color: '#34D399',
  },
  confidenceTextModerate: {
    color: '#FBBF24',
  },
  confidenceTextPotential: {
    color: '#38BDF8',
  },
  suggestionTitle: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
    marginBottom: 4,
  },
  suggestionMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  suggestionMetaText: {
    color: '#94A3B8',
    fontSize: 11.5,
  },
  reasonsContainer: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
  },
  reasonsLabel: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  reasonsPillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  reasonPill: {
    backgroundColor: 'rgba(30, 41, 59, 0.8)',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: '#334155',
  },
  reasonPillText: {
    color: '#CBD5E1',
    fontSize: 11,
    fontWeight: '500',
  },
  suggestionFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 8,
    gap: 4,
  },
  suggestionFooterHint: {
    color: '#38BDF8',
    fontSize: 11.5,
    fontWeight: '600',
  },
  suggestionFooterArrow: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '800',
  },
  suggestionsEmptyBox: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
    padding: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestionsEmptyIcon: {
    fontSize: 24,
    marginBottom: 6,
  },
  suggestionsEmptyTitle: {
    color: '#E2E8F0',
    fontSize: 13.5,
    fontWeight: '700',
    marginBottom: 4,
    textAlign: 'center',
  },
  suggestionsEmptySub: {
    color: '#64748B',
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center',
    maxWidth: 280,
  },
  /* Module 10: In-Screen Claim & Item Status Feedback Banners */
  itemResolvedBanner: {
    flexDirection: 'row',
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.35)',
    borderRadius: 12,
    padding: 14,
    gap: 12,
    alignItems: 'flex-start',
    marginBottom: 18,
  },
  itemResolvedTitle: {
    color: '#34D399',
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 3,
    letterSpacing: 0.3,
  },
  itemResolvedDesc: {
    color: '#CBD5E1',
    fontSize: 12.5,
    lineHeight: 18,
  },
  claimStatusBanner: {
    flexDirection: 'row',
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    gap: 12,
    alignItems: 'flex-start',
    marginBottom: 18,
  },
  claimStatusPending: {
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderColor: 'rgba(245, 158, 11, 0.35)',
  },
  claimStatusApproved: {
    backgroundColor: 'rgba(16, 185, 129, 0.14)',
    borderColor: 'rgba(16, 185, 129, 0.35)',
  },
  claimStatusRejected: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderColor: 'rgba(239, 68, 68, 0.35)',
  },
  statusBannerIcon: {
    fontSize: 22,
    marginTop: 1,
  },
  statusBannerTextContainer: {
    flex: 1,
  },
  claimStatusTitle: {
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 3,
    letterSpacing: 0.3,
  },
  claimStatusTitlePending: {
    color: '#FBBF24',
  },
  claimStatusTitleApproved: {
    color: '#34D399',
  },
  claimStatusTitleRejected: {
    color: '#F87171',
  },
  claimStatusDesc: {
    color: '#E2E8F0',
    fontSize: 12.5,
    lineHeight: 18,
  },
  claimStatusDate: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 6,
  },
  approvedClaimButton: {
    backgroundColor: '#059669', // emerald-600
  },
  rejectedClaimButton: {
    backgroundColor: '#991B1B', // red-800
  },
});
