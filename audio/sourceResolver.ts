/**
 * SourceResolver: selects a validated local or remote source for a track.
 *
 * Responsibilities:
 * - Check that the local file exists and has non-zero size.
 * - Produce a URI the native player can load.
 * - Classify failures (missing file, zero-byte, unreadable) for the error taxonomy.
 */
import * as FileSystem from 'expo-file-system/legacy';
import type { TrackRecord } from '../db/TrackRepository';

export type SourceKind = 'local' | 'missing';

export interface ResolvedSource {
  kind: SourceKind;
  uri: string | null;
  trackId: string;
  /** Set when kind is 'missing'. */
  failureReason?: 'file_missing' | 'file_empty' | 'file_unreadable';
  fileSize?: number;
}

const TRACKS_DIR = () => `${FileSystem.documentDirectory ?? ''}tracks/`;

export async function resolveSource(track: TrackRecord): Promise<ResolvedSource> {
  const uri = `${TRACKS_DIR()}${track.filename}`;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) {
      return { kind: 'missing', uri: null, trackId: track.id, failureReason: 'file_missing' };
    }
    const size = (info as { size?: number }).size ?? 0;
    if (size === 0) {
      return { kind: 'missing', uri: null, trackId: track.id, failureReason: 'file_empty', fileSize: 0 };
    }
    return { kind: 'local', uri, trackId: track.id, fileSize: size };
  } catch (e) {
    return {
      kind: 'missing',
      uri: null,
      trackId: track.id,
      failureReason: 'file_unreadable',
    };
  }
}

/** Absolute directory where track files live. Created on demand. */
export async function ensureTracksDir(): Promise<string> {
  const dir = TRACKS_DIR();
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  return dir;
}

/** Absolute directory for in-progress downloads. Cleaned on startup. */
export async function ensureStagingDir(): Promise<string> {
  const dir = `${FileSystem.documentDirectory ?? ''}staging/`;
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  return dir;
}
