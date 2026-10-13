"""DropWave backend: probe + download service built on yt-dlp.

Honest architecture:
- YouTube URLs download directly.
- Spotify URLs are DRM-locked: the backend reads track METADATA (title, artist,
  duration, artwork) from the Spotify embed page, then deterministically matches
  the track to the best YouTube video with a scoring function. The same Spotify
  link always resolves to the same YouTube video (score sort + video_id
  tiebreak + a persistent JSON cache).
- Apple Music: metadata path stubbed (deprioritized), downloads match via
  YouTube like Spotify.
- yt-dlp is Python and cannot run on-device: all fetching happens here.
  The app only talks HTTP to this service and saves files locally.
"""
from __future__ import annotations

import glob
import html as htmlmod
import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
import time
import urllib.parse
import urllib.request
from difflib import SequenceMatcher

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

log = logging.getLogger("dropwave")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

app = FastAPI(title="DropWave backend")

# The web preview calls this API from the browser, possibly cross-origin.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
YTDLP = os.path.join(BASE_DIR, "venv", "bin", "yt-dlp")
if not os.path.exists(YTDLP):
    YTDLP = shutil.which("yt-dlp") or "yt-dlp"

CACHE_PATH = os.path.join(BASE_DIR, "match-cache.json")

BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)

QUALITIES: dict[str, dict] = {
    "q128": {"label": "128 kbps", "bitrate": 128, "ext": "m4a"},
    "q192": {"label": "192 kbps", "bitrate": 192, "ext": "m4a"},
    "q320": {"label": "320 kbps", "bitrate": 320, "ext": "m4a"},
}

# Words that usually mean "not the studio track". Penalized in candidates
# unless the same word is in the original Spotify title.
PENALTY_WORDS = ["live", "cover", "karaoke", "sped up", "slowed", "8d audio",
                 "nightcore", "tiktok", "reverb"]


# ---------------------------------------------------------------- models

class ProbeRequest(BaseModel):
    url: str


class DownloadRequest(BaseModel):
    url: str
    quality: str = "q320"
    resolvedUrl: str | None = None


# ---------------------------------------------------------------- cache

def load_cache() -> dict:
    try:
        with open(CACHE_PATH) as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}


def save_cache_entry(spotify_url: str, entry: dict) -> None:
    cache = load_cache()
    cache[spotify_url] = entry
    tmp = CACHE_PATH + ".tmp"
    with open(tmp, "w") as f:
        json.dump(cache, f, indent=1)
    os.replace(tmp, CACHE_PATH)


# ---------------------------------------------------------------- helpers

def detect_source(url: str) -> str:
    host = urllib.parse.urlparse(url).netloc.lower()
    if "spotify.com" in host:
        return "spotify"
    if "apple.com" in host:
        return "apple"
    return "youtube"


def fetch_text(url: str, timeout: int = 25, retries: int = 3) -> str:
    # NOTE: egress goes through a proxy that intermittently truncates
    # Spotify responses (IncompleteRead / RemoteDisconnected). Retry
    # transient failures before giving up.
    req = urllib.request.Request(url, headers={"User-Agent": BROWSER_UA})
    last: Exception | None = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode("utf-8", errors="replace")
        except Exception as e:  # noqa: BLE001 - retry, then raise below
            last = e
            time.sleep(1 + attempt)
    assert last is not None
    raise last


def spotify_track_id(url: str) -> str | None:
    m = re.search(r"open\.spotify\.com/(?:[a-z-]+/)?track/([A-Za-z0-9]{10,})", url)
    return m.group(1) if m else None


def spotify_metadata(url: str) -> dict:
    """Title, artist, duration, artwork from the Spotify embed page's JSON.

    oEmbed has no duration, so we use the embed page __NEXT_DATA__ instead.
    """
    track_id = spotify_track_id(url)
    if not track_id:
        raise HTTPException(422, "That does not look like a Spotify track link")
    try:
        page = fetch_text(f"https://open.spotify.com/embed/track/{track_id}")
    except Exception as e:
        raise HTTPException(502, f"Couldn't reach Spotify: {e}")
    m = re.search(
        r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>',
        page, re.S,
    )
    if not m:
        raise HTTPException(502, "Spotify returned an unreadable page, try again")
    try:
        data = json.loads(htmlmod.unescape(m.group(1)))
        page_props = data["props"]["pageProps"]
    except (json.JSONDecodeError, KeyError):
        raise HTTPException(502, "Spotify returned an unreadable page, try again")
    if page_props.get("status") == 500 or page_props.get("title") == "Page not available":
        raise HTTPException(422, "Spotify says that track does not exist")
    try:
        entity = page_props["state"]["data"]["entity"]
        title = entity["title"]
        artists = ", ".join(a["name"] for a in entity.get("artists", []) if a.get("name"))
        duration_ms = entity.get("duration")
        images = (entity.get("visualIdentity") or {}).get("image") or []
        artwork = images[0]["url"] if images else None
    except (KeyError, TypeError, IndexError):
        raise HTTPException(502, "Spotify changed its page format, try again later")
    if not title:
        raise HTTPException(422, "Could not read track info from that Spotify link")
    return {
        "title": title.strip(),
        "artist": artists.strip(),
        "durationSec": round(duration_ms / 1000) if duration_ms else None,
        "thumbnail": artwork,
    }


