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

import { COLLEGE_EMAIL_DOMAIN, validateCollegeEmail } from '@/constants/auth';
import { supabase } from '@/lib/supabase';

export default function LoginScreen() {
  const params = useLocalSearchParams<{ returnUrl?: string; type?: string }>();
  const returnUrl = params.returnUrl || '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string; general?: string }>({});

  const handleLogin = async () => {
    setErrors({});
    const normalizedEmail = email.trim().toLowerCase();

    // 1. Email validation
    const emailValidation = validateCollegeEmail(normalizedEmail);
    if (!emailValidation.isValid) {
      setErrors((prev) => ({ ...prev, email: emailValidation.error }));
      return;
    }

    // 2. Password validation
    if (!password) {
      setErrors((prev) => ({ ...prev, password: 'Password is required.' }));
      return;
    }

    setIsLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });

      if (error) {
        const errorMsg = error.message.toLowerCase();

        // Handle unverified email state specifically
        if (errorMsg.includes('email not confirmed') || errorMsg.includes('unconfirmed')) {
          Alert.alert(
            'Email Not Verified',
            `Your college email (${normalizedEmail}) has not been confirmed yet. Please check your inbox or resend the verification email.`,
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Verify Email',
                onPress: () =>
                  router.push({
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
          return;
        }

        if (errorMsg.includes('invalid login credentials') || errorMsg.includes('invalid_grant')) {
          setErrors({ general: 'Invalid email or password. Please check your credentials.' });
          return;
        }

        setErrors({ general: error.message || 'Unable to sign in. Please try again.' });
        return;
      }

      if (data.session) {
        // Enforce strict email verification: unconfirmed accounts must not enter
        if (!data.user?.email_confirmed_at) {
          await supabase.auth.signOut();
          Alert.alert(
            'Email Not Verified',
            `Your college email (${normalizedEmail}) has not been verified yet. Please check your inbox or resend the confirmation email.`,
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Verify Email',
                onPress: () =>
                  router.push({
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
          return;
        }

        // Successful confirmed login: navigate to requested return destination
        if (params.type && returnUrl === '/report') {
          router.replace({
            pathname: '/report',
            params: { type: params.type },
          });
        } else {
          router.replace(returnUrl as any);
        }
      }
    } catch {
      setErrors({ general: 'An unexpected connection error occurred. Please try again.' });
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
              <Text style={styles.badgeText}>Builders College Portal</Text>
            </View>
            <Text style={styles.title}>Welcome Back</Text>
            <Text style={styles.subtitle}>
              Sign in with your official college account to report and claim items.
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

            {/* Email Field */}
            <View style={styles.fieldGroup}>
              <View style={styles.labelRow}>
                <Text style={styles.label}>COLLEGE EMAIL</Text>
                <Text style={styles.domainHint}>@{COLLEGE_EMAIL_DOMAIN}</Text>
              </View>
              <TextInput
                style={[styles.input, errors.email && styles.inputError]}
                placeholder={`yourname@${COLLEGE_EMAIL_DOMAIN}`}
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
              <View style={styles.labelRow}>
                <Text style={styles.label}>PASSWORD</Text>
              </View>
              <View style={styles.passwordWrapper}>
                <TextInput
                  style={[styles.input, styles.passwordInput, errors.password && styles.inputError]}
                  placeholder="Enter your password"
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

            {/* Submit Button */}
            <Pressable
              style={({ pressed }) => [
                styles.submitButton,
                isLoading && styles.submitButtonDisabled,
                { opacity: pressed && !isLoading ? 0.9 : 1 },
              ]}
              onPress={handleLogin}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator color="#0B0F17" />
              ) : (
                <Text style={styles.submitButtonText}>Sign In</Text>
              )}
            </Pressable>

            {/* Switch to Register */}
            <View style={styles.switchRow}>
              <Text style={styles.switchText}>Don't have an account?</Text>
              <Pressable
                onPress={() =>
                  router.push({
                    pathname: '/auth/register',
                    params: { returnUrl, type: params.type },
                  })
                }
                hitSlop={8}
                disabled={isLoading}
              >
                <Text style={styles.switchLink}>Create Student Account</Text>
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
    marginBottom: 28,
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
    marginBottom: 16,
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
    marginBottom: 18,
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
