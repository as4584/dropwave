import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme, withAlpha } from '../theme/ThemeContext';

interface GlassViewProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** override accent for this card only */
  accent?: string;
  /** 0..100 (kept for API compatibility; no longer used) */
  intensity?: number;
}

/**
 * THE glass component. Use for cards, player controls, buttons.
 * finish === 'glossy': frosted look via semi-transparent layers, accent wash,
 *   a bright top highlight gradient, and a subtle light border.
 *   (Previously used expo-blur's BlurView, which renders as "Unimplemented
 *   component" on some builds. This version is pure JS and always works.)
 * finish === 'matte': a flat solid card, no shine.
 */
export default function GlassView({ children, style, accent }: GlassViewProps) {
  const { theme } = useTheme();
  const tint = accent ?? theme.accent;

  if (theme.finish === 'matte') {
    return (
      <View
        style={[
          styles.base,
          styles.matteCard,
          style,
        ]}
      >
        {children}
      </View>
    );
  }

  return (
    <View style={[styles.base, styles.glossyCard, style]}>
      {/* frosted base: semi-transparent dark */}
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(28,28,32,0.72)' }]}
      />
      {/* accent wash */}
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: withAlpha(tint, 0.16) }]}
      />
      {/* top highlight for the glossy look */}
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(255,255,255,0.22)', 'rgba(255,255,255,0.0)']}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 0.45 }}
        style={[StyleSheet.absoluteFill, { borderRadius: 20 }]}
      />
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          styles.border,
          { borderColor: withAlpha('#ffffff', 0.18) },
        ]}
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 20,
    overflow: 'hidden',
  },
  matteCard: {
    backgroundColor: '#181818',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  glossyCard: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  border: {
    borderRadius: 20,
    borderWidth: 1,
  },
});
