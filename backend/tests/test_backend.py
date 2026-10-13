"""DropWave backend regression suite.

Covers the deterministic YouTube-matching pipeline and the HTTP route
contracts. Nothing here touches the network: all external calls are
monkeypatched. Run with: ./venv/bin/python -m pytest tests/ -q
"""
import json

import pytest
from fastapi.testclient import TestClient

import main


@pytest.fixture()
def client():
    return TestClient(main.app)


@pytest.fixture()
def tmp_cache(tmp_path, monkeypatch):
    """Redirect the match cache to a temp file so tests never touch the real one."""
    path = str(tmp_path / "match-cache.json")
    monkeypatch.setattr(main, "CACHE_PATH", path)
    return path


# ---------------------------------------------------------------- detect_source

@pytest.mark.parametrize(
    "url,expected",
    [
        ("https://open.spotify.com/track/abc123XYZ9", "spotify"),
        ("https://open.spotify.com/intl-de/track/abc123XYZ9", "spotify"),
        ("https://music.apple.com/us/album/foo/123?i=456", "apple"),
        ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube"),
        ("https://youtu.be/dQw4w9WgXcQ", "youtube"),
        ("https://music.youtube.com/watch?v=dQw4w9WgXcQ", "youtube"),
        ("HTTPS://OPEN.SPOTIFY.COM/track/abc123XYZ9", "spotify"),
    ],
)
def test_detect_source(url, expected):
    assert main.detect_source(url) == expected


# ---------------------------------------------------------------- spotify_track_id

def test_spotify_track_id_standard():
    assert main.spotify_track_id("https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh") == "4iV5W9uYEdYUVa79Axb7Rh"


def test_spotify_track_id_localized_path():
    assert main.spotify_track_id("https://open.spotify.com/intl-fr/track/4iV5W9uYEdYUVa79Axb7Rh?si=x") == "4iV5W9uYEdYUVa79Axb7Rh"


def test_spotify_track_id_rejects_non_track():
    assert main.spotify_track_id("https://open.spotify.com/album/abc123XYZ9") is None
    assert main.spotify_track_id("https://www.youtube.com/watch?v=x") is None
    assert main.spotify_track_id("not a url") is None


# ---------------------------------------------------------------- normalize

def test_normalize_strips_noise_tags_but_keeps_version_tags():
    assert main.normalize("Blinding Lights (Official Music Video)") == "blinding lights"
    assert main.normalize("Song (Official Video)") == "song"
    assert main.normalize("Song (Lyric Video)") == "song"
    # Version-significant tags must survive so the penalty system sees them
    assert main.normalize("Song (Remix)") == "song remix"
    assert "live" in main.normalize("Song (Live)")


def test_normalize_collapses_whitespace_and_punctuation():
    assert main.normalize("  The   Weeknd - Blinding   Lights! ") == "the weeknd blinding lights"


# ---------------------------------------------------------------- title_similarity

def test_title_similarity_identical_is_high():
    assert main.title_similarity("Blinding Lights", "Blinding Lights") >= 0.9


def test_title_similarity_empty_is_zero():
    assert main.title_similarity("", "Blinding Lights") == 0.0
    assert main.title_similarity("Blinding Lights", "") == 0.0


def test_title_similarity_unrelated_is_low():
    assert main.title_similarity("Blinding Lights", "Quantum Field Theory Lecture 12") < 0.4


# ---------------------------------------------------------------- artist_score

def test_artist_score_in_title_is_full():
    assert main.artist_score("The Weeknd", "The Weeknd - Blinding Lights", "Some Channel") == 1.0


def test_artist_score_in_channel_is_full():
    assert main.artist_score("The Weeknd", "Blinding Lights", "The Weeknd - Topic") == 1.0


def test_artist_score_spaceless_channel_name_is_partial():
    # "TheWeekndVEVO" has no spaces, so the spaced artist name is not a
    # substring: partial token match only. The VEVO bonus in
    # score_candidate still recognizes it as official.
    assert main.artist_score("The Weeknd", "Blinding Lights", "TheWeekndVEVO") == 0.5


def test_artist_score_partial_token_is_half():
    assert main.artist_score("Taylor Swift", "Taylor acoustic live session", "random") == 0.5


def test_artist_score_no_match_is_zero():
    assert main.artist_score("Adele", "Hello from the other side", "random channel") == 0.0


def test_artist_score_empty_artist_is_zero():
    assert main.artist_score("", "anything", "anything") == 0.0


# ---------------------------------------------------------------- duration_score

