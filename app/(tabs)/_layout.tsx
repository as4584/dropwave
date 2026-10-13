import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Tabs } from 'expo-router';
import MiniPlayer from '../../components/MiniPlayer';
import { useTheme } from '../../theme/ThemeContext';

const TABS = [
  { name: 'index', title: 'Home', glyph: '⌂' },
  { name: 'download', title: 'Download', glyph: '↓' },
  { name: 'library', title: 'Library', glyph: '▤' },
  { name: 'settings', title: 'Style', glyph: '✦' },
] as const;

import type { ColorValue } from 'react-native';

function TabIcon({ glyph, focused, color }: { glyph: string; focused: boolean; color: ColorValue }) {
  return <Text style={[styles.glyph, { color, opacity: focused ? 1 : 0.65 }]}>{glyph}</Text>;
}

export default function TabsLayout() {
  const { theme } = useTheme();

  return (
    <View style={styles.root}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: theme.accent,
          tabBarInactiveTintColor: '#b3b3b3',
          tabBarStyle: styles.tabBar,
          tabBarLabelStyle: styles.tabLabel,
          sceneStyle: { backgroundColor: '#000000' },
        }}
      >
        {TABS.map((t) => (
          <Tabs.Screen
            key={t.name}
            name={t.name}
            options={{
              title: t.title,
              tabBarIcon: ({ focused, color }) => (
                <TabIcon glyph={t.glyph} focused={focused} color={color} />
              ),
            }}
          />
        ))}
      </Tabs>
      <MiniPlayer />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  tabBar: {
    backgroundColor: '#000000',
    borderTopWidth: 1,
    borderTopColor: '#282828',
    height: 84,
    paddingTop: 8,
    paddingBottom: 22,
  },
  tabLabel: { fontSize: 11, fontWeight: '600' },
  glyph: { fontSize: 22 },
});
