/**
 * HTTP adapter — the ~20 lines a web client needs, because a browser cannot
 * read `.tickets/` itself.
 *
 * Built on the standard Request/Response pair, so it works in a Next.js App
 * Router route handler, Hono, Bun.serve, Deno.serve — anything Fetch-shaped
 * that runs on a machine with the repo on disk.
 *
 *   // app/api/tickets/route.ts
 *   import { createTicketRoute } from 'unticked/adapters/next';
 *   export const { GET, POST } = createTicketRoute({ cwd: process.env.REPO_PATH });
 *
 * The JSON it returns is exactly what `ticket ls --json` prints.
 */

import * as core from '../core.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

/**
 * @param {object} [opts]
 * @param {string} [opts.cwd]       where to look for `.tickets/` (default: process.cwd())
 * @param {boolean} [opts.readOnly] refuse writes — use this if the host app is
 *                                  reachable by anyone you would not hand a shell to
 */
export function createTicketRoute(opts = {}) {
  const root = () => core.requireRoot(opts.cwd || process.cwd());

  async function GET(request) {
    try {
      const p = new URL(request.url).searchParams;
      if (p.get('id')) return json({ schemaVersion: core.SCHEMA_VERSION, ticket: core.get(root(), p.get('id')) });
      const tickets = core.list(root(), {
        status: p.get('status') || undefined,
        tag: p.get('tag') || undefined,
        doc: p.get('doc') || undefined,
        q: p.get('q') || undefined,
      });
      return json({
        schemaVersion: core.SCHEMA_VERSION,
        tickets,
        // Every linked document with its derived status. `orphanDocs` is the
        // subset safe to archive, kept as its own field so clients that only
        // want the nudge do not have to filter.
        docs: core.docStatuses(root()),
        orphanDocs: core.orphanedDocs(root()),
        config: core.readConfig(root()),
      });
    } catch (err) {
      return json({ error: err.message }, 400);
    }
  }

  async function POST(request) {
    if (opts.readOnly) return json({ error: 'read-only' }, 403);
    try {
      const b = await request.json();
      switch (b.action) {
        case 'create':
          return json({ ticket: core.create(root(), b) });
        case 'status':
          return json({ ticket: core.setStatus(root(), b.id, b.status) });
        case 'note':
          return json({ ticket: core.addNote(root(), b.id, b.text) });
        case 'remove':
          return json({ ticket: core.remove(root(), b.id) });
        case 'archive':
          return json({ archived: core.archiveDoc(root(), b.doc, { force: !!b.force }) });
        default:
          return json({ error: `unknown action: ${b.action}` }, 400);
      }
    } catch (err) {
      return json({ error: err.message }, 400);
    }
  }

  return { GET, POST };
}