def test_duration_score_close_is_full():
    score, hard_fail = main.duration_score(200, 202)
    assert score == 1.0 and hard_fail is False


def test_duration_score_within_15_is_neutral():
    score, hard_fail = main.duration_score(200, 210)
    assert score == 0.5 and hard_fail is False


def test_duration_score_far_is_hard_fail():
    score, hard_fail = main.duration_score(200, 400)
    assert score == 0.0 and hard_fail is True


def test_duration_score_unknown_is_neutral():
    score, hard_fail = main.duration_score(200, None)
    assert score == 0.5 and hard_fail is False
    score, hard_fail = main.duration_score(None, 200)
    assert score == 0.5 and hard_fail is False


# ---------------------------------------------------------------- is_official_channel

def test_is_official_channel():
    assert main.is_official_channel("TheWeekndVEVO", "The Weeknd") is True
    assert main.is_official_channel("The Weeknd - Topic", "The Weeknd") is True
    assert main.is_official_channel("The Weeknd", "The Weeknd") is True
    assert main.is_official_channel("Some Random Channel", "The Weeknd") is False
    assert main.is_official_channel("", "The Weeknd") is False


# ---------------------------------------------------------------- score_candidate

SP = {"title": "Blinding Lights", "artist": "The Weeknd", "durationSec": 200}

STUDIO = {
    "id": "studio1",
    "title": "The Weeknd - Blinding Lights (Official Video)",
    "channel": "TheWeekndVEVO",
    "duration": 202,
    "webpage_url": "https://youtube.com/watch?v=studio1",
    "thumbnail": "t1",
}

LIVE_COVER = {
    "id": "live2",
    "title": "Blinding Lights (Live Cover) - SomeGuy",
    "channel": "SomeGuy Music",
    "duration": 205,
    "webpage_url": "https://youtube.com/watch?v=live2",
    "thumbnail": "t2",
}


def test_score_candidate_prefers_official_studio_over_live_cover():
    studio = main.score_candidate(SP, STUDIO)
    live = main.score_candidate(SP, LIVE_COVER)
    assert studio["scores"]["total"] > live["scores"]["total"]
    assert "official channel +0.15" in studio["scores"]["bonuses"]
    assert "'live' -0.25" in live["scores"]["penalties"]
    assert "'cover' -0.25" in live["scores"]["penalties"]


def test_score_candidate_no_penalty_when_word_in_original():
    sp = {"title": "Song (Live)", "artist": "Band", "durationSec": 200}
    cand = {"id": "x", "title": "Band - Song (Live)", "channel": "Band",
            "duration": 200, "webpage_url": "u", "thumbnail": "t"}
    scored = main.score_candidate(sp, cand)
    assert scored["scores"]["penalties"] == []
    assert scored["hardFail"] is False


def test_score_candidate_hard_fail_on_duration_mismatch():
    cand = dict(STUDIO)
    cand["duration"] = 400
    scored = main.score_candidate(SP, cand)
    assert scored["hardFail"] is True
    assert scored["scores"]["durationScore"] == 0.0


def test_score_candidate_result_shape():
    scored = main.score_candidate(SP, STUDIO)
    assert set(scored) >= {"videoId", "title", "channel", "durationSec",
                           "webpageUrl", "thumbnail", "scores", "hardFail"}
    assert scored["videoId"] == "studio1"
    assert isinstance(scored["scores"]["total"], float)


# ---------------------------------------------------------------- match_youtube determinism

def _cand(vid):
    return {"id": vid, "title": "The Weeknd - Blinding Lights (Official Video)",
            "channel": "TheWeekndVEVO", "duration": 202,
            "webpage_url": f"https://youtube.com/watch?v={vid}", "thumbnail": "t"}


def test_match_youtube_is_deterministic_and_tiebreaks_on_video_id(tmp_cache, monkeypatch):
    calls = []

    def fake_search(query, n=10):
        calls.append(query)
        # identical scores: tiebreak must pick the lower video id
        return [_cand("id_b"), _cand("id_a")]

    monkeypatch.setattr(main, "ytdlp_search", fake_search)
    first = main.match_youtube(SP, cache_key="https://open.spotify.com/track/xyz")
    assert first["videoId"] == "id_a"
    assert calls, "ytdlp_search must be consulted on a cache miss"

    second = main.match_youtube(SP, cache_key="https://open.spotify.com/track/xyz")
    assert second["videoId"] == "id_a"
    assert len(calls) == 1, "second call must be served from the cache, not a new search"


