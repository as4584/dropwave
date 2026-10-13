import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import GlassView from '../../components/GlassView';
import TrackRow from '../../components/TrackRow';
import { useTheme } from '../../theme/ThemeContext';
import {
  addTrackToPlaylist,
  listPlaylists,
  listTracks,
  removeTrackFromPlaylist,
  IS_WEB,
  type Playlist,
  type Track,
} from '../../lib/library';
import { playbackController } from '../../audio/PlaybackController';
import ScreenShell from '../../components/ScreenShell';

export default function PlaylistDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [showAdd, setShowAdd] = useState(false);

  const refresh = useCallback(async () => {
    const [playlists, all] = await Promise.all([listPlaylists(), listTracks()]);
    const p = playlists.find((x) => x.id === id) ?? null;
    setPlaylist(p);
    setTracks(all);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  if (!playlist) {
    return (
      <ScreenShell>
      <View style={[styles.root, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.title}>Playlist not found</Text>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={[styles.backText, { color: theme.accent }]}>Go back</Text>
        </Pressable>
      </View>
      </ScreenShell>
    );
  }

  const inPlaylist = tracks.filter((t) => playlist.trackIds.includes(t.id));
  const notAdded = tracks.filter((t) => !playlist.trackIds.includes(t.id));

  /** Play a list of legacy Tracks via the new controller on native. */
  const playViaController = async (list: Track[], startIndex: number) => {
    if (!IS_WEB) {
      const { TrackRepository } = await import('../../db/TrackRepository');
      const repo = await TrackRepository.create();
      const records = await repo.listAll();
      const tapped = list[startIndex];
      // Build the queue from the tapped list's order, mapped to records.
      const queue = list
        .map((t) => records.find((r) => r.id === t.id))
        .filter((r): r is NonNullable<typeof r> => !!r);
      const playIdx = tapped ? queue.findIndex((r) => r.id === tapped.id) : -1;
      if (playIdx >= 0) {
        await playbackController.playTracks(queue, playIdx);
      }
    } else {
      const { player } = await import('../../lib/player');
      void player.playTracks(list, startIndex);
    }
  };

  const playAll = () => {
    if (inPlaylist.length > 0) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      void playViaController(inPlaylist, 0);
    }
  };

  return (
    <ScreenShell>
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
      showsVerticalScrollIndicator={false}
    >
      <Pressable onPress={() => router.back()} style={styles.backBtn}>
        <Text style={[styles.backText, { color: theme.accent }]}>‹ Library</Text>
      </Pressable>
      <Text style={styles.title}>{playlist.name}</Text>
      <Text style={styles.sub}>
        {inPlaylist.length} track{inPlaylist.length === 1 ? '' : 's'}
      </Text>

      {inPlaylist.length > 0 && (
        <Pressable
          onPress={playAll}
          style={[styles.playAll, { backgroundColor: theme.buttonColor }]}
        >
          <Text style={styles.playAllText}>▶ Play all</Text>
        </Pressable>
      )}

      {inPlaylist.map((t, i) => (
        <TrackRow
          key={t.id}
          track={t}
          onPress={() => playViaController(inPlaylist, i)}
          onDelete={async () => {
            await removeTrackFromPlaylist(playlist.id, t.id);
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            void refresh();
          }}
        />
      ))}

      <Pressable onPress={() => setShowAdd((s) => !s)} style={styles.addToggle}>
        <Text style={[styles.addToggleText, { color: theme.accent }]}>
          {showAdd ? 'Hide track picker' : '+ Add tracks'}
        </Text>
      </Pressable>

      {showAdd &&
        (notAdded.length === 0 ? (
          <GlassView style={styles.emptyCard}>
            <Text style={styles.emptyText}>Every track in your library is already here.</Text>
          </GlassView>
        ) : (
          notAdded.map((t) => (
            <TrackRow
              key={t.id}
              track={t}
              onPress={() => playViaController([t], 0)}
              onAdd={async () => {
                await addTrackToPlaylist(playlist.id, t.id);
                void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                void refresh();
              }}
            />
          ))
        ))}
      <View style={{ height: 140 }} />
    </ScrollView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 16 },
  content: {},
  backBtn: { paddingVertical: 8, marginBottom: 4 },
  backText: { fontSize: 15, fontWeight: '600' },
  title: { color: '#fff', fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  sub: { color: '#b3b3b3', fontSize: 14, marginTop: 4, marginBottom: 14 },
  playAll: { borderRadius: 24, paddingVertical: 13, alignItems: 'center', marginBottom: 14 },
  playAllText: { color: '#000', fontWeight: '800', fontSize: 15 },
  addToggle: { paddingVertical: 12, alignItems: 'center' },
  addToggleText: { fontSize: 14, fontWeight: '700' },
  emptyCard: { padding: 16, alignItems: 'center' },
  emptyText: { color: '#b3b3b3', fontSize: 13 },
});