def apple_metadata(url: str) -> dict:
    """Stubbed: metadata via the free iTunes Search API (Apple path deprioritized)."""
    parsed = urllib.parse.urlparse(url)
    qs = urllib.parse.parse_qs(parsed.query)
    track_id = (qs.get("i") or [None])[0]
    if track_id and track_id.isdigit():
        req = urllib.request.Request(
            f"https://itunes.apple.com/lookup?id={track_id}",
            headers={"User-Agent": BROWSER_UA},
        )
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.load(r)
        results = data.get("results") or []
        if results:
            t = results[0]
            art = (t.get("artworkUrl100") or "").replace("100x100bb", "600x600bb")
            ms = t.get("trackTimeMillis") or 0
            return {
                "title": (t.get("trackName") or "").strip(),
                "artist": (t.get("artistName") or "").strip(),
                "durationSec": int(ms // 1000) or None,
                "thumbnail": art or None,
            }
    raise HTTPException(422, "Could not read track info from that Apple Music link")


def ytdlp_search(query: str, n: int = 10) -> list[dict]:
    """Full (non-flat) dump-json for ytsearch so we get duration + channel."""
    cmd = [YTDLP, "--dump-json", "--no-download", "--no-playlist",
           "--no-warnings", f"ytsearch{n}:{query}"]
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=240)
    except subprocess.TimeoutExpired:
        raise HTTPException(504, "YouTube search timed out, try again")
    if p.returncode != 0:
        err = (p.stderr or "").strip().splitlines()
        raise HTTPException(502, "YouTube search failed: " + (" ".join(err[-2:]) or "unknown"))
    out = []
    for line in p.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out


def ytdlp_dump_one(url: str) -> dict:
    cmd = [YTDLP, "--dump-json", "--no-download", "--no-playlist", "--no-warnings", url]
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
    except subprocess.TimeoutExpired:
        raise HTTPException(504, "Video lookup timed out, try again")
    if p.returncode != 0:
        err = (p.stderr or "").strip().splitlines()
        raise HTTPException(502, "Lookup failed: " + (" ".join(err[-2:]) or "unknown error"))
    try:
        return json.loads(p.stdout)
    except json.JSONDecodeError:
        raise HTTPException(502, "Lookup returned bad data, try again")


# ---------------------------------------------------------------- matching

# Only strip tags that carry no musical meaning (official video, lyrics, ...).
# Version-significant tags like (remix), (live), (acoustic) are KEPT so they
# count in similarity; the penalty system handles the unwanted ones.
NOISE_TAG_RE = re.compile(
    r"[\(\[]\s*(official\s+)?"
    r"(music\s+video|video|audio|lyric(s)?(\s+video)?|visualizer|mv|hd|4k|hq)"
    r"\s*[\)\]]",
    re.I,
)

def normalize(s: str) -> str:
    s = (s or "").lower()
    s = NOISE_TAG_RE.sub(" ", s)                 # strip noise tags only
    s = re.sub(r"[^a-z0-9 ]", " ", s)            # strip punctuation
    return re.sub(r"\s+", " ", s).strip()


def title_similarity(sp_title: str, yt_title: str) -> float:
    a, b = normalize(sp_title), normalize(yt_title)
    if not a or not b:
        return 0.0
    seq = SequenceMatcher(None, a, b).ratio()
    at, bt = set(a.split()), set(b.split())
    overlap = len(at & bt) / max(len(at), 1)
    return 0.5 * seq + 0.5 * overlap


def artist_score(sp_artist: str, yt_title: str, channel: str) -> float:
    """1.0 if the artist appears in the title or channel, 0.5 partial, else 0."""
    a = normalize(sp_artist)
    if not a:
        return 0.0
    t, c = normalize(yt_title), normalize(channel or "")
    if a in t or a in c:
        return 1.0
    # partial: any significant token of the artist name matches
    tokens = [w for w in a.split() if len(w) > 2]
    if tokens and any(w in t or w in c for w in tokens):
        return 0.5
    return 0.0


def duration_score(sp_dur: int | None, yt_dur: int | None) -> tuple[float, bool]:
    """Returns (score, hard_fail). Neutral 0.5 when either side is unknown."""
    if sp_dur is None or yt_dur is None:
        return 0.5, False
    diff = abs(sp_dur - yt_dur)
    if diff <= 4:
        return 1.0, False
    if diff <= 15:
        return 0.5, False
    return 0.0, True


