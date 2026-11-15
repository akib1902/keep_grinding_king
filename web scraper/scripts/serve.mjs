#!/usr/bin/env node
/* scraperStack · tiny static server for the demo pages (no dependencies). */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.argv[2] || process.env.PORT || 4321);
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2'
};

function send(res, status, body, type) {
  res.writeHead(status, {
    'content-type': type || 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(body);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/demo/index.html';

    const filePath = resolve(ROOT, '.' + pathname);
    if (filePath !== ROOT && !filePath.startsWith(ROOT + sep)) {
      send(res, 403, 'Forbidden');
      return;
    }

    let target = filePath;
    let info = await stat(target).catch(() => null);
    if (info && info.isDirectory()) {
      target = resolve(filePath, 'index.html');
      info = await stat(target).catch(() => null);
    }
    if (!info) {
      send(res, 404, `Not found: ${pathname}`);
      return;
    }

    const body = await readFile(target);
    if (req.method === 'HEAD') {
      res.writeHead(200, {
        'content-type': MIME[extname(target).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-store'
      });
      res.end();
      return;
    }
    send(res, 200, body, MIME[extname(target).toLowerCase()] || 'application/octet-stream');
  } catch (err) {
    send(res, 500, 'Internal error');
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Try: node scripts/serve.mjs 4322`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  console.log(`scraperStack dev server → http://localhost:${PORT}/demo/`);
  console.log(`  shop      http://localhost:${PORT}/demo/shop.html`);
  console.log(`  table     http://localhost:${PORT}/demo/table.html`);
  console.log(`  load more http://localhost:${PORT}/demo/loadmore.html`);
});
