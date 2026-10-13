# DropWave Engineering Progress

## Session: 2026-10-12 — Production-Grade Offline-First Architecture

### What was built

**Phase 0: Architecture map**
- VERIFIED: Expo SDK 57.0.27, React 19.2.3, React Native 0.86.3, expo-audio 57.0.5
- VERIFIED: No SQLite (was AsyncStorage), no persistent queue, player tied to React screens
- VERIFIED: Backend (FastAPI + yt-dlp) has 42 passing tests

**Phase 1: SQLite foundation**
- `db/schema.ts`: Full schema with tracks, playlists, favorites, downloads, queue_entries, playback_session
- `db/client.ts`: Connection management with WAL mode, migrations
- `db/TrackRepository.ts`: CRUD with search, indexes on added_at/artist/title
- `db/QueueRepository.ts`: Persistent queue with stable entry IDs, shuffle, repeat, session
- `db/migrate.ts`: One-time AsyncStorage → SQLite migration (preserves data)

**Phase 2: Playback engine**
- `audio/playbackMachine.ts`: Explicit state machine (idle → resolving → loading → ready → playing/paused/...)
- `audio/ExpoAudioAdapter.ts`: Wraps expo-audio, 500ms polling, stale callback protection
- `audio/sourceResolver.ts`: Validates local files (exists, non-zero size)
- `audio/PlaybackController.ts`: Long-lived controller, operation IDs, throttled checkpoints (5s)

**Phase 3: Audio session**
- `audio/audioSession.ts`: playsInSilentMode, shouldPlayInBackground, interruptionMode='doNotMix'
- Note: 'doNotMix' required for setActiveForLockScreen (Crate uses 'duckOthers' — do not copy)

**Phase 4: Durable queue**
- Stable queue-entry UUIDs (not numeric indexes)
- Repeat modes: off/track/queue
- Shuffle preserves current track at position 0
- All mutations transactional

**Phase 5: Startup sequence**
- `lib/startup.ts`: Deterministic boot (DB → migrate → reconcile → audio → playback)
- `app/_layout.tsx`: Shows loading indicator, runs startup, handles errors

**Phase 6: Download pipeline**
- `downloads/DownloadManager.ts`: Staging (*.part) → validation → publish (move) → SQLite
- Invariant: downloadStatus='complete' IMPLIES file exists, size>0, validated
- Reconciliation on startup cleans interrupted downloads

**Phase 9: Observability**
- `telemetry/logger.ts`: Structured JSON events, correlation IDs, sanitized URLs
- Events: track_load, play, pause, seek, download, checkpoint, interruption, etc.

**Phase 10: Tests**
- `audio/__tests__/playbackMachine.test.ts`: 12 unit tests for state machine
- Backend: 42 existing tests (unchanged)

### Files changed
- Added: db/, audio/, downloads/, telemetry/ (new directories)
- Modified: app/_layout.tsx (startup sequence)
- Installed: expo-sqlite@57.0.4

### Bugs fixed
- None yet (new architecture is additive; old UI still works)

### Known issues / risks
1. **UI not yet migrated**: Library/download/player screens still use old lib/player.ts and lib/library.ts. They work, but don't benefit from new durability yet. Migration is the next priority.
2. **expo-sqlite in Expo Go**: SQLite should work in Expo Go, but needs verification on Lex's phone.
3. **Background playback**: Requires `enableBackgroundPlayback` plugin in app.json (not yet added) and physical device testing.
4. **Lock screen controls**: setActiveForLockScreen not yet wired to PlaybackController.

### Unverified on physical device
- Silent mode playback
- Background playback
- Lock screen controls
- Bluetooth/AirPods disconnect
- Phone call interruption
- Cold-start restoration

### Next priorities
1. Migrate UI screens to PlaybackController (library, player, download)
2. Add `expo-audio` background plugin to app.json
3. Wire setActiveForLockScreen with metadata
4. Physical device testing matrix
5. Performance: virtualized lists for large libraries

### Status: PARTIALLY VERIFIED
Core architecture is built and TypeScript passes. Durability layer exists. UI migration and device verification remain.

## 2026-10-12 (late night) — UI/data sync fixes

**Lex reported:** "it doesnt still play music" + glossy UI glitch (screenshot).

**Root causes found:**
1. **Library/Downloads out of sync:** New DownloadManager writes to SQLite, but
   lib/library.ts:listTracks() only read from AsyncStorage. New downloads were
   invisible in the Library tab.
   - Fix: listTracks() now reads from SQLite on native (falls back to
     AsyncStorage). saveTrack() and deleteTrack() write to both.
2. **Library used old player:** app/(tabs)/library.tsx called legacy
   player.playTracks() with legacy Track objects.
   - Fix: On native, loads TrackRecord[] from SQLite and uses
     playbackController.playTracks().
3. **Glossy UI glitch:** GlassView used expo-blur's BlurView, which renders
   as "Unimplemented component: <ViewManagerAdapter_ExpoBlurView>" on this build.
   - Fix: Replaced with pure-JS frosted look (semi-transparent layers + gradient
     + border). No native blur dependency. Matte mode unchanged.
4. **Audio session:** Made configureAudioSession() defensive with fallbacks.
   If full config fails, tries minimal; if that fails, continues without explicit
   config (like the old code which did nothing).

**Published:** Update group 79564df6-da3a-4fbf-8eee-dee4f42ad16e
(iOS 01a13351-9559-779e-adbb-f22c018f8a30).

**Status:** Fixes published. Playback issue not yet confirmed fixed on device.
Awaiting Lex's test.

## 2026-10-12 (night) — Home/Playlist migration

**Lex reported:** No mini-player shows up; music stops when leaving app. Glossy fixed.

**Root cause:** Home (app/(tabs)/index.tsx) and Playlist (app/playlist/[id].tsx)
still used the legacy lib/player.ts. The MiniPlayer subscribes to the new
PlaybackController, so tracks played from those screens never appeared in it.
Background audio config also lives in the new stack, so the old player had none.

**Fix:** Migrated both screens to playbackController.playTracks() on native
(mapping legacy Track lists to SQLite TrackRecords). Web still uses old player.

**Published:** Update group 848b11bf-abc8-4cf2-a96d-7cf42c54d0a6
(iOS 01a13359-092b-7d7e-a5ed-3950f50a9412).

**Status:** Awaiting device test. Background/lock-screen behavior still
unverified on physical device.