def is_official_channel(channel: str, sp_artist: str) -> bool:
    c = (channel or "").strip()
    if not c:
        return False
    if c.endswith("VEVO") or c.endswith("- Topic"):
        return True
    return normalize(sp_artist) in normalize(c)


def score_candidate(sp: dict, cand: dict) -> dict:
    yt_title = cand.get("title") or ""
    channel = cand.get("channel") or cand.get("uploader") or ""
    sp_title_raw = sp["title"] or ""

    t = title_similarity(sp_title_raw, yt_title)
    a = artist_score(sp.get("artist") or "", yt_title, channel)
    d, hard_fail = duration_score(sp.get("durationSec"), cand.get("duration"))

    score = 0.45 * t + 0.30 * a + 0.25 * d

    bonuses: list[str] = []
    penalties: list[str] = []
    if is_official_channel(channel, sp.get("artist") or ""):
        score += 0.15
        bonuses.append("official channel +0.15")

    yt_low = yt_title.lower()
    sp_low = sp_title_raw.lower()
    for word in PENALTY_WORDS + (["remix"] if "remix" not in sp_low else []):
        if word in yt_low and word not in sp_low:
            score -= 0.25
            penalties.append(f"'{word}' -0.25")

    return {
        "videoId": cand.get("id"),
        "title": yt_title,
        "channel": channel,
        "durationSec": cand.get("duration"),
        "webpageUrl": cand.get("webpage_url"),
        "thumbnail": cand.get("thumbnail"),
        "scores": {
            "titleScore": round(t, 3),
            "artistScore": round(a, 3),
            "durationScore": round(d, 3),
            "total": round(score, 3),
            "bonuses": bonuses,
            "penalties": penalties,
        },
        "hardFail": hard_fail,
    }


def match_youtube(sp: dict, cache_key: str) -> dict:
    """Deterministic pick: score desc, video_id asc tiebreak. Cached by URL."""
    cache = load_cache()
    if cache_key in cache:
        log.info("match cache HIT for %s -> %s", cache_key, cache[cache_key].get("videoId"))
        return cache[cache_key]

    query = f"{sp['artist']} {sp['title']}".strip()
    candidates = ytdlp_search(query, n=10)
    if not candidates:
        raise HTTPException(502, "No YouTube matches found for that track")

    scored = [score_candidate(sp, c) for c in candidates if c.get("id")]
    eligible = [s for s in scored if not s["hardFail"]] or scored  # hard-fail only if others exist
    eligible.sort(key=lambda s: (-s["scores"]["total"], s["videoId"] or ""))

    for s in eligible[:5]:
        log.info(
            "match candidate score=%.3f title=%r t=%.2f a=%.2f d=%.2f chan=%r pen=%s",
            s["scores"]["total"], s["title"][:60], s["scores"]["titleScore"],
            s["scores"]["artistScore"], s["scores"]["durationScore"],
            (s["channel"] or "")[:40],
            ",".join(s["scores"]["penalties"]) or "-",
        )
    best = eligible[0]
    log.info("match CHOSEN %s %r (score %.3f)", best["videoId"], best["title"][:60],
             best["scores"]["total"])

    entry = {
        "videoId": best["videoId"],
        "title": best["title"],
        "channel": best["channel"],
        "durationSec": best["durationSec"],
        "webpageUrl": best["webpageUrl"],
        "thumbnail": best["thumbnail"],
        "spotifyTitle": sp["title"],
        "spotifyArtist": sp["artist"],
        "spotifyDurationSec": sp.get("durationSec"),
        "scores": [
            {
                "videoId": s["videoId"],
                "videoTitle": s["title"],
                "candidateDurationSec": s["durationSec"],
                **s["scores"],
            }
            for s in eligible[:5]
        ],
    }
    save_cache_entry(cache_key, entry)
    return entry


def resolve_youtube_url(url: str, source: str) -> tuple[str, dict, bool, dict | None]:
    """Return (playable_url, metadata, matched_from_youtube, match_detail)."""
    if source == "youtube":
        info = ytdlp_dump_one(url)
        meta = {
            "title": info.get("title") or "Unknown title",
            "artist": info.get("artist") or info.get("uploader") or "Unknown artist",
            "durationSec": info.get("duration"),
            "thumbnail": info.get("thumbnail"),
        }
        return info.get("webpage_url") or url, meta, False, None

    if source == "spotify":
        try:
            sp = spotify_metadata(url)
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(502, f"Couldn't read that Spotify link: {e}")
        match = match_youtube(sp, cache_key=url)
        meta = {
            "title": sp["title"],
            "artist": sp["artist"],
            "durationSec": sp.get("durationSec") or match.get("durationSec"),
            "thumbnail": sp.get("thumbnail") or match.get("thumbnail"),
        }
        return match["webpageUrl"], meta, True, match

    # apple (stubbed path, deprioritized)
    try:
        sp = apple_metadata(url)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Couldn't read that Apple Music link: {e}")
    match = match_youtube(sp, cache_key=url)
    meta = {
        "title": sp["title"],
        "artist": sp["artist"],
        "durationSec": sp.get("durationSec") or match.get("durationSec"),
        "thumbnail": sp.get("thumbnail") or match.get("thumbnail"),
    }
    return match["webpageUrl"], meta, True, match


