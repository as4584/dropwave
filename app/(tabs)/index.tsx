import React, { useCallback, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import TrackRow from '../../components/TrackRow';
import { useTheme, withAlpha } from '../../theme/ThemeContext';
import { listPlaylists, listTracks, IS_WEB, type Playlist, type Track } from '../../lib/library';
import { playbackController } from '../../audio/PlaybackController';
import ScreenShell from '../../components/ScreenShell';

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Up late';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function HomeScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [url, setUrl] = useState('');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        const [t, p] = await Promise.all([listTracks(), listPlaylists()]);
        if (alive) {
          setTracks(t);
          setPlaylists(p);
        }
      })();
      return () => {
        alive = false;
      };
    }, [])
  );

  const goDownload = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({ pathname: '/(tabs)/download', params: url.trim() ? { url: url.trim() } : {} });
    setUrl('');
  };

  const playAll = async (startIndex: number) => {
    if (!IS_WEB) {
      const { TrackRepository } = await import('../../db/TrackRepository');
      const repo = await TrackRepository.create();
      const records = await repo.listAll(); // newest first
      // Map the UI index (from listTracks, newest first) to the record.
      const tapped = tracks[startIndex];
      const playIdx = tapped ? records.findIndex((r) => r.id === tapped.id) : -1;
      if (playIdx >= 0) {
        await playbackController.playTracks(records, playIdx);
      }
    } else {
      const { player } = await import('../../lib/player');
      void player.playTracks(tracks, startIndex);
    }
  };

  return (
    <ScreenShell>
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.greet}>{greeting()}</Text>

      {/* quick paste bar */}
      <View style={styles.quickBar}>
        <TextInput
          value={url}
          onChangeText={setUrl}
          placeholder="Paste a YouTube, Spotify, or Apple Music link"
          placeholderTextColor="#6a6a6a"
          style={styles.quickInput}
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={goDownload}
          returnKeyType="go"
        />
        <Pressable
          onPress={goDownload}
          style={[styles.goBtn, { backgroundColor: theme.buttonColor }]}
        >
          <Text style={styles.goText}>Go</Text>
        </Pressable>
      </View>

      {/* playlists grid */}
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>Playlists</Text>
        <Pressable onPress={() => router.push('/(tabs)/library')}>
          <Text style={[styles.seeAll, { color: theme.accent }]}>See all</Text>
        </Pressable>
      </View>
      {playlists.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>No playlists yet.</Text>
          <Pressable
            onPress={() => router.push('/(tabs)/library')}
            style={[styles.emptyBtn, { backgroundColor: theme.buttonColor }]}
          >
            <Text style={styles.emptyBtnText}>Build one in Library</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.grid}>
          {playlists.slice(0, 6).map((p) => (
            <Pressable
              key={p.id}
              style={styles.gridItem}
              onPress={() => {
                void Haptics.selectionAsync();
                router.push(`/playlist/${p.id}`);
              }}
            >
              <View style={[styles.plArt, { backgroundColor: withAlpha(theme.accent, 0.22) }]}>
                <Text style={[styles.plGlyph, { color: theme.accent }]}>♫</Text>
              </View>
              <Text style={styles.plName} numberOfLines={1}>{p.name}</Text>
              <Text style={styles.plCount}>
                {p.trackIds.length} track{p.trackIds.length === 1 ? '' : 's'}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* recent downloads */}
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>Recent downloads</Text>
      </View>
      {tracks.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>Nothing downloaded yet.</Text>
          <Pressable
            onPress={() => router.push('/(tabs)/download')}
            style={[styles.emptyBtn, { backgroundColor: theme.buttonColor }]}
          >
            <Text style={styles.emptyBtnText}>Grab your first track</Text>
          </Pressable>
        </View>
      ) : (
        tracks.slice(0, 5).map((t, i) => (
          <TrackRow key={t.id} track={t} onPress={() => playAll(i)} />
        ))
      )}
      <View style={{ height: 130 }} />
    </ScrollView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 16 },
  greet: { color: '#fff', fontSize: 30, fontWeight: '800', letterSpacing: -0.5, marginBottom: 16 },
  quickBar: { flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
  quickInput: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    backgroundColor: '#1f1f1f',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginRight: 8,
  },
  goBtn: {
    borderRadius: 24,
    paddingHorizontal: 22,
    paddingVertical: 12,
  },
  goText: { color: '#000', fontWeight: '800', fontSize: 14 },
  sectionHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    marginTop: 4,
  },
  sectionTitle: { color: '#fff', fontSize: 20, fontWeight: '700' },
  seeAll: { fontSize: 13, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6, marginBottom: 8 },
  gridItem: { width: '33.333%', padding: 6 },
  plArt: {
    aspectRatio: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  plGlyph: { fontSize: 28 },
  plName: { color: '#fff', fontSize: 13, fontWeight: '700' },
  plCount: { color: '#b3b3b3', fontSize: 11, marginTop: 2 },
  emptyWrap: { alignItems: 'center', paddingVertical: 20 },
  emptyText: { color: '#b3b3b3', fontSize: 14, marginBottom: 12 },
  emptyBtn: { borderRadius: 24, paddingHorizontal: 20, paddingVertical: 10 },
  emptyBtnText: { color: '#000', fontWeight: '800', fontSize: 13 },
});
