# DropWave Error Taxonomy

Every failure belongs to a layer. "Audio doesn't work" is not actionable.

## Layers

1. **SOURCE** - The original link (YouTube, Spotify, Apple)
2. **BACKEND** - FastAPI + yt-dlp media acquisition
3. **NETWORK** - HTTP transfer between app and backend
4. **FILESYSTEM** - Local file operations
5. **DATABASE** - SQLite operations
6. **SOURCE_RESOLVER** - Selecting a playable source for a track
7. **NATIVE_PLAYER** - expo-audio operations
8. **AUDIO_SESSION** - iOS AVAudioSession configuration
9. **OUTPUT_ROUTE** - Headphones, Bluetooth, speaker

## Error Codes

### Source Resolver
| Code | Meaning | Retry? | Action |
|------|---------|--------|--------|
| `file_missing` | Track file not in Documents/tracks/ | No | Mark track unavailable, offer redownload |
| `file_empty` | File exists but 0 bytes | No | Delete file, mark unavailable |
| `file_unreadable` | getInfoAsync threw | No | Log, mark unavailable |

### Download
| Code | Meaning | Retry? | Action |
|------|---------|--------|--------|
| `DOWNLOAD_FAILED` | Transfer failed | Yes (3x) | Keep in failed state, show error |
| `INTERRUPTED` | App killed during download | Yes | Auto-retry on next launch or manual |
| `VALIDATION_FAILED` | File < 10KB or zero bytes | No | Delete staging, mark failed |
| `INSUFFICIENT_SPACE` | Disk full | No | Show storage error, suggest cleanup |
| `NETWORK_ERROR` | Connection lost | Yes | Pause, resume when online |

### Native Player
| Code | Meaning | Retry? | Action |
|------|---------|--------|--------|
| `NATIVE_ERROR` | expo-audio threw | Once | Recreate player, retry load |
| `LOAD_FAILED` | createAudioPlayer failed | No | Check file, mark track bad |
| `INVALID_STATE` | Command in wrong state | No | Log, ignore (programming error) |

### Database
| Code | Meaning | Retry? | Action |
|------|---------|--------|--------|
| `DB_WRITE_FAILED` | SQLite error | No | Log, do not claim success |

### Audio Session
| Code | Meaning | Retry? | Action |
|------|---------|--------|--------|
| `SESSION_CONFIG_FAILED` | setAudioModeAsync threw | Once | Log, continue without background audio |

## Recovery Procedures

### Stale Callback
When operation ID mismatches, ignore the callback. Log at debug level.
No user action needed.

### Player Recreation
On `NATIVE_ERROR`:
1. Dispose the current player
2. Create a new ExpoAudioAdapter
3. Reload the current track
4. If it fails again, enter error state

### Interrupted Download
On startup, `DownloadManager.reconcile()`:
1. Find downloads in 'downloading'/'validating'/'publishing'
2. Delete their staging files
3. Mark as 'failed' with `INTERRUPTED`
4. User can manually retry

### Missing File
When `resolveSource` returns `file_missing`:
1. Update track's download_status to 'failed' in SQLite
2. Show "File missing" in UI
3. Offer "Redownload" button

## Logging

All errors log with:
- `event`: e.g. 'track_load_failed'
- `layer`: e.g. 'native_player'
- `errorCode`: e.g. 'LOAD_FAILED'
- `errorMessage`: human-readable
- `trackId`, `operationId` for correlation
- Never log: URLs with tokens, file absolute paths, user data
