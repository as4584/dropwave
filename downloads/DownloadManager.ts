/**
 * DownloadManager: reliable download pipeline with staging and validation.
 *
 * Pipeline:
 *   request → backend acquisition → transfer to staging/*.part
 *   → validation → publish (move) → SQLite registration
 *
 * Invariant: downloadStatus == 'complete' IMPLIES the final file exists,
 * has size > 0, and passed validation.
 */
import * as FileSystem from 'expo-file-system/legacy';
import { randomUUID } from 'expo-crypto';
import { downloadUrl } from '../lib/api';
import { ensureStagingDir, ensureTracksDir } from '../audio/sourceResolver';
import { TrackRepository } from '../db/TrackRepository';
import { openDatabase } from '../db/client';
import { logEvent } from '../telemetry/logger';

export type DownloadState =
  | 'pending'
  | 'downloading'
  | 'validating'
  | 'publishing'
  | 'complete'
  | 'failed'
  | 'cancelled';

export interface DownloadRequest {
  sourceUrl: string;
  resolvedUrl?: string;
  quality: string;
  title: string;
  artist: string;
  durationSec: number | null;
  thumbnail: string | null;
  source: string;
  matchedFromYoutube: boolean;
}

export interface DownloadProgress {
  downloadId: string;
  bytesReceived: number;
  bytesExpected: number | null;
  state: DownloadState;
}

type ProgressListener = (progress: DownloadProgress) => void;

export class DownloadManager {
  private listeners = new Set<ProgressListener>();
  private activeDownloads = new Map<string, FileSystem.DownloadResumable>();

