/**
 * Web stub for the SQLite client (client.web.ts).
 * Metro picks this file on web; client.native.ts on iOS/Android.
 */
export type SQLiteDatabase = any;

export async function openDatabase(): Promise<SQLiteDatabase> {
  throw new Error('SQLite is not available on web');
}

export async function closeDatabase(): Promise<void> {}

export function __resetForTests(): void {}
