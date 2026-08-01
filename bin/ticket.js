#!/usr/bin/env node
/**
 * unticked CLI — the reference client, and the only supported way to write.
 *
 * Every read command supports `--json`, which is the contract other clients
 * build on. See SPEC.md.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as core from '../src/core.js';

const argv = process.argv.slice(2);
const cmd = argv.shift();

function flags(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const [k, inline] = a.slice(2).split('=');
      const next = args[i + 1];
      if (inline !== undefined) out[k] = inline;
      else if (next && !next.startsWith('--')) out[k] = args[++i];
      else out[k] = true;
    } else out._.push(a);
  }
  return out;
}

function csv(v) {
  return typeof v === 'string' ? v.split(',').map(s => s.trim()).filter(Boolean) : [];
}

function die(msg) {
  console.error(`ticket: ${msg}`);
  process.exit(1);
}

const COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const dim = s => (COLOR ? `\x1b[2m${s}\x1b[0m` : s);
const bold = s => (COLOR ? `\x1b[1m${s}\x1b[0m` : s);
const tint = (s, p) =>
  COLOR ? `\x1b[${{ p0: 31, p1: 33, p2: 36, p3: 90 }[p] || 36}m${s}\x1b[0m` : s;

function printList(tickets) {
  if (!tickets.length) return console.log(dim('no tickets'));
  for (const t of tickets) {
    const mark = { open: ' ', doing: '~', closed: 'x' }[t.status];
    const meta = [...t.tags.map(x => '#' + x), ...t.docs.map(d => '→ ' + d)].join(' ');
    console.log(`[${mark}] ${bold(t.id)} ${tint(t.priority, t.priority)} ${t.title}${meta ? ' ' + dim(meta) : ''}`);
  }
}

function stdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

const HELP = `unticked — tickets as markdown files in your repo

  ticket init [--docs-root docs] [--archive-root docs/archive]
                                       create .tickets/ here
  ticket config [--docs-root <path>] [--archive-root <path>] [--json]
  ticket new "<title>" [opts]          create a ticket, prints its id
      --body <text|->                  body text, or - to read stdin
      --docs a.md,b.md                 link to docs this ticket came from
      --tags ui,seo                    tags
      --priority p0|p1|p2|p3           default p2
  ticket ls [opts]                     list tickets (default: open + doing)
      --status open|doing|closed|all
      --tag <tag>  --doc <path>  --q <text>  --json
  ticket show <id> [--json]            show one ticket
  ticket start|close|reopen <id>       move between open / doing / closed
  ticket note <id> "<text>"            append a timestamped note
  ticket rm <id> --yes                 delete a ticket (closing is not this)

  ticket docs [--json]                 every linked doc + its derived status
      status is computed from the doc's tickets, never stored:
      未开始 → 进行中 → 已完成 → 已归档
  ticket doc new "<title>" [--dir <path>] [--no-ticket]
                                       write a doc under docsRoot, link a ticket
  ticket archive <doc> [--force]       move a doc to archiveRoot and repoint
                                       its tickets; refuses while any are open

  ticket hook install                  auto-close on "Closes T-12" commits

ids are random (T-k7m2qx) so parallel branches never collide. Any unique
prefix works, like a short git sha: "ticket close k7m" is enough.
`;

const root = () => core.requireRoot();

try {
  switch (cmd) {
    case 'init': {
      const f = flags(argv);
      const cfg = {};
      if (f['docs-root']) cfg.docsRoot = String(f['docs-root']).replace(/\/*$/, '');
      if (f['archive-root']) cfg.archiveRoot = String(f['archive-root']).replace(/\/*$/, '');
      const r = core.init(process.cwd(), Object.keys(cfg).length ? cfg : undefined);
      const c = core.readConfig(r);
      console.log(`${r}/.tickets`);
      console.log(dim(`docs → ${c.docsRoot}   archive → ${c.archiveRoot}`));
      console.log(dim('change these any time with `ticket config --docs-root <path>`'));
      break;
    }

    case 'config': {
      const f = flags(argv);
      const patch = {};
      if (f['docs-root']) patch.docsRoot = String(f['docs-root']).replace(/\/*$/, '');
      if (f['archive-root']) patch.archiveRoot = String(f['archive-root']).replace(/\/*$/, '');
      const c = Object.keys(patch).length ? core.writeConfig(root(), patch) : core.readConfig(root());
      console.log(f.json ? JSON.stringify(c, null, 2) : `docsRoot    ${c.docsRoot}\narchiveRoot ${c.archiveRoot}`);
      break;
    }

    case 'new':
    case 'create': {
      const f = flags(argv);
      const title = f._.join(' ') || f.title;
      const body = f.body === '-' ? stdin() : typeof f.body === 'string' ? f.body : '';
      const t = core.create(core.findRoot() || process.cwd(), {
        title,
        body,
        docs: csv(f.docs),
        tags: csv(f.tags),
        priority: f.priority || 'p2',
      });
      console.log(f.json ? JSON.stringify(t) : `${t.id}  ${t.file}`);
      break;
    }

    case 'ls':
    case 'list': {
      const f = flags(argv);
      const tickets = core.list(root(), { status: f.status, tag: f.tag, doc: f.doc, q: f.q });
      if (f.json) console.log(JSON.stringify({ schemaVersion: core.SCHEMA_VERSION, tickets }, null, 2));
      else printList(tickets);
      break;
    }

    case 'show': {
      const f = flags(argv);
      const t = core.get(root(), f._[0] || die('need an id'));
      if (f.json) console.log(JSON.stringify({ schemaVersion: core.SCHEMA_VERSION, ticket: t }, null, 2));
      else {
        console.log(`${bold(t.id)} ${tint(t.priority, t.priority)} [${t.status}] ${t.title}`);
        if (t.docs.length) console.log(dim('docs: ' + t.docs.join(', ')));
        if (t.tags.length) console.log(dim('tags: ' + t.tags.join(', ')));
        console.log(dim(t.file) + '\n');
        console.log(t.body);
      }
      break;
    }

    case 'start':
    case 'close':
    case 'reopen': {
      const id = flags(argv)._[0] || die('need an id');
      const status = { start: 'doing', close: 'closed', reopen: 'open' }[cmd];
      const t = core.setStatus(root(), id, status);
      console.log(`${t.id} → ${status}  ${t.file}`);
      if (cmd === 'close') {
        // Suggest, never act: one doc usually has several tickets.
        const done = core.orphanedDocs(root()).filter(d => t.docs.includes(d));
        for (const d of done) console.log(dim(`all tickets for ${d} are closed — archive it? (your call)`));
      }
      break;
    }

    case 'note': {
      const f = flags(argv);
      const id = f._.shift() || die('need an id');
      const text = f._.join(' ') || stdin();
      if (!text.trim()) die('nothing to add');
      console.log(core.addNote(root(), id, text).file);
      break;
    }

    case 'docs': {
      const f = flags(argv);
      const docs = core.docStatuses(root());
      if (f.json) {
        console.log(JSON.stringify({ schemaVersion: core.SCHEMA_VERSION, docs }, null, 2));
        break;
      }
      if (!docs.length) {
        console.log(dim('no ticket references a document yet — use `ticket new --docs <path>`'));
        break;
      }
      const label = { todo: '未开始', doing: '进行中', done: '已完成', archived: '已归档' };
      for (const d of docs) {
        const counts = dim(`${d.closed}/${d.total} closed`);
        const hint = d.status === 'done' ? tint('  → ticket archive ' + d.doc, 'p1') : '';
        console.log(`[${label[d.status]}] ${d.doc}  ${counts}${hint}`);
      }
      break;
    }

    case 'doc': {
      const f = flags(argv);
      if (f._.shift() !== 'new') die('usage: ticket doc new "<title>" [--dir <path>] [--no-ticket]');
      const title = f._.join(' ');
      const r = core.findRoot() || process.cwd();
      const doc = core.createDoc(r, { title, dir: typeof f.dir === 'string' ? f.dir : undefined });
      console.log(doc);
      if (f.ticket !== false && !f['no-ticket']) {
        const t = core.create(r, { title, docs: [doc], priority: f.priority || 'p2' });
        console.log(`${t.id}  ${t.file}  ${dim('→ ' + doc)}`);
      }
      break;
    }

    case 'archive': {
      const f = flags(argv);
      const doc = f._[0] || die('usage: ticket archive <doc-path> [--force]');
      const r = core.archiveDoc(root(), doc, { force: !!f.force });
      console.log(`${r.from} → ${r.to}`);
      if (r.updated.length) console.log(dim(`updated docs: pointer in ${r.updated.join(', ')}`));
      if (r.danglingLinks.length) {
        console.log(tint(`\n${r.danglingLinks.length} file(s) still mention it — fix by hand if they are links:`, 'p1'));
        r.danglingLinks.forEach(l => console.log('  ' + l));
      }
      break;
    }

    case 'rm': {
      const f = flags(argv);
      const id = f._[0] || die('usage: ticket rm <id> --yes');
      const t = core.get(root(), id);
      if (!f.yes) die(`this deletes ${t.id} "${t.title}" (${t.file}) for good.\nre-run with --yes if that is what you want`);
      core.remove(root(), id);
      console.log(`deleted ${t.id}  ${t.file}`);
      break;
    }

    case 'edit': {
      const t = core.get(root(), flags(argv)._[0] || die('need an id'));
      spawnSync(process.env.EDITOR || 'vi', [path.join(root(), t.file)], { stdio: 'inherit' });
      break;
    }

    case 'hook': {
      if (flags(argv)._[0] !== 'install') die('usage: ticket hook install');
      installHook();
      break;
    }

    case 'help':
    case undefined:
    case '--help':
    case '-h':
      console.log(HELP);
      break;

    case '--version':
    case 'version': {
      const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
      console.log(pkg.version);
      break;
    }

    default:
      die(`unknown command: ${cmd}\n\n${HELP}`);
  }
} catch (err) {
  die(err.message);
}

/**
 * The closing trigger. Without this, tickets rot exactly like the markdown
 * checklists they replaced — the point is that you never have to remember.
 */
