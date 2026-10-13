/**
 * SQLite database client for DropWave (native only).
 * This is client.native.ts — Metro only bundles it on iOS/Android.
 */
import * as SQLite from 'expo-sqlite';
import { CREATE_TABLES_SQL, SCHEMA_VERSION } from './schema';

export type SQLiteDatabase = any;

let db: SQLiteDatabase | null = null;
let openPromise: Promise<SQLiteDatabase> | null = null;

export async function openDatabase(): Promise<SQLiteDatabase> {
  if (db) return db;
  if (openPromise) return openPromise;

  openPromise = (async () => {
    const database = await SQLite.openDatabaseAsync('dropwave.db');
    await database.execAsync('PRAGMA foreign_keys = ON;');
    await database.execAsync('PRAGMA journal_mode = WAL;');
    await runMigrations(database);
    db = database;
    return database;
  })();

  return openPromise;
}

async function runMigrations(database: SQLiteDatabase): Promise<void> {
  const row = (await database
    .getFirstAsync('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .catch(() => null)) as { version: number } | null;

  const current = row?.version ?? 0;

  if (current < 1) {
    await database.execAsync(CREATE_TABLES_SQL);
    await database.runAsync(
      'INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (?, ?)',
      [SCHEMA_VERSION, Date.now()]
    );
  }
}

export async function closeDatabase(): Promise<void> {
  if (db) {
    await db.closeAsync();
    db = null;
    openPromise = null;
  }
}

export function __resetForTests(): void {
  db = null;
  openPromise = null;
}
