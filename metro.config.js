// Metro config: proxy /api/* to the DropWave FastAPI backend (localhost:8001).
// This lets the single Expo tunnel serve both the app (via EAS Update, which
// doesn't need the tunnel) and the backend API (which does).
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Add a simple proxy middleware for /api routes.
// Metro's server is a connect app; we hook into it via the `server` enhancer.
const http = require('http');

config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => {
    return (req, res, next) => {
      if (req.url.startsWith('/api/') || req.url === '/api') {
        // Proxy to FastAPI backend on 8001, stripping the /api prefix.
        const backendPath = req.url === '/api' ? '/' : req.url.slice(4);
        const proxyReq = http.request(
          {
            host: '127.0.0.1',
            port: 8001,
            path: backendPath,
            method: req.method,
            headers: req.headers,
          },
          (proxyRes) => {
            res.writeHead(proxyRes.statusCode, proxyRes.headers);
            proxyRes.pipe(res);
          }
        );
        proxyReq.on('error', (e) => {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'backend unreachable' }));
        });
        req.pipe(proxyReq);
      } else {
        middleware(req, res, next);
      }
    };
  },
};

module.exports = config;
