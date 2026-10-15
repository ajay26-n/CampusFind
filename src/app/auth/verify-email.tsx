import React, { useState, useEffect } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import * as Linking from 'expo-linking';

import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';

export default function VerifyEmailScreen() {
  const params = useLocalSearchParams<{ email?: string; returnUrl?: string; type?: string }>();
  const email = params.email || '';
  const returnUrl = params.returnUrl || '/';

  const { user } = useAuth();
  const [isResending, setIsResending] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  // Auto-detect if user becomes confirmed while this screen is open
  useEffect(() => {
    if (user && user.email_confirmed_at) {
      Alert.alert('Email Verified! 🎉', 'Your college account is now active.', [
        {
          text: 'Continue',
          onPress: () => {
            if (params.type && returnUrl === '/report') {
              router.replace({ pathname: '/report', params: { type: params.type } });
            } else {
              router.replace(returnUrl as any);
            }
          },
        },
      ]);
    }
  }, [user]);

  // Cooldown timer
  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const timer = setInterval(() => {
      setCooldownSeconds((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldownSeconds]);

  /**
   * Resends the confirmation link email to the student's college address.
   */
  const handleResend = async () => {
    if (!email || cooldownSeconds > 0 || isResending) return;

    setIsResending(true);
    const emailRedirectTo = Linking.createURL('auth/callback');

    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: email.trim().toLowerCase(),
        options: {
          emailRedirectTo,
        },
      });

      if (error) {
        Alert.alert('Could Not Resend', error.message || 'Please wait before requesting another confirmation email.');
        return;
      }

      setCooldownSeconds(60);
      Alert.alert(
        'Confirmation Email Sent ✉️',
        `A fresh verification link has been sent to ${email}. Please check your inbox and junk/spam folder.`
      );
    } catch {
      Alert.alert('Error', 'Unable to reach the server. Please check your internet connection.');
    } finally {
      setIsResending(false);
    }
  };

  /**
   * Manually checks if the email has been confirmed on the server
   * (e.g. if the user clicked the link in their web browser).
   */
  const handleCheckStatus = async () => {
    if (isChecking) return;
    setIsChecking(true);

    try {
      // 1. Check existing session
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData.session?.user?.email_confirmed_at) {
        Alert.alert('Verified! 🎉', 'Your college account is confirmed. Welcome to CampusFind!', [
          {
            text: 'Proceed to CampusFind',
            onPress: () => {
              if (params.type && returnUrl === '/report') {
                router.replace({ pathname: '/report', params: { type: params.type } });
              } else {
                router.replace(returnUrl as any);
              }
            },
          },
        ]);
        return;
      }

      // 2. If no active session, direct user to Sign In
      router.push({
        pathname: '/auth/login',
        params: { returnUrl, type: params.type },
      });
    } catch {
      router.push({
        pathname: '/auth/login',
        params: { returnUrl, type: params.type },
      });
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Animated Icon Header */}
        <View style={styles.iconCircle}>
          <Text style={styles.envelopeIcon}>📩</Text>
        </View>

        <Text style={styles.title}>Check Your Inbox</Text>
        <Text style={styles.subtitle}>
          We sent a verification link to your official college email:
        </Text>

        <View style={styles.emailCard}>
          <Text style={styles.emailText} numberOfLines={1}>
            {email || 'your-college-email@builderscollege.edu.in'}
          </Text>
        </View>

        {/* Step-by-Step Guidance Box */}
        <View style={styles.instructionBox}>
          <View style={styles.instructionStep}>
            <Text style={styles.stepNumber}>1</Text>
            <Text style={styles.stepText}>Open your Builders College email inbox.</Text>
          </View>
          <View style={styles.instructionStep}>
            <Text style={styles.stepNumber}>2</Text>
            <Text style={styles.stepText}>
              Locate the email from CampusFind (check Spam or Junk folder if not found).
            </Text>
          </View>
          <View style={styles.instructionStep}>
            <Text style={styles.stepNumber}>3</Text>
            <Text style={styles.stepText}>
              Tap the confirmation link in the email to activate your account.
            </Text>
          </View>
        </View>

        {/* Primary Action: Check status / Proceed */}
        <Pressable
          style={({ pressed }) => [styles.primaryButton, { opacity: pressed ? 0.9 : 1 }]}
          onPress={handleCheckStatus}
          disabled={isChecking}
        >
          {isChecking ? (
            <ActivityIndicator size="small" color="#0B0F17" />
          ) : (
            <Text style={styles.primaryButtonText}>I've Verified — Proceed to Sign In</Text>
          )}
        </Pressable>

        {/* Secondary Action: Resend with Cooldown */}
        <Pressable
          style={({ pressed }) => [
            styles.secondaryButton,
            (isResending || cooldownSeconds > 0) && styles.buttonDisabled,
            { opacity: pressed && cooldownSeconds === 0 ? 0.8 : 1 },
          ]}
          onPress={handleResend}
          disabled={isResending || cooldownSeconds > 0}
        >
          {isResending ? (
            <ActivityIndicator size="small" color="#38BDF8" />
          ) : (
            <Text style={styles.secondaryButtonText}>
              {cooldownSeconds > 0
                ? `Resend link available in ${cooldownSeconds}s`
                : 'Resend Confirmation Email'}
            </Text>
          )}
        </Pressable>

        {/* Navigation Links */}
        <View style={styles.navLinksContainer}>
          <Pressable
            style={({ pressed }) => [styles.navLink, { opacity: pressed ? 0.7 : 1 }]}
            onPress={() =>
              router.replace({
                pathname: '/auth/register',
                params: { returnUrl, type: params.type },
              })
            }
          >
            <Text style={styles.navLinkText}>Wrong email? Edit registration</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.navLink, { opacity: pressed ? 0.7 : 1 }]}
            onPress={() => router.replace('/')}
          >
            <Text style={styles.navLinkMuted}>← Return to Home as Guest</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0B0F17',
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 40,
    paddingBottom: 40,
    alignItems: 'center',
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
    borderWidth: 1.5,
    borderColor: 'rgba(56, 189, 248, 0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  envelopeIcon: {
    fontSize: 36,
  },
  title: {
    color: '#F8FAFC',
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    color: '#94A3B8',
    fontSize: 13.5,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 16,
  },
  emailCard: {
    backgroundColor: '#131B2E',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#38BDF8',
    marginBottom: 24,
    maxWidth: '100%',
  },
  emailText: {
    color: '#38BDF8',
    fontSize: 14,
    fontWeight: '700',
  },
  instructionBox: {
    width: '100%',
    backgroundColor: '#131B2E',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1E293B',
    padding: 18,
    marginBottom: 24,
    gap: 14,
  },
  instructionStep: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  stepNumber: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#1E293B',
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 22,
  },
  stepText: {
    flex: 1,
    color: '#CBD5E1',
    fontSize: 13,
    lineHeight: 18,
  },
  primaryButton: {
    width: '100%',
    backgroundColor: '#38BDF8',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  primaryButtonText: {
    color: '#0B0F17',
    fontSize: 14.5,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  secondaryButton: {
    width: '100%',
    backgroundColor: '#131B2E',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  secondaryButtonText: {
    color: '#94A3B8',
    fontSize: 13.5,
    fontWeight: '600',
  },
  navLinksContainer: {
    alignItems: 'center',
    gap: 12,
    marginTop: 6,
  },
  navLink: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  navLinkText: {
    color: '#38BDF8',
    fontSize: 13,
    fontWeight: '600',
  },
  navLinkMuted: {
    color: '#64748B',
    fontSize: 12.5,
    fontWeight: '500',
  },
});
