/**
 * One-time migration from AsyncStorage (legacy) to SQLite.
 *
 * Reads the old 'dropwave:tracks' and 'dropwave:playlists' keys and inserts
 * them into the new schema. Safe to run multiple times: skips tracks that
 * already exist by ID.
 *
 * After migration, the old keys are left in place (not deleted) so a
 * rollback remains possible. A future version may clean them up.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { TrackRepository } from './TrackRepository';
import { openDatabase } from './client';
import { logEvent } from '../telemetry/logger';

const LEGACY_TRACKS_KEY = 'dropwave:tracks';
const LEGACY_PLAYLISTS_KEY = 'dropwave:playlists';

interface LegacyTrack {
  id: string;
  title: string;
  artist: string;
  durationSec: number | null;
  filename: string;
  quality: string;
  source: string;
  matchedFromYoutube: boolean;
  thumbnail: string | null;
  addedAt: number;
}

interface LegacyPlaylist {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: number;
}

const MIGRATION_FLAG = 'dropwave:sqlite-migrated-v1';

export async function needsMigration(): Promise<boolean> {
  const flag = await AsyncStorage.getItem(MIGRATION_FLAG);
  if (flag === 'done') return false;
  // Only migrate if there's legacy data.
  const tracks = await AsyncStorage.getItem(LEGACY_TRACKS_KEY);
  return tracks !== null;
}

export async function migrateFromAsyncStorage(): Promise<{ tracks: number; playlists: number }> {
  let trackCount = 0;
  let playlistCount = 0;

  const trackRepo = await TrackRepository.create();
  const db = await openDatabase();

  // Migrate tracks.
  try {
    const raw = await AsyncStorage.getItem(LEGACY_TRACKS_KEY);
    if (raw) {
      const legacy: Record<string, LegacyTrack> = JSON.parse(raw);
      for (const t of Object.values(legacy)) {
        const existing = await trackRepo.getById(t.id);
        if (existing) continue;
        await trackRepo.insert({
          id: t.id,
          title: t.title,
          artist: t.artist,
          durationSec: t.durationSec,
          filename: t.filename,
          relativePath: `tracks/${t.filename}`,
          quality: t.quality,
          source: t.source,
          matchedFromYoutube: t.matchedFromYoutube,
          thumbnail: t.thumbnail,
        });
        // Preserve original addedAt.
        await db.runAsync('UPDATE tracks SET added_at = ?, updated_at = ? WHERE id = ?', [
          t.addedAt,
          t.addedAt,
          t.id,
        ]);
        trackCount++;
      }
    }
  } catch (e) {
    logEvent('queue_restore_failed', {
      errorMessage: `Track migration failed: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  // Migrate playlists.
  try {
    const raw = await AsyncStorage.getItem(LEGACY_PLAYLISTS_KEY);
    if (raw) {
      const legacy: LegacyPlaylist[] = JSON.parse(raw);
      for (const p of legacy) {
        const existing = await db.getFirstAsync('SELECT id FROM playlists WHERE id = ?', [p.id]);
        if (existing) continue;
        await db.runAsync(
          'INSERT INTO playlists (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
          [p.id, p.name, p.createdAt, p.createdAt]
        );
        for (let i = 0; i < p.trackIds.length; i++) {
          await db.runAsync(
            'INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position, added_at) VALUES (?, ?, ?, ?)',
            [p.id, p.trackIds[i], i, Date.now()]
          );
        }
        playlistCount++;
      }
    }
  } catch (e) {
    logEvent('queue_restore_failed', {
      errorMessage: `Playlist migration failed: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  await AsyncStorage.setItem(MIGRATION_FLAG, 'done');
  logEvent('queue_hydrated', { queueLength: trackCount });

  return { tracks: trackCount, playlists: playlistCount };
}