  onProgress(fn: ProgressListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(progress: DownloadProgress): void {
    this.listeners.forEach((fn) => {
      try {
        fn(progress);
      } catch {
        // ignore listener errors
      }
    });
  }

  /**
   * Download a track. Returns the created track ID on success.
   * Throws on failure with a descriptive error.
   */
  async download(req: DownloadRequest): Promise<string> {
    const downloadId = randomUUID();
    const trackId = randomUUID();

    logEvent('download_requested', {
      downloadId,
      trackId,
      sourceKind: req.source,
    });

    const stagingDir = await ensureStagingDir();
    const tracksDir = await ensureTracksDir();
    const stagingPath = `${stagingDir}${downloadId}.part`;
    const finalFilename = `${trackId}.m4a`;
    const finalPath = `${tracksDir}${finalFilename}`;
    const relativePath = `tracks/${finalFilename}`;

    const url = downloadUrl(req.sourceUrl, req.quality, req.resolvedUrl);

    // Record the download in SQLite.
    const db = await openDatabase();
    await db.runAsync(
      `INSERT INTO downloads
        (id, track_id, source_url, resolved_url, quality, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'downloading', ?, ?)`,
      [downloadId, trackId, req.sourceUrl, req.resolvedUrl ?? null, req.quality, Date.now(), Date.now()]
    );

    logEvent('download_started', { downloadId, trackId });

    try {
      // --- Transfer to staging ---
      const resumable = FileSystem.createDownloadResumable(
        url,
        stagingPath,
        {},
        (progress) => {
          const bytesReceived = progress.totalBytesWritten;
          const bytesExpected = progress.totalBytesExpectedToWrite;
          this.emit({ downloadId, bytesReceived, bytesExpected, state: 'downloading' });
          if (bytesReceived % (1024 * 256) < 4096) {
            // Log roughly every 256KB to avoid spam.
            logEvent('download_progress', { downloadId, bytesReceived, bytesExpected });
          }
        }
      );
      this.activeDownloads.set(downloadId, resumable);
      const result = await resumable.downloadAsync();
      this.activeDownloads.delete(downloadId);

      if (!result || !result.uri) {
        throw new Error('Download produced no file');
      }

      logEvent('download_transfer_completed', { downloadId });

      // --- Validation ---
      await db.runAsync("UPDATE downloads SET status = 'validating', updated_at = ? WHERE id = ?", [
        Date.now(),
        downloadId,
      ]);
      logEvent('download_validation_started', { downloadId });

      const info = await FileSystem.getInfoAsync(stagingPath);
      if (!info.exists) {
        throw new Error('Staged file vanished after download');
      }
      const size = (info as { size?: number }).size ?? 0;
      if (size === 0) {
        throw new Error('Downloaded file is zero bytes');
      }
      // Minimum plausible audio: 10KB. Anything smaller is an error page.
      if (size < 10 * 1024) {
        throw new Error(`Downloaded file suspiciously small: ${size} bytes`);
      }

      // --- Publish: move to final location ---
      await db.runAsync("UPDATE downloads SET status = 'publishing', updated_at = ? WHERE id = ?", [
        Date.now(),
        downloadId,
      ]);
      await FileSystem.moveAsync({ from: stagingPath, to: finalPath });

      // --- Register in SQLite (transactional) ---
      const trackRepo = await TrackRepository.create();
      await trackRepo.insert({
        id: trackId,
        title: req.title,
        artist: req.artist,
        durationSec: req.durationSec,
        filename: finalFilename,
        relativePath,
        quality: req.quality,
        fileSize: size,
        codec: 'aac',
        container: 'm4a',
        mimeType: 'audio/mp4',
        source: req.source,
        sourceUrl: req.sourceUrl,
        matchedFromYoutube: req.matchedFromYoutube,
        thumbnail: req.thumbnail,
      });

      await db.runAsync(
        "UPDATE downloads SET status = 'complete', bytes_received = ?, updated_at = ? WHERE id = ?",
        [size, Date.now(), downloadId]
      );

      logEvent('download_published', { downloadId, trackId, fileSizeBytes: size });
      this.emit({ downloadId, bytesReceived: size, bytesExpected: size, state: 'complete' });

      return trackId;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logEvent('download_failed', {
        downloadId,
        errorCode: 'DOWNLOAD_FAILED',
        errorMessage: message,
      });

      // Cleanup: remove staging file, mark download failed.
      try {
        await FileSystem.deleteAsync(stagingPath, { idempotent: true });
      } catch {
        // ignore cleanup errors
      }
      await db.runAsync(
        "UPDATE downloads SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?",
        [message, Date.now(), downloadId]
      );
      this.emit({ downloadId, bytesReceived: 0, bytesExpected: null, state: 'failed' });
      throw e;
    }
  }

  async cancel(downloadId: string): Promise<void> {
    const resumable = this.activeDownloads.get(downloadId);
    if (resumable) {
      try {
        await resumable.pauseAsync();
      } catch {
        // ignore
      }
      this.activeDownloads.delete(downloadId);
    }
    const db = await openDatabase();
    await db.runAsync("UPDATE downloads SET status = 'cancelled', updated_at = ? WHERE id = ?", [
      Date.now(),
      downloadId,
    ]);
    logEvent('download_cancelled', { downloadId });
    this.emit({ downloadId, bytesReceived: 0, bytesExpected: null, state: 'cancelled' });
  }

  /** Reconcile interrupted downloads on startup. */
  async reconcile(): Promise<void> {
    const db = await openDatabase();
    const stale = (await db.getAllAsync(
      "SELECT id FROM downloads WHERE status IN ('downloading', 'validating', 'publishing')"
    )) as Array<{ id: string }>;
    const stagingDir = await ensureStagingDir();

    for (const row of stale) {
      // Clean up any leftover staging file.
      try {
        await FileSystem.deleteAsync(`${stagingDir}${row.id}.part`, { idempotent: true });
      } catch {
        // ignore
      }
      await db.runAsync(
        "UPDATE downloads SET status = 'failed', error_message = 'Interrupted by app restart', updated_at = ? WHERE id = ?",
        [Date.now(), row.id]
      );
      logEvent('download_failed', {
        downloadId: row.id,
        errorCode: 'INTERRUPTED',
        errorMessage: 'App restarted during download',
      });
    }

    // Clean any orphaned staging files with no DB record.
    try {
      const files = await FileSystem.readDirectoryAsync(stagingDir);
      for (const f of files) {
        if (f.endsWith('.part')) {
          const id = f.replace(/\.part$/, '');
          const exists = await db.getFirstAsync('SELECT id FROM downloads WHERE id = ?', [id]);
          if (!exists) {
            await FileSystem.deleteAsync(`${stagingDir}${f}`, { idempotent: true });
          }
        }
      }
    } catch {
      // staging dir may not exist yet; fine
    }
  }
}

export const downloadManager = new DownloadManager();
