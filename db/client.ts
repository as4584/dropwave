/**
 * TypeScript entry point for the SQLite client.
 * Metro resolves './client' to client.native.ts (iOS/Android) or
 * client.web.ts (web) at bundle time. This file exists so TypeScript
 * can resolve the module; it is never bundled (Metro prefers the
 * platform-specific files).
 */
export type SQLiteDatabase = any;
export declare function openDatabase(): Promise<SQLiteDatabase>;
export declare function closeDatabase(): Promise<void>;
export declare function __resetForTests(): void;
