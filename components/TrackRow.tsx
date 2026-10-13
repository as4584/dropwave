import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { formatDuration } from '../lib/format';
import { useTheme, withAlpha } from '../theme/ThemeContext';
import type { Track } from '../lib/library';

interface TrackRowProps {
  track: Track;
  onPress: () => void;
  onAdd?: () => void;
  onDelete?: () => void;
  playing?: boolean;
}

export default function TrackRow({ track, onPress, onAdd, onDelete, playing }: TrackRowProps) {
  const { theme } = useTheme();

  return (
    <Pressable
      style={styles.row}
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
    >
      {track.thumbnail ? (
        <Image source={{ uri: track.thumbnail }} style={styles.art} />
      ) : (
        <View style={[styles.art, styles.artFallback, { backgroundColor: withAlpha(theme.accent, 0.18) }]}>
          <Text style={[styles.note, { color: theme.accent }]}>♪</Text>
        </View>
      )}
      <View style={styles.meta}>
        <Text style={[styles.title, playing && { color: theme.accent }]} numberOfLines={1}>
          {track.title}
        </Text>
        <Text style={styles.artist} numberOfLines={1}>
          {track.artist} · {formatDuration(track.durationSec)}
          {track.matchedFromYoutube ? ' · from YouTube' : ''}
        </Text>
      </View>
      {onAdd && (
        <Pressable
          hitSlop={10}
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onAdd();
          }}
          style={styles.iconBtn}
        >
          <Text style={[styles.iconText, { color: theme.accent }]}>+</Text>
        </Pressable>
      )}
      {onDelete && (
        <Pressable
          hitSlop={10}
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            onDelete();
          }}
          style={styles.iconBtn}
        >
          <Text style={[styles.iconText, { color: '#f43f5e' }]}>×</Text>
        </Pressable>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, marginBottom: 4 },
  art: { width: 56, height: 56, borderRadius: 6 },
  artFallback: { alignItems: 'center', justifyContent: 'center' },
  note: { fontSize: 24 },
  meta: { flex: 1, marginLeft: 12, marginRight: 6 },
  title: { color: '#fff', fontSize: 15, fontWeight: '600' },
  artist: { color: '#b3b3b3', fontSize: 13, marginTop: 3 },
  iconBtn: { padding: 8 },
  iconText: { fontSize: 22, fontWeight: '600' },
});
