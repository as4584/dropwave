import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { randomUUID } from 'expo-crypto';
import type { TrackSource } from './api';

export const IS_WEB = Platform.OS === 'web';

/** True on native where SQLite is available. */
const USE_SQLITE = !IS_WEB;

async function getTrackRepo() {
  if (!USE_SQLITE) return null;
  const { TrackRepository } = await import('../db/TrackRepository');
  return TrackRepository.create();
}

export interface Track {
  id: string;
  title: string;
  artist: string;
  durationSec: number | null;
  filename: string;
  quality: string;
  source: TrackSource;
  matchedFromYoutube: boolean;
  thumbnail: string | null;
  addedAt: number;
}

export interface Playlist {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: number;
}

const TRACKS_KEY = 'dropwave:tracks';
const PLAYLISTS_KEY = 'dropwave:playlists';
const BG_KEY = 'dropwave:custom-bg';

export const TRACKS_DIR = `${FileSystem.documentDirectory ?? ''}tracks/`;

/** Web only: in-memory blob URLs for downloaded tracks (no filesystem on web). */
const webBlobUrls = new Map<string, string>();

export function setWebBlobUrl(trackId: string, url: string): void {
  webBlobUrls.set(trackId, url);
}

export function revokeWebBlobUrl(trackId: string): void {
  const url = webBlobUrls.get(trackId);
  if (url) {
    webBlobUrls.delete(trackId);
    try {
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  }
}

/** URI the player should load for a track on any platform. */
export function resolveTrackUri(track: Track): string {
  if (IS_WEB) return webBlobUrls.get(track.id) ?? '';
  return `${TRACKS_DIR}${track.filename}`;
}

export function trackFileUri(track: Track): string {
  return `${TRACKS_DIR}${track.filename}`;
}

export async function ensureTracksDir(): Promise<void> {
  if (IS_WEB) return;
  const info = await FileSystem.getInfoAsync(TRACKS_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(TRACKS_DIR, { intermediates: true });
  }
}

async function readTracks(): Promise<Record<string, Track>> {
  try {
    const raw = await AsyncStorage.getItem(TRACKS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, Track>) : {};
  } catch {
    return {};
  }
}

export async function listTracks(): Promise<Track[]> {
  // On native, read from SQLite (the source of truth after migration).
  // On web, use AsyncStorage (no SQLite).
  if (!IS_WEB) {
    try {
      const { TrackRepository } = await import('../db/TrackRepository');
      const repo = await TrackRepository.create();
      const records = await repo.listAll();
      // Convert TrackRecord to legacy Track for UI compatibility.
      return records.map((r) => ({
        id: r.id,
        title: r.title,
        artist: r.artist,
        durationSec: r.durationSec,
        filename: r.filename,
        quality: r.quality,
        source: r.source as Track['source'],
        matchedFromYoutube: r.matchedFromYoutube,
        thumbnail: r.thumbnail,
        addedAt: r.addedAt,
      }));
    } catch (e) {
      console.warn('[library] SQLite read failed, falling back to AsyncStorage:', e);
    }
  }
  const map = await readTracks();
  return Object.values(map).sort((a, b) => b.addedAt - a.addedAt);
}

export async function saveTrack(track: Track): Promise<void> {
  // Write to AsyncStorage (legacy, for web and fallback).
  const map = await readTracks();
  map[track.id] = track;
  await AsyncStorage.setItem(TRACKS_KEY, JSON.stringify(map));

  // Also write to SQLite on native (keeps both in sync during migration).
  if (!IS_WEB) {
    try {
      const { TrackRepository } = await import('../db/TrackRepository');
      const repo = await TrackRepository.create();
      const existing = await repo.getById(track.id);
      if (!existing) {
        await repo.insert({
          id: track.id,
          title: track.title,
          artist: track.artist,
          durationSec: track.durationSec,
          filename: track.filename,
          relativePath: `tracks/${track.filename}`,
          quality: track.quality,
          source: track.source,
          matchedFromYoutube: track.matchedFromYoutube,
          thumbnail: track.thumbnail,
        });
      }
    } catch (e) {
      console.warn('[library] SQLite write failed:', e);
    }
  }
}

export async function makeTrackId(): Promise<string> {
  try {
    return randomUUID();
  } catch {
    return `t${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  }
}

export async function deleteTrack(id: string): Promise<void> {
  const map = await readTracks();
  const track = map[id];
  delete map[id];
  await AsyncStorage.setItem(TRACKS_KEY, JSON.stringify(map));
  // remove from every playlist
  const playlists = await listPlaylists();
  for (const p of playlists) {
    if (p.trackIds.includes(id)) {
      p.trackIds = p.trackIds.filter((t) => t !== id);
    }
  }
  await AsyncStorage.setItem(PLAYLISTS_KEY, JSON.stringify(playlists));

  // Also delete from SQLite on native.
  if (!IS_WEB) {
    try {
      const { TrackRepository } = await import('../db/TrackRepository');
      const repo = await TrackRepository.create();
      await repo.delete(id);
    } catch (e) {
      console.warn('[library] SQLite delete failed:', e);
    }
  }

  // delete the audio file (native only; web blob URLs are memory-only)
  if (track && !IS_WEB) {
    try {
      await FileSystem.deleteAsync(trackFileUri(track), { idempotent: true });
    } catch {
      // file already gone, fine
    }
  }
  if (track) revokeWebBlobUrl(track.id);
}

export async function listPlaylists(): Promise<Playlist[]> {
  try {
    const raw = await AsyncStorage.getItem(PLAYLISTS_KEY);
    const arr = raw ? (JSON.parse(raw) as Playlist[]) : [];
    return arr.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

export async function createPlaylist(name: string): Promise<Playlist> {
  const playlists = await listPlaylists();
  const playlist: Playlist = {
    id: `p${Date.now()}${Math.floor(Math.random() * 1e6)}`,
    name: name.trim() || 'New playlist',
    trackIds: [],
    createdAt: Date.now(),
  };
  playlists.unshift(playlist);
  await AsyncStorage.setItem(PLAYLISTS_KEY, JSON.stringify(playlists));
  return playlist;
}

export async function deletePlaylist(id: string): Promise<void> {
  const playlists = (await listPlaylists()).filter((p) => p.id !== id);
  await AsyncStorage.setItem(PLAYLISTS_KEY, JSON.stringify(playlists));
}

export async function addTrackToPlaylist(playlistId: string, trackId: string): Promise<void> {
  const playlists = await listPlaylists();
  const p = playlists.find((x) => x.id === playlistId);
  if (p && !p.trackIds.includes(trackId)) {
    p.trackIds.push(trackId);
    await AsyncStorage.setItem(PLAYLISTS_KEY, JSON.stringify(playlists));
  }
}

export async function removeTrackFromPlaylist(playlistId: string, trackId: string): Promise<void> {
  const playlists = await listPlaylists();
  const p = playlists.find((x) => x.id === playlistId);
  if (p) {
    p.trackIds = p.trackIds.filter((t) => t !== trackId);
    await AsyncStorage.setItem(PLAYLISTS_KEY, JSON.stringify(playlists));
  }
}

/** Custom home background image URI chosen via image picker. */
export async function getCustomBackground(): Promise<string | null> {
  return AsyncStorage.getItem(BG_KEY);
}

export async function setCustomBackground(uri: string | null): Promise<void> {
  if (uri) await AsyncStorage.setItem(BG_KEY, uri);
  else await AsyncStorage.removeItem(BG_KEY);
}
