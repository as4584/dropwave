import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { GRADIENT_PRESETS, useTheme } from '../theme/ThemeContext';
import { getCustomBackground } from '../lib/library';

/** Full-screen background behind every screen, driven by the theme. */
export default function ThemeBackground() {
  const { theme } = useTheme();
  const [customUri, setCustomUri] = useState<string | null>(null);

  useEffect(() => {
    if (theme.background.type === 'image') {
      getCustomBackground().then(setCustomUri).catch(() => setCustomUri(null));
    }
  }, [theme.background]);

  if (theme.background.type === 'image' && customUri) {
    return (
      <View style={StyleSheet.absoluteFill}>
        <Image source={{ uri: customUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        {/* darken so text stays readable */}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.55)' }]} />
      </View>
    );
  }

  if (theme.background.type === 'color') {
    return <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.background.value }]} />;
  }

  const preset = GRADIENT_PRESETS[theme.background.value] ?? GRADIENT_PRESETS.midnight;
  return (
    <LinearGradient
      colors={preset.colors}
      start={{ x: 0.2, y: 0 }}
      end={{ x: 0.8, y: 1 }}
      style={StyleSheet.absoluteFill}
    />
  );
}
