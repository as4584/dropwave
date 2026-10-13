/**
 * Track repository: CRUD for the tracks table.
 *
 * This is the single source of truth for track metadata. The player,
 * queue, and UI all read through here. Files live in the filesystem;
 * this table holds metadata and relative paths.
 */
import { openDatabase, type SQLiteDatabase } from './client';

export type DownloadStatus = 'pending' | 'downloading' | 'complete' | 'failed';

export interface TrackRecord {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  durationSec: number | null;
  filename: string;
  relativePath: string;
  quality: string;
  bitrate: number | null;
  fileSize: number | null;
  codec: string | null;
  container: string | null;
  mimeType: string | null;
  source: string;
  sourceUrl: string | null;
  matchedFromYoutube: boolean;
  thumbnail: string | null;
  downloadStatus: DownloadStatus;
  integrityHash: string | null;
  addedAt: number;
  updatedAt: number;
}

export interface NewTrack {
  id: string;
  title: string;
  artist?: string;
  album?: string | null;
  durationSec?: number | null;
  filename: string;
  relativePath: string;
  quality?: string;
  bitrate?: number | null;
  fileSize?: number | null;
  codec?: string | null;
  container?: string | null;
  mimeType?: string | null;
  source?: string;
  sourceUrl?: string | null;
  matchedFromYoutube?: boolean;
  thumbnail?: string | null;
  integrityHash?: string | null;
}

function rowToTrack(row: any): TrackRecord {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    album: row.album ?? null,
    durationSec: row.duration_sec ?? null,
    filename: row.filename,
    relativePath: row.relative_path,
    quality: row.quality,
    bitrate: row.bitrate ?? null,
    fileSize: row.file_size ?? null,
    codec: row.codec ?? null,
    container: row.container ?? null,
    mimeType: row.mime_type ?? null,
    source: row.source,
    sourceUrl: row.source_url ?? null,
    matchedFromYoutube: row.matched_from_youtube === 1,
    thumbnail: row.thumbnail ?? null,
    downloadStatus: row.download_status as DownloadStatus,
    integrityHash: row.integrity_hash ?? null,
    addedAt: row.added_at,
    updatedAt: row.updated_at,
  };
}

export class TrackRepository {
  constructor(private db: SQLiteDatabase) {}

  static async create(): Promise<TrackRepository> {
    return new TrackRepository(await openDatabase());
  }

  async insert(track: NewTrack): Promise<TrackRecord> {
    const now = Date.now();
    await this.db.runAsync(
      `INSERT INTO tracks
        (id, title, artist, album, duration_sec, filename, relative_path,
         quality, bitrate, file_size, codec, container, mime_type,
         source, source_url, matched_from_youtube, thumbnail,
         download_status, integrity_hash, added_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'complete', ?, ?, ?)`,
      [
        track.id,
        track.title,
        track.artist ?? 'Unknown Artist',
        track.album ?? null,
        track.durationSec ?? null,
        track.filename,
        track.relativePath,
        track.quality ?? 'q128',
        track.bitrate ?? null,
        track.fileSize ?? null,
        track.codec ?? null,
        track.container ?? null,
        track.mimeType ?? null,
        track.source ?? 'youtube',
        track.sourceUrl ?? null,
        track.matchedFromYoutube ? 1 : 0,
        track.thumbnail ?? null,
        track.integrityHash ?? null,
        now,
        now,
      ]
    );
    const created = await this.getById(track.id);
    if (!created) throw new Error(`Track insert failed: ${track.id}`);
    return created;
  }

  async getById(id: string): Promise<TrackRecord | null> {
    const row = await this.db.getFirstAsync('SELECT * FROM tracks WHERE id = ?', [id]);
    return row ? rowToTrack(row) : null;
  }

  async listAll(): Promise<TrackRecord[]> {
    const rows = await this.db.getAllAsync('SELECT * FROM tracks ORDER BY added_at DESC');
    return rows.map(rowToTrack);
  }

  async update(id: string, patch: Partial<NewTrack> & { downloadStatus?: DownloadStatus }): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];
    const map: Record<string, string> = {
      title: 'title', artist: 'artist', album: 'album', durationSec: 'duration_sec',
      filename: 'filename', relativePath: 'relative_path', quality: 'quality',
      bitrate: 'bitrate', fileSize: 'file_size', codec: 'codec',
      container: 'container', mimeType: 'mime_type', source: 'source',
      sourceUrl: 'source_url', thumbnail: 'thumbnail',
      integrityHash: 'integrity_hash', downloadStatus: 'download_status',
    };
    for (const [key, col] of Object.entries(map)) {
      const v = (patch as any)[key];
      if (v !== undefined) {
        fields.push(`${col} = ?`);
        values.push(v);
      }
    }
    if (patch.matchedFromYoutube !== undefined) {
      fields.push('matched_from_youtube = ?');
      values.push(patch.matchedFromYoutube ? 1 : 0);
    }
    if (fields.length === 0) return;
    fields.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);
    await this.db.runAsync(`UPDATE tracks SET ${fields.join(', ')} WHERE id = ?`, values);
  }

  async delete(id: string): Promise<void> {
    await this.db.runAsync('DELETE FROM tracks WHERE id = ?', [id]);
  }

  async count(): Promise<number> {
    const row = (await this.db.getFirstAsync('SELECT COUNT(*) AS c FROM tracks')) as { c: number } | null;
    return row?.c ?? 0;
  }

  async search(query: string, limit = 50): Promise<TrackRecord[]> {
    const like = `%${query}%`;
    const rows = await this.db.getAllAsync(
      'SELECT * FROM tracks WHERE title LIKE ? OR artist LIKE ? OR album LIKE ? ORDER BY added_at DESC LIMIT ?',
      [like, like, like, limit]
    );
    return rows.map(rowToTrack);
  }
}
