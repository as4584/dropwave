import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import GlassView from '../../components/GlassView';
import { useTheme, withAlpha } from '../../theme/ThemeContext';
import { downloadUrl, probeUrl, type ProbeResult } from '../../lib/api';
import { formatBytes, formatDuration } from '../../lib/format';
import { IS_WEB, setWebBlobUrl, type Track } from '../../lib/library';
import { playbackController } from '../../audio/PlaybackController';
import { downloadManager } from '../../downloads/DownloadManager';
import type { TrackRecord } from '../../db/TrackRepository';
import ScreenShell from '../../components/ScreenShell';

type Phase = 'idle' | 'probing' | 'ready' | 'downloading' | 'done';

function sanitize(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 100) || 'track';
}

/** Web: stream the file with real progress, trigger the browser download,
 * and keep a blob URL so the track plays in this session. */
async function downloadOnWeb(
  dlUrl: string,
  filename: string,
  trackId: string,
  onProgress: (ratio: number) => void
): Promise<void> {
  const res = await fetch(dlUrl);
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
  const total = Number(res.headers.get('Content-Length')) || 0;
  const reader = res.body.getReader();
  const chunks: BlobPart[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total > 0) onProgress(received / total);
  }
  const blob = new Blob(chunks, { type: 'audio/mp4' });
  const objUrl = URL.createObjectURL(blob);
  setWebBlobUrl(trackId, objUrl);
  const a = document.createElement('a');
  a.href = objUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  onProgress(1);
}

const SOURCE_LABEL: Record<string, string> = {
  youtube: 'YouTube',
  spotify: 'Spotify link',
  apple: 'Apple Music link',
};

