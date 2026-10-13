import React from 'react';
import { StyleSheet, View } from 'react-native';
import ThemeBackground from './ThemeBackground';

/**
 * Opaque screen root. Every screen must render inside this so stacked
 * routes can never show through each other (prevents ghosting on web
 * where expo-router keeps screens mounted in the DOM).
 */
export default function ScreenShell({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.shell}>
      <ThemeBackground />
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: '#000000',
  },
  content: {
    flex: 1,
  },
});
