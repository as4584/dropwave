/**
 * Deterministic application startup sequence (native only).
 *
 * Order matters:
 * 1. Open database, run migrations.
 * 2. Migrate legacy AsyncStorage data (one-time).
 * 3. Reconcile interrupted downloads (clean staging, mark failed).
 * 4. Configure audio session (silent mode, background, interruptions).
 * 5. Initialize playback controller (hydrates queue/session, restores track).
 *
 * Each step logs its outcome. Failures are isolated: a download
 * reconciliation failure does not prevent playback initialization.
 */
import { openDatabase } from '../db/client';
import { needsMigration, migrateFromAsyncStorage } from '../db/migrate';
import { downloadManager } from '../downloads/DownloadManager';
import { configureAudioSession } from '../audio/audioSession';
import { playbackController } from '../audio/PlaybackController';
import { ensureTracksDir, ensureStagingDir } from '../audio/sourceResolver';
import { logEvent } from '../telemetry/logger';

export interface StartupResult {
  databaseReady: boolean;
  migratedTracks: number;
  migratedPlaylists: number;
  audioSessionReady: boolean;
  playbackReady: boolean;
  errors: string[];
}

export async function runStartupSequence(): Promise<StartupResult> {
  const result: StartupResult = {
    databaseReady: false,
    migratedTracks: 0,
    migratedPlaylists: 0,
    audioSessionReady: false,
    playbackReady: false,
    errors: [],
  };

  // 1. Database.
  try {
    await openDatabase();
    await ensureTracksDir();
    await ensureStagingDir();
    result.databaseReady = true;
  } catch (e) {
    const msg = `Database init failed: ${e instanceof Error ? e.message : String(e)}`;
    result.errors.push(msg);
    logEvent('queue_restore_failed', { errorMessage: msg });
    return result; // Cannot proceed without the database.
  }

  // 2. Legacy migration (one-time).
  try {
    if (await needsMigration()) {
      const { tracks, playlists } = await migrateFromAsyncStorage();
      result.migratedTracks = tracks;
      result.migratedPlaylists = playlists;
    }
  } catch (e) {
    result.errors.push(`Migration failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 3. Download reconciliation (non-fatal).
  try {
    await downloadManager.reconcile();
  } catch (e) {
    result.errors.push(`Download reconcile failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 4. Audio session (non-fatal on web).
  try {
    await configureAudioSession();
    result.audioSessionReady = true;
    logEvent('audio_session_configured', {});
  } catch (e) {
    const msg = `Audio session failed: ${e instanceof Error ? e.message : String(e)}`;
    result.errors.push(msg);
    logEvent('audio_session_config_failed', { errorMessage: msg });
  }

  // 5. Playback controller (hydrates queue/session).
  try {
    await playbackController.init();
    result.playbackReady = true;
  } catch (e) {
    const msg = `Playback init failed: ${e instanceof Error ? e.message : String(e)}`;
    result.errors.push(msg);
    logEvent('queue_restore_failed', { errorMessage: msg });
  }

  return result;
}