# ---------------------------------------------------------------- misc

def estimate_bytes(bitrate_kbps: int, duration_sec: int | None) -> int | None:
    if not duration_sec:
        return None
    return int(bitrate_kbps * 1000 / 8 * duration_sec)


def sanitize_filename(name: str) -> str:
    name = re.sub(r'[\\/:*?"<>|]+', "", name).strip()
    return name[:120] or "track"


# ---------------------------------------------------------------- routes

@app.get("/health")
def health():
    return {"ok": True}


@app.post("/probe")
def probe(req: ProbeRequest):
    url = (req.url or "").strip()
    if not url.startswith(("http://", "https://")):
        raise HTTPException(422, "Paste a full http(s) link")
    source = detect_source(url)
    resolved_url, meta, matched, match_detail = resolve_youtube_url(url, source)
    duration = meta.get("durationSec")
    qualities = [
        {
            "id": qid,
            "label": q["label"],
            "bitrate": q["bitrate"],
            "ext": q["ext"],
            "estBytes": estimate_bytes(q["bitrate"], duration),
        }
        for qid, q in QUALITIES.items()
    ]
    resp: dict = {
        "title": meta["title"],
        "artist": meta["artist"],
        "durationSec": duration,
        "thumbnail": meta.get("thumbnail"),
        "source": source,
        "matchedFromYoutube": matched,
        "resolvedUrl": resolved_url,
        "qualities": qualities,
    }
    if match_detail:
        resp["match"] = {
            "videoId": match_detail["videoId"],
            "title": match_detail["title"],
            "channel": match_detail["channel"],
            "scores": match_detail["scores"],
        }
    return resp


def _download_file(url: str, quality: str, resolved_url: str | None) -> tuple[str, str]:
    if quality not in QUALITIES:
        raise HTTPException(422, f"Unknown quality {quality}")
    q = QUALITIES[quality]
    source = detect_source(url)
    if resolved_url:
        playable, title = resolved_url, "track"
    else:
        playable, meta, _, _ = resolve_youtube_url(url, source)
        title = meta["title"] if meta else "track"
    tmpdir = tempfile.mkdtemp(prefix="dropwave-")
    out = os.path.join(tmpdir, "track.%(ext)s")
    # NOTE: the android player client bypasses YouTube's bot challenge for
    # datacenter IPs. It only offers combined AV formats, so we take best
    # and extract audio with ffmpeg (no -f bestaudio).
    cmd = [
        YTDLP, "--extractor-args", "youtube:player_client=android",
        "--extract-audio",
        "--audio-format", q["ext"], "--audio-quality", f"{q['bitrate']}K",
        "--no-playlist", "--no-warnings", "-o", out, playable,
    ]
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
    except subprocess.TimeoutExpired:
        shutil.rmtree(tmpdir, ignore_errors=True)
        raise HTTPException(504, "Download timed out, try again")
    if p.returncode != 0:
        shutil.rmtree(tmpdir, ignore_errors=True)
        err = (p.stderr or "").strip().splitlines()
        raise HTTPException(502, "Download failed: " + (" ".join(err[-2:]) or "unknown error"))
    files = glob.glob(os.path.join(tmpdir, "track.*"))
    if not files:
        shutil.rmtree(tmpdir, ignore_errors=True)
        raise HTTPException(502, "Download produced no file")
    return files[0], f"{sanitize_filename(title)}.{q['ext']}"


@app.post("/download")
def download_post(req: DownloadRequest, background: BackgroundTasks):
    path, filename = _download_file(req.url, req.quality, req.resolvedUrl)
    background.add_task(shutil.rmtree, os.path.dirname(path), True)
    return FileResponse(path, media_type="audio/mp4", filename=filename,
                        headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@app.get("/download")
def download_get(url: str, quality: str = "q320", resolvedUrl: str | None = None,
                 background: BackgroundTasks = None):
    # GET variant so expo-file-system can download without a POST body.
    path, filename = _download_file(url, quality, resolvedUrl)
    resp = FileResponse(path, media_type="audio/mp4", filename=filename,
                        headers={"Content-Disposition": f'attachment; filename="{filename}"'})
    if background is not None:
        background.add_task(shutil.rmtree, os.path.dirname(path), True)
    return resp
