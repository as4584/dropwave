/**
 * Web startup sequence (startup.web.ts).
 * Metro picks this on web; startup.native.ts on iOS/Android.
 * Web uses the legacy AsyncStorage path (no SQLite).
 */
import { player as legacyPlayer } from './player';
import { ensureTracksDir as legacyEnsureTracksDir } from './library';

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

  try {
    await legacyPlayer.init();
    await legacyEnsureTracksDir();
    result.databaseReady = true;
    result.playbackReady = true;
  } catch (e) {
    result.errors.push(`Web init failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  return result;
}
