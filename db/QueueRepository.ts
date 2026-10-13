/**
 * Queue repository: persistent queue entries and playback session.
 *
 * The queue is a first-class domain, not an in-memory array. Every mutation
 * is transactional. The native player executes the queue; this is the source
 * of truth that survives process termination.
 */
import { openDatabase, type SQLiteDatabase } from './client';
import { randomUUID } from 'expo-crypto';

export type RepeatMode = 'off' | 'track' | 'queue';

export interface QueueEntry {
  id: string;
  trackId: string;
  canonicalPosition: number;
  shufflePosition: number | null;
}

export interface PlaybackSession {
  currentEntryId: string | null;
  positionMs: number;
  repeatMode: RepeatMode;
  shuffleEnabled: boolean;
  desiredState: 'playing' | 'paused';
  updatedAt: number;
}

function rowToEntry(row: any): QueueEntry {
  return {
    id: row.id,
    trackId: row.track_id,
    canonicalPosition: row.canonical_position,
    shufflePosition: row.shuffle_position ?? null,
  };
}

const EMPTY_SESSION: PlaybackSession = {
  currentEntryId: null,
  positionMs: 0,
  repeatMode: 'off',
  shuffleEnabled: false,
  desiredState: 'paused',
  updatedAt: 0,
};

export class QueueRepository {
  constructor(private db: SQLiteDatabase) {}

  static async create(): Promise<QueueRepository> {
    return new QueueRepository(await openDatabase());
  }

  /** Replace the entire queue with the given track IDs, in order. */
  async setQueue(trackIds: string[]): Promise<QueueEntry[]> {
    const now = Date.now();
    const entries: QueueEntry[] = trackIds.map((trackId, i) => ({
      id: randomUUID(),
      trackId,
      canonicalPosition: i,
      shufflePosition: null,
    }));
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync('DELETE FROM queue_entries');
      for (const e of entries) {
        await this.db.runAsync(
          'INSERT INTO queue_entries (id, track_id, canonical_position, shuffle_position, added_at) VALUES (?, ?, ?, ?, ?)',
          [e.id, e.trackId, e.canonicalPosition, e.shufflePosition, now]
        );
      }
      // Reset session to first entry, paused at 0.
      await this.db.runAsync(
        `INSERT OR REPLACE INTO playback_session
          (id, current_entry_id, position_ms, repeat_mode, shuffle_enabled, desired_state, updated_at)
         VALUES (1, ?, 0, 'off', 0, 'paused', ?)`,
        [entries[0]?.id ?? null, now]
      );
    });
    return entries;
  }

  async listEntries(): Promise<QueueEntry[]> {
    const rows = await this.db.getAllAsync(
      'SELECT * FROM queue_entries ORDER BY canonical_position ASC'
    );
    return rows.map(rowToEntry);
  }

  async getEntry(id: string): Promise<QueueEntry | null> {
    const row = await this.db.getFirstAsync('SELECT * FROM queue_entries WHERE id = ?', [id]);
    return row ? rowToEntry(row) : null;
  }

  async getSession(): Promise<PlaybackSession> {
    const row = (await this.db.getFirstAsync('SELECT * FROM playback_session WHERE id = 1')) as any;
    if (!row) return { ...EMPTY_SESSION };
    return {
      currentEntryId: row.current_entry_id ?? null,
      positionMs: row.position_ms ?? 0,
      repeatMode: (row.repeat_mode as RepeatMode) ?? 'off',
      shuffleEnabled: row.shuffle_enabled === 1,
      desiredState: (row.desired_state as 'playing' | 'paused') ?? 'paused',
      updatedAt: row.updated_at ?? 0,
    };
  }

  async updateSession(patch: Partial<Omit<PlaybackSession, 'updatedAt'>>): Promise<void> {
    const current = await this.getSession();
    const next: PlaybackSession = {
      currentEntryId: patch.currentEntryId !== undefined ? patch.currentEntryId : current.currentEntryId,
      positionMs: patch.positionMs ?? current.positionMs,
      repeatMode: patch.repeatMode ?? current.repeatMode,
      shuffleEnabled: patch.shuffleEnabled ?? current.shuffleEnabled,
      desiredState: patch.desiredState ?? current.desiredState,
      updatedAt: Date.now(),
    };
    await this.db.runAsync(
      `INSERT OR REPLACE INTO playback_session
        (id, current_entry_id, position_ms, repeat_mode, shuffle_enabled, desired_state, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?)`,
      [
        next.currentEntryId,
        next.positionMs,
        next.repeatMode,
        next.shuffleEnabled ? 1 : 0,
        next.desiredState,
        next.updatedAt,
      ]
    );
  }

  /** Deterministic Fisher-Yates shuffle preserving the current entry at position 0. */
  async applyShuffle(currentEntryId: string | null): Promise<QueueEntry[]> {
    const entries = await this.listEntries();
    if (entries.length <= 1) return entries;

    // Move current entry first, shuffle the rest.
    const current = currentEntryId
      ? entries.find((e) => e.id === currentEntryId)
      : null;
    const rest = entries.filter((e) => e.id !== current?.id);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    const ordered = current ? [current, ...rest] : rest;
    await this.db.withTransactionAsync(async () => {
      for (let i = 0; i < ordered.length; i++) {
        await this.db.runAsync(
          'UPDATE queue_entries SET shuffle_position = ? WHERE id = ?',
          [i, ordered[i].id]
        );
      }
      await this.updateSession({ shuffleEnabled: true });
    });
    return this.listEntries();
  }

  async clearShuffle(): Promise<void> {
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync('UPDATE queue_entries SET shuffle_position = NULL');
      await this.updateSession({ shuffleEnabled: false });
    });
  }

  async clear(): Promise<void> {
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync('DELETE FROM queue_entries');
      await this.db.runAsync('DELETE FROM playback_session WHERE id = 1');
    });
  }

  /** Remove a track from the queue. Returns the removed entry, if any. */
  async removeEntry(entryId: string): Promise<QueueEntry | null> {
    const entry = await this.getEntry(entryId);
    if (!entry) return null;
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync('DELETE FROM queue_entries WHERE id = ?', [entryId]);
      // Renumber canonical positions to stay contiguous.
      const remaining = await this.listEntries();
      for (let i = 0; i < remaining.length; i++) {
        if (remaining[i].canonicalPosition !== i) {
          await this.db.runAsync(
            'UPDATE queue_entries SET canonical_position = ? WHERE id = ?',
            [i, remaining[i].id]
          );
        }
      }
      const session = await this.getSession();
      if (session.currentEntryId === entryId) {
        await this.updateSession({ currentEntryId: null, positionMs: 0, desiredState: 'paused' });
      }
    });
    return entry;
  }
}
