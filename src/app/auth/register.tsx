import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import * as Linking from 'expo-linking';

import { COLLEGE_EMAIL_DOMAIN, validateCollegeEmail } from '@/constants/auth';
import { supabase } from '@/lib/supabase';

export default function RegisterScreen() {
  const params = useLocalSearchParams<{ returnUrl?: string; type?: string }>();
  const returnUrl = params.returnUrl || '/';

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<{
    fullName?: string;
    email?: string;
    password?: string;
    confirmPassword?: string;
    general?: string;
  }>({});

  const validateForm = () => {
    const newErrors: typeof errors = {};

    if (!fullName.trim()) {
      newErrors.fullName = 'Full name is required.';
    } else if (fullName.trim().length < 2) {
      newErrors.fullName = 'Please enter your full name.';
    }

    const normalizedEmail = email.trim().toLowerCase();
    const emailValidation = validateCollegeEmail(normalizedEmail);
    if (!emailValidation.isValid) {
      newErrors.email = emailValidation.error;
    }

    if (!password) {
      newErrors.password = 'Password is required.';
    } else if (password.length < 6) {
      newErrors.password = 'Password must be at least 6 characters long.';
    }

    if (!confirmPassword) {
      newErrors.confirmPassword = 'Please confirm your password.';
    } else if (password !== confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match.';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleRegister = async () => {
    if (!validateForm()) return;

    setIsLoading(true);
    const normalizedEmail = email.trim().toLowerCase();

    // Create app-scheme or Expo Go deep link callback URL for email verification
    const emailRedirectTo = Linking.createURL('auth/callback');

    try {
      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          data: {
            full_name: fullName.trim(),
          },
          emailRedirectTo,
        },
      });

      if (error) {
        const errorMsg = error.message.toLowerCase();
        if (errorMsg.includes('already registered') || errorMsg.includes('user already exists')) {
          setErrors({
            general: 'An account with this college email already exists. Please sign in instead.',
          });
          return;
        }
        setErrors({ general: error.message || 'Unable to register. Please try again.' });
        return;
      }

      // Check if user was created
      if (data.user) {
        Alert.alert(
          'Confirmation Email Sent! 📩',
          `We sent a confirmation link to ${normalizedEmail}. Please check your inbox and tap the link to activate your account.`,
          [
            {
              text: 'Check Inbox',
              onPress: () =>
                router.replace({
                  pathname: '/auth/verify-email',
                  params: {
                    email: normalizedEmail,
                    returnUrl,
                    type: params.type,
                  },
                }),
            },
          ]
        );
      }
    } catch {
      setErrors({ general: 'Network connection failed. Please check your internet and try again.' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.badge}>
              <Text style={styles.badgeIcon}>🎓</Text>
              <Text style={styles.badgeText}>Builders College Registration</Text>
            </View>
            <Text style={styles.title}>Create Account</Text>
            <Text style={styles.subtitle}>
              Register with your college email to report lost items and claim found property.
            </Text>
          </View>

          {/* Form Card */}
          <View style={styles.card}>
            {/* General Error Banner */}
            {errors.general ? (
              <View style={styles.errorBanner}>
                <Text style={styles.errorBannerIcon}>⚠️</Text>
                <Text style={styles.errorBannerText}>{errors.general}</Text>
              </View>
            ) : null}

            {/* Full Name Field */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>FULL NAME</Text>
              <TextInput
                style={[styles.input, errors.fullName && styles.inputError]}
                placeholder="e.g. Rahul Sharma"
                placeholderTextColor="#64748B"
                value={fullName}
                onChangeText={(text) => {
                  setFullName(text);
                  if (errors.fullName) setErrors((prev) => ({ ...prev, fullName: undefined }));
                }}
                autoCapitalize="words"
                editable={!isLoading}
              />
              {errors.fullName ? <Text style={styles.errorText}>{errors.fullName}</Text> : null}
            </View>

            {/* College Email Field */}
            <View style={styles.fieldGroup}>
              <View style={styles.labelRow}>
                <Text style={styles.label}>COLLEGE EMAIL</Text>
                <Text style={styles.domainHint}>@{COLLEGE_EMAIL_DOMAIN}</Text>
              </View>
              <TextInput
                style={[styles.input, errors.email && styles.inputError]}
                placeholder={`rollnumber@${COLLEGE_EMAIL_DOMAIN}`}
                placeholderTextColor="#64748B"
                value={email}
                onChangeText={(text) => {
                  setEmail(text);
                  if (errors.email) setErrors((prev) => ({ ...prev, email: undefined }));
                }}
                autoCapitalize="none"
                keyboardType="email-address"
                autoCorrect={false}
                editable={!isLoading}
              />
              {errors.email ? <Text style={styles.errorText}>{errors.email}</Text> : null}
            </View>

            {/* Password Field */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>PASSWORD (MIN. 6 CHARACTERS)</Text>
              <View style={styles.passwordWrapper}>
                <TextInput
                  style={[styles.input, styles.passwordInput, errors.password && styles.inputError]}
                  placeholder="Create a strong password"
                  placeholderTextColor="#64748B"
                  value={password}
                  onChangeText={(text) => {
                    setPassword(text);
                    if (errors.password) setErrors((prev) => ({ ...prev, password: undefined }));
                  }}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!isLoading}
                />
                <Pressable
                  style={styles.eyeButton}
                  onPress={() => setShowPassword((prev) => !prev)}
                  hitSlop={10}
                >
                  <Text style={styles.eyeIcon}>{showPassword ? '🙈' : '👁️'}</Text>
                </Pressable>
              </View>
              {errors.password ? <Text style={styles.errorText}>{errors.password}</Text> : null}
            </View>

            {/* Confirm Password Field */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>CONFIRM PASSWORD</Text>
              <TextInput
                style={[styles.input, errors.confirmPassword && styles.inputError]}
                placeholder="Re-enter your password"
                placeholderTextColor="#64748B"
                value={confirmPassword}
                onChangeText={(text) => {
                  setConfirmPassword(text);
                  if (errors.confirmPassword)
                    setErrors((prev) => ({ ...prev, confirmPassword: undefined }));
                }}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!isLoading}
              />
              {errors.confirmPassword ? (
                <Text style={styles.errorText}>{errors.confirmPassword}</Text>
              ) : null}
            </View>

            {/* Submit Button */}
            <Pressable
              style={({ pressed }) => [
                styles.submitButton,
                isLoading && styles.submitButtonDisabled,
                { opacity: pressed && !isLoading ? 0.9 : 1 },
              ]}
              onPress={handleRegister}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator color="#0B0F17" />
              ) : (
                <Text style={styles.submitButtonText}>Create Account</Text>
              )}
            </Pressable>

            {/* Switch to Login */}
            <View style={styles.switchRow}>
              <Text style={styles.switchText}>Already registered?</Text>
              <Pressable
                onPress={() =>
                  router.push({
                    pathname: '/auth/login',
                    params: { returnUrl, type: params.type },
                  })
                }
                hitSlop={8}
                disabled={isLoading}
              >
                <Text style={styles.switchLink}>Sign In</Text>
              </Pressable>
            </View>
          </View>

          {/* Guest Action */}
          <Pressable
            style={({ pressed }) => [styles.guestButton, { opacity: pressed ? 0.7 : 1 }]}
            onPress={() => router.replace('/')}
            disabled={isLoading}
          >
            <Text style={styles.guestButtonText}>← Browse Items as Guest</Text>
          </Pressable>
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
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 40,
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#131B2E',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#1E293B',
    marginBottom: 14,
  },
  badgeIcon: {
    fontSize: 14,
  },
  badgeText: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '700',
  },
  title: {
    color: '#F8FAFC',
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  subtitle: {
    color: '#94A3B8',
    fontSize: 13.5,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 320,
  },
  card: {
    backgroundColor: '#131B2E',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#1E293B',
    padding: 20,
    marginBottom: 20,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(225, 29, 72, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(225, 29, 72, 0.4)',
    borderRadius: 10,
    padding: 10,
    marginBottom: 16,
  },
  errorBannerIcon: {
    fontSize: 16,
  },
  errorBannerText: {
    color: '#FB7185',
    fontSize: 12.5,
    flex: 1,
    fontWeight: '500',
  },
  fieldGroup: {
    marginBottom: 16,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  label: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  domainHint: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '600',
  },
  input: {
    backgroundColor: '#0B0F17',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#F8FAFC',
    fontSize: 14,
  },
  inputError: {
    borderColor: '#E11D48',
  },
  passwordWrapper: {
    position: 'relative',
    justifyContent: 'center',
  },
  passwordInput: {
    paddingRight: 45,
  },
  eyeButton: {
    position: 'absolute',
    right: 12,
    padding: 6,
  },
  eyeIcon: {
    fontSize: 16,
  },
  errorText: {
    color: '#FB7185',
    fontSize: 11.5,
    marginTop: 5,
    fontWeight: '500',
  },
  submitButton: {
    backgroundColor: '#38BDF8',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
    marginBottom: 16,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: '#0B0F17',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  switchText: {
    color: '#94A3B8',
    fontSize: 13,
  },
  switchLink: {
    color: '#38BDF8',
    fontSize: 13,
    fontWeight: '700',
  },
  guestButton: {
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  guestButtonText: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '600',
  },
});