def test_match_youtube_prefers_best_score(tmp_cache, monkeypatch):
    monkeypatch.setattr(main, "ytdlp_search", lambda q, n=10: [LIVE_COVER, STUDIO])
    best = main.match_youtube(SP, cache_key="https://open.spotify.com/track/abc")
    assert best["videoId"] == "studio1"
    assert best["spotifyTitle"] == "Blinding Lights"
    # cache file was actually written
    with open(tmp_cache) as f:
        assert "https://open.spotify.com/track/abc" in json.load(f)


# ---------------------------------------------------------------- cache round trip

def test_cache_round_trip(tmp_cache):
    entry = {"videoId": "v1", "title": "T"}
    main.save_cache_entry("https://x/track/1", entry)
    assert main.load_cache()["https://x/track/1"] == entry


def test_load_cache_missing_file_returns_empty(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "CACHE_PATH", str(tmp_path / "nope.json"))
    assert main.load_cache() == {}


# ---------------------------------------------------------------- misc helpers

def test_estimate_bytes():
    assert main.estimate_bytes(128, 120) == 1_920_000
    assert main.estimate_bytes(320, 120) == 4_800_000
    assert main.estimate_bytes(128, None) is None


def test_sanitize_filename():
    assert main.sanitize_filename('a/b\\c:d*e?f"g<h>i|j') == "abcdefghij"
    assert main.sanitize_filename("") == "track"
    assert len(main.sanitize_filename("x" * 200)) == 120


# ---------------------------------------------------------------- routes

def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"ok": True}


def test_probe_rejects_non_http_url(client):
    r = client.post("/probe", json={"url": "not a link"})
    assert r.status_code == 422


def test_probe_youtube_url_contract(client, monkeypatch):
    def fake_dump(url):
        return {"title": "Some Title", "artist": None, "uploader": "Some Channel",
                "duration": 200, "thumbnail": "thumb",
                "webpage_url": "https://youtube.com/watch?v=x"}

    monkeypatch.setattr(main, "ytdlp_dump_one", fake_dump)
    r = client.post("/probe", json={"url": "https://www.youtube.com/watch?v=x"})
    assert r.status_code == 200
    body = r.json()
    assert body["title"] == "Some Title"
    assert body["artist"] == "Some Channel"
    assert body["source"] == "youtube"
    assert body["matchedFromYoutube"] is False
    assert body["resolvedUrl"] == "https://youtube.com/watch?v=x"
    qualities = {q["id"]: q for q in body["qualities"]}
    assert set(qualities) == {"q128", "q192", "q320"}
    # 128 kbps x 200 s = 3,200,000 bytes, shown in the app before download
    assert qualities["q128"]["estBytes"] == 3_200_000


def test_probe_spotify_url_contract(client, monkeypatch, tmp_cache):
    monkeypatch.setattr(
        main, "spotify_metadata",
        lambda url: {"title": "Blinding", "artist": "Weeknd",
                     "durationSec": 200, "thumbnail": None},
    )
    monkeypatch.setattr(
        main, "match_youtube",
        lambda sp, cache_key: {"videoId": "v1", "title": "YT Title", "channel": "Chan",
                               "webpageUrl": "https://youtube.com/watch?v=v1",
                               "durationSec": 201, "thumbnail": None, "scores": []},
    )
    r = client.post("/probe", json={"url": "https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh"})
    assert r.status_code == 200
    body = r.json()
    assert body["source"] == "spotify"
    assert body["matchedFromYoutube"] is True
    assert body["match"]["videoId"] == "v1"
    assert body["resolvedUrl"] == "https://youtube.com/watch?v=v1"


def test_probe_spotify_link_without_track_id_is_422_without_network(client, monkeypatch):
    def boom(*a, **k):
        raise AssertionError("must not touch the network for a bad link")

    monkeypatch.setattr(main, "fetch_text", boom)
    r = client.post("/probe", json={"url": "https://open.spotify.com/album/abc123XYZ9"})
    assert r.status_code == 422


def test_download_rejects_unknown_quality_before_network(client, monkeypatch):
    def boom(*a, **k):
        raise AssertionError("must not touch the network for a bad quality")

    monkeypatch.setattr(main, "resolve_youtube_url", boom)
    r = client.post("/download", json={"url": "https://www.youtube.com/watch?v=x", "quality": "q999"})
    assert r.status_code == 422
    r = client.get("/download", params={"url": "https://www.youtube.com/watch?v=x", "quality": "q999"})
    assert r.status_code == 422
