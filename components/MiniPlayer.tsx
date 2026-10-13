import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { usePlayback, playbackController } from '../audio/PlaybackController';
import { useTheme, withAlpha } from '../theme/ThemeContext';

/** Slim now-playing bar pinned above the tab bar. */
export default function MiniPlayer() {
  const { currentTrack: track, isPlaying } = usePlayback();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  if (!track) return null;

  return (
    <Pressable
      onPress={() => router.push('/player')}
      style={[styles.wrap, { bottom: 88 + insets.bottom * 0.4 }]}
    >
      <View style={styles.card}>
        <View style={styles.row}>
          {track.thumbnail ? (
            <Image source={{ uri: track.thumbnail }} style={styles.art} />
          ) : (
            <View style={[styles.art, { backgroundColor: withAlpha(theme.accent, 0.2), alignItems: 'center', justifyContent: 'center' }]}>
              <Text style={{ color: theme.accent, fontSize: 18 }}>♪</Text>
            </View>
          )}
          <View style={styles.meta}>
            <Text style={styles.title} numberOfLines={1}>{track.title}</Text>
            <Text style={styles.artist} numberOfLines={1}>{track.artist}</Text>
          </View>
          <Pressable
            hitSlop={12}
            onPress={(e) => {
              e.stopPropagation();
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              void playbackController.toggle();
            }}
            style={[styles.playBtn, { backgroundColor: theme.buttonColor }]}
          >
            <Text style={styles.playGlyph}>{isPlaying ? '❚❚' : '▶'}</Text>
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12, zIndex: 50 },
  card: {
    backgroundColor: '#1f1f1f',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  row: { flexDirection: 'row', alignItems: 'center', padding: 8 },
  art: { width: 40, height: 40, borderRadius: 6 },
  meta: { flex: 1, marginLeft: 10 },
  title: { color: '#fff', fontSize: 13, fontWeight: '600' },
  artist: { color: '#b3b3b3', fontSize: 11, marginTop: 1 },
  playBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  playGlyph: { color: '#000', fontSize: 14, fontWeight: '800' },
});
