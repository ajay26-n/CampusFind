import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import * as Linking from 'expo-linking';

import { supabase } from '@/lib/supabase';

export default function AuthCallbackScreen() {
  const params = useLocalSearchParams<{
    code?: string;
    error?: string;
    error_description?: string;
  }>();

  const [isLoading, setIsLoading] = useState(true);
  const [isSuccess, setIsSuccess] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const processAuthConfirmation = async () => {
      // 1. Check for URL error params passed directly by Supabase
      if (params.error) {
        if (isMounted) {
          setIsLoading(false);
          setErrorMessage(params.error_description || params.error || 'Verification link is invalid or has expired.');
        }
        return;
      }

      // 2. PKCE flow: Exchange authorization code for session
      if (params.code) {
        try {
          const { data, error } = await supabase.auth.exchangeCodeForSession(params.code);
          if (!error && (data.session || data.user)) {
            if (isMounted) {
              setIsLoading(false);
              setIsSuccess(true);
              setHasSession(Boolean(data.session));
            }
            return;
          }
        } catch {
          // Fall through to inspect raw URL / current session
        }
      }

      // 3. Implicit flow: Inspect raw URL for access_token & refresh_token in hash or search query
      try {
        const initialUrl = await Linking.getInitialURL();
        if (initialUrl && (initialUrl.includes('access_token=') || initialUrl.includes('code='))) {
          const fragment = initialUrl.includes('#')
            ? initialUrl.split('#')[1]
            : initialUrl.includes('?')
            ? initialUrl.split('?')[1]
            : '';

          const searchParams = new URLSearchParams(fragment);
          const accessToken = searchParams.get('access_token');
          const refreshToken = searchParams.get('refresh_token');

          if (accessToken && refreshToken) {
            const { data, error } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });

            if (!error && data.session) {
              if (isMounted) {
                setIsLoading(false);
                setIsSuccess(true);
                setHasSession(true);
              }
              return;
            }
          }
        }
      } catch {
        // Fall through to session query
      }

      // 4. Verify existing authenticated session state
      try {
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          if (isMounted) {
            setIsLoading(false);
            setIsSuccess(true);
            setHasSession(true);
          }
          return;
        }

        // 5. Check if user is logged in
        const { data: userData } = await supabase.auth.getUser();
        if (userData?.user?.email_confirmed_at) {
          if (isMounted) {
            setIsLoading(false);
            setIsSuccess(true);
            setHasSession(true);
          }
          return;
        }
      } catch {
        // Fall through
      }

      // If we reach here, email may have been confirmed on server, but user needs to sign in
      if (isMounted) {
        setIsLoading(false);
        setIsSuccess(true);
        setHasSession(false);
      }
    };

    processAuthConfirmation();

    return () => {
      isMounted = false;
    };
  }, [params]);

  const handleContinue = () => {
    if (hasSession) {
      router.replace('/');
    } else {
      router.replace('/auth/login');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.card}>
        {isLoading ? (
          <>
            <ActivityIndicator size="large" color="#38BDF8" style={styles.spinner} />
            <Text style={styles.title}>Verifying Email...</Text>
            <Text style={styles.subtitle}>
              Confirming your official Builders College account. Please wait a moment.
            </Text>
          </>
        ) : isSuccess ? (
          <>
            <View style={styles.successIconCircle}>
              <Text style={styles.successEmoji}>🎉</Text>
            </View>
            <Text style={styles.title}>Email Verified!</Text>
            <Text style={styles.subtitle}>
              Your college email has been verified. Welcome to CampusFind!
            </Text>
            <View style={styles.domainPill}>
              <Text style={styles.domainText}>✓ Verified @builderscollege.edu.in</Text>
            </View>

            <Pressable
              style={({ pressed }) => [styles.primaryButton, { opacity: pressed ? 0.9 : 1 }]}
              onPress={handleContinue}
            >
              <Text style={styles.primaryButtonText}>
                {hasSession ? 'Proceed to CampusFind →' : 'Sign In to Your Account →'}
              </Text>
            </Pressable>
          </>
        ) : (
          <>
            <View style={styles.errorIconCircle}>
              <Text style={styles.errorEmoji}>⚠️</Text>
            </View>
            <Text style={styles.errorTitle}>Verification Failed</Text>
            <Text style={styles.subtitle}>
              {errorMessage || 'This email confirmation link is invalid or has already been used.'}
            </Text>

            <Pressable
              style={({ pressed }) => [styles.primaryButton, { opacity: pressed ? 0.9 : 1 }]}
              onPress={() => router.replace('/auth/login')}
            >
              <Text style={styles.primaryButtonText}>Return to Sign In</Text>
            </Pressable>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B0F17',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#131B2E',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#1E293B',
    padding: 28,
    alignItems: 'center',
    width: '100%',
    maxWidth: 400,
  },
  spinner: {
    marginBottom: 20,
  },
  successIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderWidth: 1.5,
    borderColor: 'rgba(16, 185, 129, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  successEmoji: {
    fontSize: 32,
  },
  errorIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(244, 63, 94, 0.12)',
    borderWidth: 1.5,
    borderColor: 'rgba(244, 63, 94, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  errorEmoji: {
    fontSize: 32,
  },
  title: {
    color: '#F8FAFC',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.3,
    marginBottom: 8,
    textAlign: 'center',
  },
  errorTitle: {
    color: '#FB7185',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    color: '#94A3B8',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 20,
  },
  domainPill: {
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    borderColor: 'rgba(56, 189, 248, 0.3)',
    borderWidth: 1,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 24,
  },
  domainText: {
    color: '#38BDF8',
    fontSize: 12.5,
    fontWeight: '700',
  },
  primaryButton: {
    width: '100%',
    backgroundColor: '#38BDF8',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: '#0B0F17',
    fontSize: 14.5,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
});