function installHook() {
  const gitDir = execFileSync('git', ['rev-parse', '--git-dir'], { encoding: 'utf8' }).trim();
  const hookPath = path.join(gitDir, 'hooks', 'post-commit');
  const marker = '# unticked';
  // Prefer a globally installed `ticket`; fall back to the exact binary that is
  // installing the hook, so this works from a clone that was never npm-linked.
  const self = JSON.stringify(fileURLToPath(import.meta.url));
  const body = `#!/bin/sh
${marker} — close tickets named in the commit message
if command -v ticket >/dev/null 2>&1; then TK="ticket"; else TK=${self}; fi
git log -1 --pretty=%B | grep -Eio '(closes|fixes|resolves)[[:space:]]+T-[0-9a-z]+' | while read -r m; do
  id=$(printf '%s' "$m" | grep -Eio 'T-[0-9a-z]+')
  $TK close "$id" >/dev/null 2>&1 || true
done
exit 0
`;
  if (fs.existsSync(hookPath)) {
    const existing = fs.readFileSync(hookPath, 'utf8');
    if (existing.includes(marker)) return console.log(`already installed: ${hookPath}`);
    die(`${hookPath} already exists and is not ours — merge it by hand:\n\n${body}`);
  }
  fs.mkdirSync(path.dirname(hookPath), { recursive: true });
  fs.writeFileSync(hookPath, body, { mode: 0o755 });
  console.log(`installed ${hookPath}\nnow "git commit -m 'fix thing (Closes T-12)'" closes T-12`);
}
