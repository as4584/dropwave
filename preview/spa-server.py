#!/usr/bin/env python3
"""Static file server with SPA fallback for the DropWave web preview.

Serves dist/ on port 8083. Any request that does not map to a real file
(e.g. /download, /settings loaded directly) falls back to dist/index.html
so the expo-router app can handle the route client-side.
"""
import http.server
import os
from urllib.parse import unquote, urlparse

DIST = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "dist")
PORT = 8083


class SPAHandler(http.server.SimpleHTTPRequestHandler):
    def _target(self):
        raw = unquote(urlparse(self.path).path)
        full = os.path.normpath(os.path.join(DIST, raw.lstrip("/")))
        if not full.startswith(DIST):
            return None
        if os.path.isfile(full):
            return raw
        return "/index.html"

    def _serve(self, serve_fn):
        target = self._target()
        if target is None:
            self.send_error(403, "Forbidden")
            return
        self.path = target
        serve_fn()

    def do_GET(self):
        self._serve(lambda: super(SPAHandler, self).do_GET())

    def do_HEAD(self):
        self._serve(lambda: super(SPAHandler, self).do_HEAD())

    def log_message(self, *args):
        pass  # quiet


if __name__ == "__main__":
    if not os.path.isdir(DIST):
        raise SystemExit("dist/ not found. Run: npx expo export --platform web")
    from functools import partial

    handler = partial(SPAHandler, directory=DIST)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler)
    server.daemon_threads = True
    server.serve_forever()
