/**
 * ZeenIQ Oracle & Database Tools - Web Server Engine
 * 
 * Standalone Web Edition server. Runs 100% in Node.js without Electron.
 * Serves the compiled React/Tailwind frontend (dist/) and Oracle DB API endpoints (/api/...).
 * 
 * Run:
 *   node server.js
 *   node server.js --port=3000 --open
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const { createApiMiddleware } = require('./scripts/api-middleware.js');

// Parse CLI Arguments
const args = process.argv.slice(2);
let PORT = parseInt(process.env.PORT || '3000', 10);
let shouldAutoOpen = false;

for (const arg of args) {
  if (arg.startsWith('--port=')) {
    PORT = parseInt(arg.replace('--port=', ''), 10) || 3000;
  } else if (arg === '--open') {
    shouldAutoOpen = true;
  }
}

// Find dist directory
let distDir = path.join(__dirname, 'dist');
if (!fs.existsSync(distDir)) {
  const altDist = path.join(__dirname, 'resources', 'app', 'dist');
  if (fs.existsSync(altDist)) {
    distDir = altDist;
  }
}

// MIME Types Map
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

// Discover Local Network IP
function getNetworkIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const list = interfaces[name];
    if (list) {
      for (const net of list) {
        if (!net.internal && net.family === 'IPv4' && net.address) {
          return net.address;
        }
      }
    }
  }
  return 'localhost';
}

// Static File Server
function serveStatic(req, res) {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = decodeURIComponent(parsedUrl.pathname);

  // Normalize route to index.html for root
  if (pathname === '/' || pathname === '') {
    pathname = '/index.html';
  }

  let filePath = path.join(distDir, pathname);

  // Security: prevent directory traversal
  if (!filePath.startsWith(distDir)) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }

  // Check if file exists, if not fallback to index.html (SPA routing)
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      filePath = path.join(distDir, 'index.html');
    }

    fs.readFile(filePath, (readErr, data) => {
      if (readErr) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('404 Not Found - Please run "npm run build" to compile web assets.');
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      // Cache control: assets get immutable cache, index.html is no-cache
      if (pathname.startsWith('/assets/')) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      }

      res.setHeader('Content-Type', contentType);
      res.statusCode = 200;
      res.end(data);
    });
  });
}

// Instantiate API middleware
const apiMiddleware = createApiMiddleware();

// Create HTTP Server
const server = http.createServer((req, res) => {
  // CORS Headers for flexible API calls
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  // API routing
  if (req.url && req.url.startsWith('/api/')) {
    apiMiddleware(req, res, () => {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Endpoint API tidak ditemukan.' }));
    });
    return;
  }

  // Static files routing
  serveStatic(req, res);
});

// Start listening
server.listen(PORT, '0.0.0.0', () => {
  const lanIp = getNetworkIp();
  const localUrl = `http://localhost:${PORT}/`;
  const networkUrl = `http://${lanIp}:${PORT}/`;

  console.log('\n================================================================');
  console.log('       \x1b[36m%s\x1b[0m', '🌐 ZeenIQ Oracle & Database Tools - Web Server');
  console.log('================================================================');
  console.log('  \x1b[32m%s\x1b[0m  %s', '➜  Local:  ', localUrl);
  console.log('  \x1b[35m%s\x1b[0m  %s', '➜  Network:', networkUrl);
  console.log('----------------------------------------------------------------');
  console.log('  \x1b[33m%s\x1b[0m', 'Akses dari browser Chrome, Edge, atau Firefox.');
  console.log('  \x1b[33m%s\x1b[0m', 'Teman di jaringan WiFi/LAN yang sama dapat membuka Network URL.');
  console.log('  Tekan \x1b[31mCtrl+C\x1b[0m untuk menghentikan server web.');
  console.log('================================================================\n');

  if (shouldAutoOpen) {
    const openCmd = process.platform === 'win32'
      ? `start ${localUrl}`
      : process.platform === 'darwin'
      ? `open ${localUrl}`
      : `xdg-open ${localUrl}`;
    exec(openCmd);
  }
});
