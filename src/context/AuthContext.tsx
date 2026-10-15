import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { notificationsStore } from '@/services/notificationsService';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  loading: true,
  signOut: async () => {},
});

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let isMounted = true;

    // 1. Retrieve initial session from SecureStore on startup
    const getInitialSession = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) {
          console.warn('[CampusFind Auth] Error fetching initial session:', error.message);
        }
        if (isMounted) {
          setSession(data.session ?? null);
        }
      } catch (err) {
        console.warn('[CampusFind Auth] Unexpected error fetching session:', err);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    getInitialSession();

    // 2. Listen to real-time auth state changes (login, logout, token refresh)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      if (isMounted) {
        setSession(currentSession);
        setLoading(false);
      }
    });

    // 3. Unsubscribe listener on unmount
    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    try {
      setLoading(true);
      notificationsStore.clear();
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.warn('[CampusFind Auth] Sign out error:', error.message);
      }
    } catch (err) {
      console.warn('[CampusFind Auth] Unexpected error during sign out:', err);
    } finally {
      setLoading(false);
    }
  };

  const value: AuthContextType = {
    session,
    user: session?.user ?? null,
    loading,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Hook to access session and user state throughout the application.
 */
export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
