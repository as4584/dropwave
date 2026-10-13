import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, View, ActivityIndicator } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ThemeProvider } from '../theme/ThemeContext';
import { runStartupSequence } from '../lib/startup';

/** On web the page itself must be dark and full-height, otherwise the
 * white html/body shows through around the app. */
function useWebPageStyle() {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const dark = '#000000';
    const html = document.documentElement;
    const body = document.body;
    html.style.backgroundColor = dark;
    html.style.height = '100%';
    body.style.backgroundColor = dark;
    body.style.height = '100%';
    body.style.margin = '0';
    const root = document.getElementById('root');
    if (root) {
      root.style.height = '100%';
      root.style.display = 'flex';
      root.style.backgroundColor = dark;
    }
  }, []);
}

export default function RootLayout() {
  useWebPageStyle();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await runStartupSequence();
      if (!cancelled) {
        if (result.errors.length > 0) {
          console.warn('[startup] errors:', result.errors);
        }
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator size="large" color="#1DB954" />
      </View>
    );
  }

  return (
    <ThemeProvider>
      <View style={styles.root}>
        <View style={styles.column}>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: '#000000' },
              animation: 'slide_from_right',
            }}
          >
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="playlist/[id]" />
            <Stack.Screen
              name="player"
              options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
            />
          </Stack>
        </View>
      </View>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  // On wide desktop viewports the app reads like the mobile app it is:
  // a centered column instead of full-bleed stretch.
  column: {
    flex: 1,
    ...(Platform.OS === 'web'
      ? { width: '100%', maxWidth: 560, alignSelf: 'center' as const }
      : null),
  },
});
