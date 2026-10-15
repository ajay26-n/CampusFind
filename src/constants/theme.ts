/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#0F172A', // slate-900
    background: '#F8FAFC', // slate-50 canvas
    backgroundElement: '#FFFFFF', // crisp white card
    backgroundSelected: '#EFF6FF', // blue-50 highlight
    textSecondary: '#64748B', // slate-500
    primary: '#1E3A8A', // deep navy
    primaryAccent: '#2563EB', // cobalt blue
    border: '#E2E8F0', // slate-200
    borderStrong: '#CBD5E1', // slate-300
    lost: '#DC2626', // red-600
    lostSurface: '#FEF2F2',
    found: '#16A34A', // green-600
    foundSurface: '#F0FDF4',
    card: '#FFFFFF',
    surfaceSubtle: '#F1F5F9',
  },
  dark: {
    text: '#F8FAFC', // slate-50
    background: '#0A0F1D', // deep midnight canvas
    backgroundElement: '#10192E', // deep navy elevated card
    backgroundSelected: '#1E2B4D', // active navy highlight
    textSecondary: '#94A3B8', // slate-400
    primary: '#3B82F6', // vibrant cobalt blue
    primaryAccent: '#60A5FA', // sky highlight
    border: '#1E293B', // slate-800
    borderStrong: '#334155', // slate-700
    lost: '#EF4444', // red-500
    lostSurface: 'rgba(239, 68, 68, 0.15)',
    found: '#10B981', // emerald-500
    foundSurface: 'rgba(16, 185, 129, 0.15)',
    card: '#10192E',
    surfaceSubtle: '#17223D',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
