import React, { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { playbackController, usePlayback } from '../audio/PlaybackController';
import type { TrackRecord } from '../db/TrackRepository';
import { useTheme, withAlpha } from '../theme/ThemeContext';
import { formatDuration } from '../lib/format';
import ScreenShell from '../components/ScreenShell';

function SeekBar() {
  const { positionSec, durationSec } = usePlayback();
  const { theme } = useTheme();
  const [width, setWidth] = useState(0);
  const dur = durationSec ?? 0;
  const ratio = dur > 0 ? Math.min(1, positionSec / dur) : 0;

  return (
    <Pressable
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      onPress={(e) => {
        if (width > 0 && dur > 0) {
          void playbackController.seekTo((e.nativeEvent.locationX / width) * dur);
          void Haptics.selectionAsync();
        }
      }}
      style={styles.seekHit}
    >
      <View style={styles.seekTrack}>
        <View
          style={[styles.seekFill, { width: `${ratio * 100}%`, backgroundColor: theme.accent }]}
        />
      </View>
      <View style={styles.times}>
        <Text style={styles.time}>{formatDuration(positionSec)}</Text>
        <Text style={styles.time}>{formatDuration(dur || null)}</Text>
      </View>
    </Pressable>
  );
}

function ControlBtn({
  glyph,
  onPress,
  big,
  active,
}: {
  glyph: string;
  onPress: () => void;
  big?: boolean;
  active?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      onPress={() => {
        void Haptics.impactAsync(
          big ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light
        );
        onPress();
      }}
      style={[
        big ? styles.bigBtn : styles.smallBtn,
        big && { backgroundColor: theme.buttonColor },
        !big && active && { backgroundColor: withAlpha(theme.accent, 0.25) },
      ]}
    >
      <Text style={[big ? styles.bigGlyph : styles.smallGlyph, active && { color: theme.accent }]}>
        {glyph}
      </Text>
    </Pressable>
  );
}

export default function PlayerScreen() {
  const { currentTrack: track, isPlaying, shuffleEnabled: shuffle } = usePlayback();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [queue, setQueue] = useState<TrackRecord[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [q, idx] = await Promise.all([
        playbackController.getQueueTracks(),
        playbackController.getCurrentQueueIndex(),
      ]);
      if (!cancelled) {
        setQueue(q);
        setCurrentIndex(idx);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [track?.id]);

  if (!track) {
    return (
      <ScreenShell>
      <View style={[styles.root, { paddingTop: insets.top + 16 }]}>
        <Pressable onPress={() => router.back()} style={styles.closeBtn}>
          <Text style={[styles.closeText, { color: theme.accent }]}>Close</Text>
        </Pressable>
        <Text style={styles.empty}>Nothing is playing right now.</Text>
      </View>
      </ScreenShell>
    );
  }

  return (
    <ScreenShell>
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 8 }]}
      showsVerticalScrollIndicator={false}
    >
      <Pressable onPress={() => router.back()} style={styles.closeBtn}>
        <Text style={[styles.closeText, { color: theme.accent }]}>⌄ Close</Text>
      </Pressable>

      <View style={styles.artWrap}>
        {track.thumbnail ? (
          <Image source={{ uri: track.thumbnail }} style={styles.art} resizeMode="cover" />
        ) : (
          <View style={[styles.art, styles.artFallback, { backgroundColor: withAlpha(theme.accent, 0.18) }]}>
            <Text style={[styles.artGlyph, { color: theme.accent }]}>♪</Text>
          </View>
        )}
      </View>

      <Text style={styles.title} numberOfLines={2}>{track.title}</Text>
      <Text style={styles.artist} numberOfLines={1}>{track.artist}</Text>
      {track.matchedFromYoutube && (
        <Text style={styles.matchNote}>Matched from YouTube</Text>
      )}

      <SeekBar />

      <View style={styles.controls}>
        <ControlBtn glyph="⇄" active={shuffle} onPress={() => playbackController.toggleShuffle()} />
        <ControlBtn glyph="⏮" onPress={() => playbackController.prev()} />
        <ControlBtn glyph={isPlaying ? '❚❚' : '▶'} big onPress={() => playbackController.toggle()} />
        <ControlBtn glyph="⏭" onPress={() => playbackController.next()} />
      </View>

      <Text style={styles.queueTitle}>Up next</Text>
      {queue.slice(currentIndex + 1, currentIndex + 6).map((t) => (
        <Pressable
          key={t.id}
          style={styles.qRow}
          onPress={() => {
            const qi = queue.findIndex((x) => x.id === t.id);
            if (qi >= 0) void playbackController.playTracks(queue, qi);
          }}
        >
          <Text style={styles.qTitle} numberOfLines={1}>{t.title}</Text>
          <Text style={styles.qArtist} numberOfLines={1}>{t.artist}</Text>
        </Pressable>
      ))}
      {queue.length <= 1 && <Text style={styles.empty}>This is the only track in the queue.</Text>}
      <View style={{ height: 60 }} />
    </ScrollView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 20 },
  content: { alignItems: 'stretch' },
  closeBtn: { alignSelf: 'flex-start', paddingVertical: 10 },
  closeText: { fontSize: 16, fontWeight: '700' },
  empty: { color: '#b3b3b3', fontSize: 14, textAlign: 'center', marginTop: 40 },
  artWrap: { marginTop: 8 },
  art: { width: '100%', aspectRatio: 1, borderRadius: 8 },
  artFallback: { alignItems: 'center', justifyContent: 'center' },
  artGlyph: { fontSize: 72 },
  title: { color: '#fff', fontSize: 24, fontWeight: '800', marginTop: 20, letterSpacing: -0.5 },
  artist: { color: '#b3b3b3', fontSize: 16, marginTop: 4 },
  matchNote: { color: '#6a6a6a', fontSize: 12, marginTop: 6 },
  seekHit: { marginTop: 20, paddingVertical: 8 },
  seekTrack: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', overflow: 'hidden' },
  seekFill: { height: 4, borderRadius: 2 },
  times: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  time: { color: '#b3b3b3', fontSize: 12 },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
    paddingHorizontal: 6,
  },
  smallBtn: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  smallGlyph: { color: 'rgba(255,255,255,0.85)', fontSize: 22 },
  bigBtn: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
  bigGlyph: { color: '#000', fontSize: 30 },
  queueTitle: { color: '#fff', fontSize: 17, fontWeight: '700', marginTop: 26, marginBottom: 10 },
  qRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  qTitle: { color: '#fff', fontSize: 14, fontWeight: '600' },
  qArtist: { color: '#b3b3b3', fontSize: 12, marginTop: 2 },
});
