# DropWave — TEST REPORT
Date: Monday, October 12, 2026. All checks run by the builder before handoff (Lex's law).

## What it is
DropWave is an Expo music app: paste a YouTube/Spotify/Apple Music link, see title/artist/duration/thumbnail, pick audio quality with a real file-size estimate, download, and play. Home, Playlists, full Player, and a Personalize screen (accent color, button color, background gradient/solid/photo, glossy/matte finish).

## URLs (local preview, no public link per Lex's call)
- Web preview: http://localhost:8083/ (static export, served from `dist/`)
- Backend API: http://localhost:8001/ (`/health`, `/probe`, `/download`)
- The web bundle reads the API URL from `EXPO_PUBLIC_API_URL` at export time (falls back to `app.json` extra.apiUrl, then `http://localhost:8001`). To point a future public preview at a reachable backend: `EXPO_PUBLIC_API_URL=http://<host>:8001 npx expo export --platform web`.
- Rebuild + reserve: `npx expo export --platform web` and `bash web-preview.sh` (port 8083). Backend: `bash backend/start-backend.sh` (port 8001). Both are running detached now.

## Backend tests (all real, all passing)
- `GET /health` → `{"ok": true}`
- `POST /probe` YouTube (Rick Astley - Never Gonna Give You Up): title, artist, 213s, thumbnail, 3 qualities with sane estimates (q320 → 8.5 MB). Direct download, no matching.
- Spotify metadata source: the Spotify oEmbed endpoint is unreachable from this server (504), and the track page is a JS shell, so metadata comes from the **Spotify embed page `__NEXT_DATA__`** (`entity.title`, `entity.artists[].name`, `entity.duration` ms, `visualIdentity.image` artwork). Verified working.

### Spotify → YouTube matching (deterministic scorer)
Scoring per candidate: title similarity 0.45 (token overlap + sequence ratio, only noise tags like "Official Video"/"Lyrics" stripped, version tags like "(Remix)" kept), artist-in-title/channel 0.30, duration 0.25 (±4s = 1.0, ±15s = 0.5, beyond = hard fail unless nothing else qualifies), +0.15 official/VEVO/Topic channel, −0.25 per noise word ("live", "cover", "karaoke", "sped up", "slowed", "8d audio", "nightcore") present in the candidate but not the original, including "remix" only when the original title has no "remix". Ties broken by video_id ascending. Results cached in `backend/match-cache.json` (Spotify URL → video ID).

| # | Spotify link | Spotify metadata | Chosen YouTube video | Score check |
|---|---|---|---|---|
| 1 | `open.spotify.com/track/6KJqZcs9XDgVck7Lg9QOTC` (current popular: Taylor Swift "seven", 2026) | seven / Taylor Swift / 209s | `pEY-GPsru_E` — "Taylor Swift – seven (Official Lyric Video)", official channel, 210s | total 1.023, t=0.72 a=1.00 d=1.00. Correctly beat "seven (the long pond studio sessions)" once version tags stopped being stripped |
| 2 | `open.spotify.com/track/5IX7cHQm3U8sqrIipVCfw5` (Rafztar "Money"; marketed as Streetz Remix but Spotify title is "Money") | Money / Rafztar / 243s | `9Fc4nYM999g` — "Money - Rafztar Hip Hop UK 2018" | The "Money (Streetz Remix)" candidate was correctly penalized −0.25 for "remix" since the original is not a remix |
| 3 | `open.spotify.com/track/7KokYm8cMIXCsGVmUvKtqf` (catalog: Taylor Swift "Karma") | Karma / Taylor Swift / 205s | `1imWezhl2T0` — "Karma", official channel, 205s | Three-way tie at 1.150, deterministic video_id tiebreak picked `1imWezhl2T0` |
| 4 | remix-positive (synthetic title "Opalite (Chris Lake Remix)" + 10 REAL ytsearch candidates) | — | "Taylor Swift - Opalite (Chris Lake Remix) (Visualizer)" | PASS: zero remix penalties applied when "remix" is in the original title. (No public Spotify URL for a remix track was findable; the negative case above is a real link) |

- **Determinism**: probed the "seven" URL twice → identical video ID `pEY-GPsru_E`, second call 0.78s via cache hit. Same-link → same-video guaranteed by score sort + video_id tiebreak + persistent cache.
- `GET /download` end to end (Spotify link + matched video, q128): HTTP 200, valid 1.28 MB m4a, ffprobe duration 209.86s matching the 209s Spotify track.
- YouTube bot check: direct video downloads hit "Sign in to confirm you're not a bot" from this IP. Fix baked in: downloads use `--extractor-args youtube:player_client=android` (verified working). Search/probe unaffected.
- CORS enabled (`*`) so the browser preview can call the API cross-origin. Verified `access-control-allow-origin: *` on preflight.
- Apple Music path kept stubbed (iTunes Search metadata → YouTube match), not tested, per instructions.

## App tests
- `npx tsc --noEmit` → clean.
- `npx expo export --platform web` → success (`dist/index.html` + 1.3 MB bundle).
- Web preview serves on :8083 (HTTP 200, correct title, bundle loads).
- Web-specific paths implemented and present in the bundle: downloads stream via fetch with real progress → Blob → `<a download>` anchor click (expo-file-system has no web filesystem); playback uses in-memory blob URLs; image-picker background uses the picker URI directly on web. Note: on web, downloaded tracks play only in the session they were downloaded (blob URLs don't survive reload); library metadata persists via AsyncStorage.
- expo-av audio, expo-image-picker, AsyncStorage, haptics (no-op on web) all web-compatible. No native-only APIs without fallbacks.
- Headless limit (honest): no live browser is available in this environment, so the web UI was verified by export success + serving + bundle code inspection, not by clicking through it. The backend endpoints the UI calls are all proven above.

## Simplifications / notes
- npm needed `--legacy-peer-deps` (expo's own react-dom 19.3.0 peer-conflicts react 19.2.3).
- expo-file-system v19 moved the classic API to `expo-file-system/legacy` (documentDirectory, createDownloadResumable with progress). Used the legacy path.
- Background audio: `UIBackgroundModes: audio` is in app.json for future native builds; in the web preview, audio plays while the tab is open.
- The expo tunnel dev server (`start.sh`, port 8082) was intentionally NOT started: per the updated brief, no public app URL exists until Lex approves the web preview. `start.sh` is ready for that step.
- No EAS project, no publish, no Expo Go link created.
