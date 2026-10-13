/**
 * TypeScript entry point for the startup sequence.
 * Metro resolves '../lib/startup' to startup.native.ts (iOS/Android) or
 * startup.web.ts (web) at bundle time.
 */
export interface StartupResult {
  databaseReady: boolean;
  migratedTracks: number;
  migratedPlaylists: number;
  audioSessionReady: boolean;
  playbackReady: boolean;
  errors: string[];
}
export declare function runStartupSequence(): Promise<StartupResult>;
