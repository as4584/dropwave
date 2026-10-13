import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type BackgroundType = 'gradient' | 'color' | 'image';

export interface ThemeState {
  accent: string;
  background: { type: BackgroundType; value: string };
  buttonColor: string;
  finish: 'glossy' | 'matte';
}

export const GRADIENT_PRESETS: Record<string, { name: string; colors: [string, string, string] }> = {
  midnight: { name: 'Midnight', colors: ['#0b0b12', '#141422', '#1e1b2e'] },
  grape: { name: 'Grape', colors: ['#12081f', '#241040', '#3b1a63'] },
  ocean: { name: 'Ocean', colors: ['#04121f', '#0a2a40', '#0e3d5c'] },
  sunset: { name: 'Sunset', colors: ['#1f0a08', '#3d1408', '#5c2408'] },
  forest: { name: 'Forest', colors: ['#08120c', '#102418', '#1a3d24'] },
};

export const ACCENT_SWATCHES = [
  '#8b5cf6', '#a855f7', '#ec4899', '#f43f5e', '#f97316',
  '#facc15', '#22c55e', '#14b8a6', '#38bdf8', '#6366f1',
];

export const DEFAULT_THEME: ThemeState = {
  accent: '#1DB954',
  background: { type: 'color', value: '#000000' },
  buttonColor: '#1DB954',
  finish: 'matte',
};

/** Increment this when DEFAULT_THEME changes so users pick up the new defaults. */
const STORAGE_KEY = 'dropwave:theme:v2';

interface ThemeContextValue {
  theme: ThemeState;
  setTheme: (patch: Partial<ThemeState>) => void;
  setBackground: (type: BackgroundType, value: string) => void;
  loaded: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeState>(DEFAULT_THEME);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const saved = JSON.parse(raw);
          setThemeState({ ...DEFAULT_THEME, ...saved });
        }
      } catch {
        // corrupted storage, fall back to defaults
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(theme)).catch(() => {});
  }, [theme, loaded]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      loaded,
      setTheme: (patch) => setThemeState((t) => ({ ...t, ...patch })),
      setBackground: (type, v) =>
        setThemeState((t) => ({ ...t, background: { type, value: v } })),
    }),
    [theme, loaded]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}

/** Lighten/darken a hex color by amount (-1..1). Used for subtle UI shading. */
export function shade(hex: string, amount: number): string {
  const n = hex.replace('#', '');
  const num = parseInt(
    n.length === 3 ? n.split('').map((c) => c + c).join('') : n,
    16
  );
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp((num >> 16) + 255 * amount);
  const g = clamp(((num >> 8) & 0xff) + 255 * amount);
  const b = clamp((num & 0xff) + 255 * amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/** Hex + alpha (0..1) to rgba() string for translucent overlays. */
export function withAlpha(hex: string, alpha: number): string {
  const n = hex.replace('#', '');
  const full = n.length === 3 ? n.split('').map((c) => c + c).join('') : n;
  const num = parseInt(full, 16);
  const r = num >> 16;
  const g = (num >> 8) & 0xff;
  const b = num & 0xff;
  return `rgba(${r},${g},${b},${alpha})`;
}