export default function DownloadScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ url?: string }>();

  const [url, setUrl] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [qualityId, setQualityId] = useState('q320');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [savedTrack, setSavedTrack] = useState<Track | null>(null);
  const autoProbed = useRef(false);

  useEffect(() => {
    if (params.url && !autoProbed.current) {
      autoProbed.current = true;
      const u = String(params.url);
      setUrl(u);
      void runProbe(u);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.url]);

  const paste = async () => {
    const text = await Clipboard.getStringAsync();
    if (text) setUrl(text.trim());
  };

  const runProbe = async (target?: string) => {
    const u = (target ?? url).trim();
    if (!u) return;
    setPhase('probing');
    setError(null);
    setProbe(null);
    setSavedTrack(null);
    setProgress(0);
    try {
      const result = await probeUrl(u);
      setProbe(result);
      setQualityId('q320');
      setPhase('ready');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Probe failed');
      setPhase('idle');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const runDownload = async () => {
    if (!probe) return;
    const quality = probe.qualities.find((q) => q.id === qualityId) ?? probe.qualities[2];
    setPhase('downloading');
    setError(null);
    setProgress(0);
    try {
      if (IS_WEB) {
        // Web: use the legacy blob-based download (no SQLite/filesystem).
        const { makeTrackId, saveTrack, TRACKS_DIR } = await import('../../lib/library');
        const trackId = await makeTrackId();
        const base = sanitize(`${probe.artist} - ${probe.title}`);
        const filename = `${base}.${quality.ext}`;
        await downloadOnWeb(downloadUrl(url.trim(), quality.id, probe.resolvedUrl), filename, trackId, setProgress);
        const track: Track = {
          id: trackId,
          title: probe.title,
          artist: probe.artist,
          durationSec: probe.durationSec,
          filename,
          quality: quality.label,
          source: probe.source,
          matchedFromYoutube: probe.matchedFromYoutube,
          thumbnail: probe.thumbnail,
          addedAt: Date.now(),
        };
        await saveTrack(track);
        setSavedTrack(track);
      } else {
        // Native: use the durable DownloadManager (staging → validate → publish → SQLite).
        const unsubscribe = downloadManager.onProgress((p) => {
          if (p.bytesExpected && p.bytesExpected > 0) {
            setProgress(p.bytesReceived / p.bytesExpected);
          }
        });
        try {
          const trackId = await downloadManager.download({
            sourceUrl: url.trim(),
            resolvedUrl: probe.resolvedUrl,
            quality: quality.id,
            title: probe.title,
            artist: probe.artist,
            durationSec: probe.durationSec,
            thumbnail: probe.thumbnail,
            source: probe.source,
            matchedFromYoutube: probe.matchedFromYoutube,
          });
          const { TrackRepository } = await import('../../db/TrackRepository');
          const repo = await TrackRepository.create();
          const record = await repo.getById(trackId);
          if (record) {
            // Convert TrackRecord to legacy Track for the UI.
            setSavedTrack({
              id: record.id,
              title: record.title,
              artist: record.artist,
              durationSec: record.durationSec,
              filename: record.filename,
              quality: record.quality,
              source: record.source as any,
              matchedFromYoutube: record.matchedFromYoutube,
              thumbnail: record.thumbnail,
              addedAt: record.addedAt,
            });
          }
        } finally {
          unsubscribe();
        }
      }
      setPhase('done');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed');
      setPhase('ready');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const reset = () => {
    setPhase('idle');
    setProbe(null);
    setError(null);
    setSavedTrack(null);
    setProgress(0);
    setUrl('');
  };

  return (
    <ScreenShell>
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Grab a track</Text>
      <Text style={styles.sub}>Paste a link, pick a quality, keep the file.</Text>

      <GlassView style={styles.pasteCard}>
        <TextInput
          value={url}
          onChangeText={setUrl}
          placeholder="https://..."
          placeholderTextColor="#6a6a6a"
          style={styles.input}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          onSubmitEditing={() => runProbe()}
          returnKeyType="go"
        />
        <View style={styles.pasteRow}>
          <Pressable onPress={paste} style={styles.pasteBtn}>
            <Text style={[styles.pasteText, { color: theme.accent }]}>Paste from clipboard</Text>
          </Pressable>
          <Pressable
            onPress={() => runProbe()}
            disabled={phase === 'probing' || !url.trim()}
            style={[
              styles.probeBtn,
              { backgroundColor: theme.buttonColor, opacity: !url.trim() ? 0.4 : 1 },
            ]}
          >
            {phase === 'probing' ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.probeText}>Look up</Text>
            )}
          </Pressable>
        </View>
      </GlassView>

      {error && (
        <GlassView style={[styles.errorCard, { borderColor: 'rgba(244,63,94,0.4)' }]}>
          <Text style={styles.errorText}>{error}</Text>
        </GlassView>
      )}

      {probe && (phase === 'ready' || phase === 'downloading' || phase === 'done') && (
        <GlassView style={styles.resultCard}>
          <View style={styles.resultRow}>
            {probe.thumbnail ? (
              <Image source={{ uri: probe.thumbnail }} style={styles.thumb} />
            ) : (
              <View style={[styles.thumb, styles.thumbFallback, { backgroundColor: withAlpha(theme.accent, 0.25) }]}>
                <Text style={styles.noteGlyph}>♪</Text>
              </View>
            )}
            <View style={styles.resultMeta}>
              <Text style={styles.resultTitle} numberOfLines={2}>{probe.title}</Text>
              <Text style={styles.resultArtist} numberOfLines={1}>
                {probe.artist} · {formatDuration(probe.durationSec)}
              </Text>
              <View style={[styles.badge, { backgroundColor: withAlpha(theme.accent, 0.2) }]}>
                <Text style={[styles.badgeText, { color: theme.accent }]}>
                  {SOURCE_LABEL[probe.source] ?? probe.source}
                </Text>
              </View>
            </View>
          </View>
          {probe.matchedFromYoutube && (
            <Text style={styles.matchNote}>
              Matched from YouTube. {probe.source === 'spotify' ? 'Spotify' : 'Apple Music'} audio
              is DRM locked, so we read the track info from your link and grab the matching
              audio from YouTube.
            </Text>
          )}

          <Text style={styles.qualityTitle}>Audio quality</Text>
          {probe.qualities.map((q) => {
            const selected = q.id === qualityId;
            return (
              <Pressable
                key={q.id}
                onPress={() => {
                  setQualityId(q.id);
                  void Haptics.selectionAsync();
                }}
                style={[
                  styles.qRow,
                  {
                    borderColor: selected ? theme.accent : 'rgba(255,255,255,0.12)',
                    backgroundColor: selected ? withAlpha(theme.accent, 0.18) : 'transparent',
                  },
                ]}
              >
                <Text style={[styles.qLabel, selected && { color: theme.accent }]}>{q.label}</Text>
                <Text style={styles.qSize}>{formatBytes(q.estBytes)}</Text>
              </Pressable>
            );
          })}

          {phase === 'downloading' ? (
            <View style={styles.progressWrap}>
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${Math.round(progress * 100)}%`, backgroundColor: theme.accent },
                  ]}
                />
              </View>
              <Text style={styles.progressText}>{Math.round(progress * 100)}%</Text>
            </View>
          ) : phase === 'done' && savedTrack ? (
            <View>
              <View style={[styles.doneRow, { backgroundColor: withAlpha('#22c55e', 0.15) }]}>
                <Text style={styles.doneText}>Saved to your library as {savedTrack.quality}.</Text>
              </View>
              <View style={styles.doneBtns}>
                <Pressable
                  onPress={async () => {
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    // Load the track from SQLite (native) or use the saved track (web).
                    if (!IS_WEB) {
                      const { TrackRepository } = await import('../../db/TrackRepository');
                      const repo = await TrackRepository.create();
                      const record = await repo.getById(savedTrack.id);
                      if (record) {
                        await playbackController.playTracks([record], 0);
                      }
                    } else {
                      // Web: fall back to legacy player (not yet migrated).
                      const { player } = await import('../../lib/player');
                      void player.playTracks([savedTrack]);
                    }
                  }}
                  style={[styles.bigBtn, { backgroundColor: theme.buttonColor }]}
                >
                  <Text style={styles.bigBtnText}>Play now</Text>
                </Pressable>
                <Pressable onPress={reset} style={[styles.bigBtn, styles.ghostBtn]}>
                  <Text style={[styles.bigBtnText, { color: theme.accent }]}>Grab another</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable
              onPress={runDownload}
              style={[styles.bigBtn, { backgroundColor: theme.buttonColor }]}
            >
              <Text style={styles.bigBtnText}>Download</Text>
            </Pressable>
          )}
        </GlassView>
      )}
      <View style={{ height: 140 }} />
    </ScrollView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 16 },
  title: { color: '#fff', fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  sub: { color: '#b3b3b3', fontSize: 14, marginTop: 4, marginBottom: 16 },
  pasteCard: { padding: 12, marginBottom: 12 },
  input: {
    color: '#fff',
    fontSize: 14,
    backgroundColor: '#1f1f1f',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  pasteRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  pasteBtn: { padding: 8 },
  pasteText: { fontSize: 13, fontWeight: '600' },
  probeBtn: { borderRadius: 20, paddingHorizontal: 22, paddingVertical: 10 },
  probeText: { color: '#000', fontWeight: '800', fontSize: 14 },
  errorCard: { padding: 14, marginBottom: 12, borderWidth: 1 },
  errorText: { color: '#fda4af', fontSize: 13, lineHeight: 18 },
  resultCard: { padding: 14, marginBottom: 12 },
  resultRow: { flexDirection: 'row', marginBottom: 8 },
  thumb: { width: 76, height: 76, borderRadius: 14 },
  thumbFallback: { alignItems: 'center', justifyContent: 'center' },
  noteGlyph: { color: '#fff', fontSize: 30 },
  resultMeta: { flex: 1, marginLeft: 12, justifyContent: 'center' },
  resultTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  resultArtist: { color: '#b3b3b3', fontSize: 13, marginTop: 3 },
  badge: { alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, marginTop: 6 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  matchNote: { color: '#b3b3b3', fontSize: 12, lineHeight: 17, marginBottom: 12 },
  qualityTitle: { color: '#fff', fontSize: 15, fontWeight: '700', marginBottom: 8, marginTop: 4 },
  qRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  qLabel: { color: '#fff', fontSize: 14, fontWeight: '600' },
  qSize: { color: '#b3b3b3', fontSize: 13 },
  bigBtn: { borderRadius: 24, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  bigBtnText: { color: '#000', fontWeight: '800', fontSize: 16 },
  ghostBtn: { backgroundColor: 'rgba(255,255,255,0.08)', marginTop: 8 },
  progressWrap: { marginTop: 12, alignItems: 'center' },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.2)', width: '100%', overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3 },
  progressText: { color: '#b3b3b3', fontSize: 12, marginTop: 6 },
  doneRow: { borderRadius: 12, padding: 12, marginTop: 8 },
  doneText: { color: '#bbf7d0', fontSize: 13, fontWeight: '600' },
  doneBtns: { marginTop: 4 },
});
