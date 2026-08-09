/**
 * Local board server for `ticket ui`.
 *
 * One process: serves the static board + the same JSON contract as
 * `unticked/adapters/next`. Binds to 127.0.0.1 by default so a random
 * visitor on the LAN cannot rewrite your backlog.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

function json(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function safePublicPath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const rel = decoded === '/' ? '/index.html' : decoded;
  const abs = path.normalize(path.join(PUBLIC, rel));
  if (!abs.startsWith(PUBLIC + path.sep) && abs !== PUBLIC) return null;
  return abs;
}

/**
 * @param {object} opts
 * @param {string} opts.root       repo root that contains .tickets/
 * @param {number} [opts.port]
 * @param {string} [opts.host]
 * @param {boolean} [opts.readOnly]
 * @param {number} [opts.pollMs]   suggested client poll interval
 * @returns {Promise<{ url: string, port: number, host: string, close: () => Promise<void> }>}
 */
export function startUiServer(opts) {
  const root = core.requireRoot(opts.root);
  const host = opts.host || '127.0.0.1';
  const port = opts.port ?? 3847;
  const readOnly = !!opts.readOnly;
  const pollMs = opts.pollMs ?? 4000;

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${host}`);
      const method = req.method || 'GET';

      if (url.pathname === '/api/meta' && method === 'GET') {
        return json(res, {
          schemaVersion: core.SCHEMA_VERSION,
          readOnly,
          pollMs,
          root,
          config: core.readConfig(root),
        });
      }

      if (url.pathname === '/api/tickets' && method === 'GET') {
        const id = url.searchParams.get('id');
        if (id) {
          return json(res, {
            schemaVersion: core.SCHEMA_VERSION,
            ticket: core.get(root, id),
          });
        }
        const tickets = core.list(root, {
          status: url.searchParams.get('status') || undefined,
          tag: url.searchParams.get('tag') || undefined,
          doc: url.searchParams.get('doc') || undefined,
          q: url.searchParams.get('q') || undefined,
        });
        return json(res, {
          schemaVersion: core.SCHEMA_VERSION,
          tickets,
          docs: core.docStatuses(root),
          orphanDocs: core.orphanedDocs(root),
          config: core.readConfig(root),
          readOnly,
          pollMs,
          generatedAt: new Date().toISOString(),
        });
      }

      if (url.pathname === '/api/tickets' && method === 'POST') {
        if (readOnly) return json(res, { error: 'read-only' }, 403);
        const b = await readBody(req);
        switch (b.action) {
          case 'create':
            return json(res, { ticket: core.create(root, b) });
          case 'status':
            return json(res, { ticket: core.setStatus(root, b.id, b.status) });
          case 'note':
            return json(res, { ticket: core.addNote(root, b.id, b.text) });
          case 'remove':
            return json(res, { ticket: core.remove(root, b.id) });
          case 'archive':
            return json(res, { archived: core.archiveDoc(root, b.doc, { force: !!b.force }) });
          default:
            return json(res, { error: `unknown action: ${b.action}` }, 400);
        }
      }

      if (method !== 'GET' && method !== 'HEAD') {
        return json(res, { error: 'method not allowed' }, 405);
      }

      const file = safePublicPath(url.pathname);
      if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        return json(res, { error: 'not found' }, 404);
      }
      const ext = path.extname(file);
      res.writeHead(200, {
        'content-type': MIME[ext] || 'application/octet-stream',
        'cache-control': ext === '.html' ? 'no-store' : 'public, max-age=3600',
      });
      if (method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    } catch (err) {
      json(res, { error: err.message || String(err) }, 400);
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;
      const url = `http://${host}:${actualPort}/`;
      resolve({
        url,
        port: actualPort,
        host,
        root,
        readOnly,
        close: () =>
          new Promise((res, rej) => {
            server.close(err => (err ? rej(err) : res()));
          }),
      });
    });
  });
}
