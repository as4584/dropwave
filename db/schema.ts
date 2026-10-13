/**
 * DropWave SQLite schema.
 *
 * All user-important state lives here. Audio bytes live in the filesystem
 * (FileSystem.documentDirectory/tracks/); this database holds metadata and
 * references by RELATIVE path so sandbox relocation does not invalidate them.
 *
 * Conventions:
 * - Timestamps are INTEGER milliseconds since epoch.
 * - Booleans are INTEGER 0/1.
 * - Foreign keys are enforced via PRAGMA foreign_keys=ON.
 * - Every schema change gets a new migration in migrations/.
 */

export const SCHEMA_VERSION = 1;

export const CREATE_TABLES_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT NOT NULL DEFAULT 'Unknown Artist',
  album TEXT,
  duration_sec REAL,
  filename TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  quality TEXT NOT NULL DEFAULT 'q128',
  bitrate INTEGER,
  file_size INTEGER,
  codec TEXT,
  container TEXT,
  mime_type TEXT,
  source TEXT NOT NULL DEFAULT 'youtube',
  source_url TEXT,
  matched_from_youtube INTEGER NOT NULL DEFAULT 0,
  thumbnail TEXT,
  download_status TEXT NOT NULL DEFAULT 'complete',
  integrity_hash TEXT,
  added_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tracks_added_at ON tracks(added_at DESC);
CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks(title);

CREATE TABLE IF NOT EXISTS playlists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS playlist_tracks (
  playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (playlist_id, track_id)
);
CREATE INDEX IF NOT EXISTS idx_playlist_tracks_pid ON playlist_tracks(playlist_id, position);

CREATE TABLE IF NOT EXISTS favorites (
  track_id TEXT PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
  added_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS downloads (
  id TEXT PRIMARY KEY,
  track_id TEXT REFERENCES tracks(id) ON DELETE SET NULL,
  source_url TEXT NOT NULL,
  resolved_url TEXT,
  quality TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  bytes_received INTEGER NOT NULL DEFAULT 0,
  bytes_expected INTEGER,
  temp_path TEXT,
  error_code TEXT,
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_downloads_status ON downloads(status);

CREATE TABLE IF NOT EXISTS queue_entries (
  id TEXT PRIMARY KEY,
  track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  canonical_position INTEGER NOT NULL,
  shuffle_position INTEGER,
  added_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_queue_canonical ON queue_entries(canonical_position);
CREATE INDEX IF NOT EXISTS idx_queue_shuffle ON queue_entries(shuffle_position);

CREATE TABLE IF NOT EXISTS playback_session (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  current_entry_id TEXT REFERENCES queue_entries(id) ON DELETE SET NULL,
  position_ms INTEGER NOT NULL DEFAULT 0,
  repeat_mode TEXT NOT NULL DEFAULT 'off',
  shuffle_enabled INTEGER NOT NULL DEFAULT 0,
  desired_state TEXT NOT NULL DEFAULT 'paused',
  updated_at INTEGER NOT NULL
);
`;
