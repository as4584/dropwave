import React, { useCallback, useState } from 'react';
import {
  Alert,
  Modal,
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
import GlassView from '../../components/GlassView';
import TrackRow from '../../components/TrackRow';
import { useTheme, withAlpha } from '../../theme/ThemeContext';
import {
  addTrackToPlaylist,
  createPlaylist,
  deletePlaylist,
  deleteTrack,
  listPlaylists,
  listTracks,
  IS_WEB,
  type Playlist,
  type Track,
} from '../../lib/library';
import { playbackController } from '../../audio/PlaybackController';
import ScreenShell from '../../components/ScreenShell';

export default function LibraryScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [sheetTrack, setSheetTrack] = useState<Track | null>(null);

  const refresh = useCallback(async () => {
    const [t, p] = await Promise.all([listTracks(), listPlaylists()]);
    setTracks(t);
    setPlaylists(p);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  const doCreate = async () => {
    if (!newName.trim()) return;
    await createPlaylist(newName);
    setNewName('');
    setCreating(false);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    void refresh();
  };

  const confirmDeleteTrack = (track: Track) => {
    Alert.alert('Delete track?', `"${track.title}" will be removed from your library and playlists.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void deleteTrack(track.id).then(() => refresh());
        },
      },
    ]);
  };

  const confirmDeletePlaylist = (p: Playlist) => {
    Alert.alert('Delete playlist?', `"${p.name}" will be removed. Your tracks stay in the library.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void deletePlaylist(p.id).then(() => refresh());
        },
      },
    ]);
  };

  return (
    <ScreenShell>
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.headRow}>
        <View>
          <Text style={styles.title}>Library</Text>
          <Text style={styles.sub}>
            {tracks.length} track{tracks.length === 1 ? '' : 's'} · {playlists.length} playlist
            {playlists.length === 1 ? '' : 's'}
          </Text>
        </View>
        <Pressable
          onPress={() => {
            setCreating((c) => !c);
            void Haptics.selectionAsync();
          }}
          style={[styles.newBtn, { backgroundColor: theme.buttonColor }]}
        >
          <Text style={styles.newBtnText}>+ New</Text>
        </Pressable>
      </View>

      {creating && (
        <GlassView style={styles.createCard}>
          <TextInput
            value={newName}
            onChangeText={setNewName}
            placeholder="Playlist name"
            placeholderTextColor="#6a6a6a"
            style={styles.createInput}
            autoFocus
            onSubmitEditing={doCreate}
            returnKeyType="done"
          />
          <Pressable onPress={doCreate} style={[styles.createBtn, { backgroundColor: theme.buttonColor }]}>
            <Text style={styles.newBtnText}>Create</Text>
          </Pressable>
        </GlassView>
      )}

      <Text style={styles.sectionTitle}>Playlists</Text>
      {playlists.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>No playlists yet.</Text>
          <Pressable
            onPress={() => {
              setCreating(true);
              void Haptics.selectionAsync();
            }}
            style={[styles.emptyBtn, { backgroundColor: theme.buttonColor }]}
          >
            <Text style={styles.emptyBtnText}>Create a playlist</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.grid}>
          {playlists.map((p) => (
            <Pressable
              key={p.id}
              style={styles.gridItem}
              onPress={() => router.push(`/playlist/${p.id}`)}
              onLongPress={() => confirmDeletePlaylist(p)}
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

      <Text style={styles.sectionTitle}>All tracks</Text>
      {tracks.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>Your downloads will land here.</Text>
          <Pressable
            onPress={() => router.push('/(tabs)/download')}
            style={[styles.emptyBtn, { backgroundColor: theme.buttonColor }]}
          >
            <Text style={styles.emptyBtnText}>Go to Download</Text>
          </Pressable>
        </View>
      ) : (
        tracks.map((t, i) => (
          <TrackRow
            key={t.id}
            track={t}
            onPress={async () => {
              void Haptics.selectionAsync();
              if (!IS_WEB) {
                // Native: use SQLite records with the new PlaybackController.
                const { TrackRepository } = await import('../../db/TrackRepository');
                const repo = await TrackRepository.create();
                const records = await repo.listAll(); // newest first
                const playIdx = records.findIndex((r) => r.id === t.id);
                if (playIdx >= 0) {
                  await playbackController.playTracks(records, playIdx);
                }
              } else {
                const { player } = await import('../../lib/player');
                void player.playTracks(tracks, i);
              }
            }}
            onAdd={() => setSheetTrack(t)}
            onDelete={() => confirmDeleteTrack(t)}
          />
        ))
      )}
      <View style={{ height: 140 }} />

      {/* add-to-playlist sheet */}
      <Modal visible={!!sheetTrack} transparent animationType="slide" onRequestClose={() => setSheetTrack(null)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setSheetTrack(null)}>
          <Pressable onPress={(e) => e.stopPropagation()} style={{ width: '100%' }}>
            <GlassView style={[styles.sheet, { backgroundColor: withAlpha('#0b0b12', 0.92) }]}>
              <Text style={styles.sheetTitle}>Add to playlist</Text>
              <Text style={styles.sheetSub} numberOfLines={1}>{sheetTrack?.title}</Text>
              {playlists.length === 0 && (
                <Text style={styles.emptyText}>Create a playlist first with + New.</Text>
              )}
              {playlists.map((p) => (
                <Pressable
                  key={p.id}
                  style={styles.sheetRow}
                  onPress={async () => {
                    if (sheetTrack) {
                      await addTrackToPlaylist(p.id, sheetTrack.id);
                      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    }
                    setSheetTrack(null);
                  }}
                >
                  <Text style={styles.sheetRowText}>{p.name}</Text>
                  <Text style={[styles.sheetRowText, { color: theme.accent }]}>+</Text>
                </Pressable>
              ))}
              <Pressable onPress={() => setSheetTrack(null)} style={styles.sheetCancel}>
                <Text style={[styles.sheetCancelText, { color: theme.accent }]}>Cancel</Text>
              </Pressable>
            </GlassView>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 16 },
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 },
  title: { color: '#fff', fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  sub: { color: '#b3b3b3', fontSize: 13, marginTop: 4 },
  newBtn: { borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10 },
  newBtnText: { color: '#000', fontWeight: '800', fontSize: 14 },
  createCard: { padding: 12, marginBottom: 12, flexDirection: 'row', alignItems: 'center' },
  createInput: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    backgroundColor: '#1f1f1f',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginRight: 8,
  },
  createBtn: { borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10 },
  sectionTitle: { color: '#fff', fontSize: 20, fontWeight: '700', marginTop: 8, marginBottom: 12 },
  emptyWrap: { alignItems: 'center', paddingVertical: 24 },
  emptyText: { color: '#b3b3b3', fontSize: 14, marginBottom: 12 },
  emptyBtn: { borderRadius: 24, paddingHorizontal: 20, paddingVertical: 10 },
  emptyBtnText: { color: '#000', fontWeight: '800', fontSize: 13 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6 },
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
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
    padding: 16,
  },
  sheet: { padding: 18 },
  sheetTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  sheetSub: { color: 'rgba(255,255,255,0.6)', fontSize: 13, marginTop: 2, marginBottom: 12 },
  sheetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  sheetRowText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  sheetCancel: { paddingVertical: 12, alignItems: 'center', marginTop: 6 },
  sheetCancelText: { fontSize: 15, fontWeight: '700' },
});
