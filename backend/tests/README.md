# DropWave backend regression tests

42 tests covering the deterministic YouTube-matching pipeline and the
`/health`, `/probe`, `/download` route contracts. No test touches the
network; external calls (Spotify, yt-dlp) are monkeypatched.

Run from the backend dir:

```
./venv/bin/python -m pytest tests/ -q
```

What is covered:

- `detect_source`, `spotify_track_id` URL parsing (incl. localized Spotify paths)
- `normalize`, `title_similarity`, `artist_score`, `duration_score`,
  `is_official_channel` scoring primitives
- `score_candidate`: official studio video outranks live covers, penalties and
  bonuses recorded, hard-fail on duration mismatch
- `match_youtube`: deterministic pick (score desc, video_id asc tiebreak) and
  cache-hit behavior
- Match cache round trip
- `estimate_bytes`, `sanitize_filename`
- Route contracts: `/health`, `/probe` for YouTube/Spotify/bad links,
  `/download` rejects unknown quality before any network call

Not covered yet: the Expo frontend (React Native) and live end-to-end
downloads, which still need a real device or network.
