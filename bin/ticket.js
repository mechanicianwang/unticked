#!/usr/bin/env node
/**
 * ticketkit CLI — the reference client, and the only supported way to write.
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

const HELP = `ticketkit — tickets as markdown files in your repo

  ticket init                          create .tickets/ here
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
  ticket docs                          docs whose tickets are all closed
  ticket hook install                  auto-close on "Closes T-12" commits

ids are loose: 12, t-12 and T-0012 all work.
`;

const root = () => core.requireRoot();

try {
  switch (cmd) {
    case 'init': {
      console.log(core.init(process.cwd()) + '/.tickets');
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
      const orphans = core.orphanedDocs(root());
      if (!orphans.length) console.log(dim('no docs with all tickets closed'));
      else orphans.forEach(d => console.log(d));
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
  const marker = '# ticketkit';
  // Prefer a globally installed `ticket`; fall back to the exact binary that is
  // installing the hook, so this works from a clone that was never npm-linked.
  const self = JSON.stringify(fileURLToPath(import.meta.url));
  const body = `#!/bin/sh
${marker} — close tickets named in the commit message
if command -v ticket >/dev/null 2>&1; then TK="ticket"; else TK=${self}; fi
git log -1 --pretty=%B | grep -Eio '(closes|fixes|resolves) +[Tt]-?[0-9]+' | while read -r m; do
  id=$(echo "$m" | grep -Eo '[0-9]+')
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
