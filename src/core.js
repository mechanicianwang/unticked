/**
 * unticked core — read/write tickets stored as markdown files.
 *
 * Zero dependencies. Every client (CLI, HTTP adapter, editor plugin, agent)
 * goes through this module, so there is exactly one implementation of the
 * on-disk format.
 *
 * Layout:
 *   .tickets/open/T-0001-some-slug.md
 *   .tickets/doing/...
 *   .tickets/closed/...
 *
 * The directory IS the status. There is no `status:` field to drift out of
 * sync, and `ls .tickets/open` answers "what is left" without any tooling.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/** Bumped only on breaking changes to the JSON shape returned to clients. */
export const SCHEMA_VERSION = 1;

export const STATUSES = ['open', 'doing', 'closed'];
export const PRIORITIES = ['p0', 'p1', 'p2', 'p3'];

const DIR = '.tickets';

// ---------------------------------------------------------------- frontmatter

// ponytail: deliberately not a YAML parser. The format is a fixed, documented
// subset (scalars + flow arrays) that this module both writes and reads. If a
// human hand-edits a ticket into real YAML (block lists, anchors, multiline),
// it will not round-trip — see SPEC.md. Swap in `yaml` only if that becomes a
// real complaint rather than a hypothetical one.

function quote(s) {
  return /^[\w./@-]+$/.test(s) ? s : `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function unquote(s) {
  if (s.length >= 2 && s[0] === '"' && s.endsWith('"')) {
    return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return s;
}

function dumpValue(v) {
  if (Array.isArray(v)) return `[${v.map(quote).join(', ')}]`;
  return quote(String(v));
}

function parseValue(raw) {
  const s = raw.trim();
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim();
    if (!inner) return [];
    // ponytail: split on commas outside quotes. Values with commas must be
    // quoted, which is what dumpValue always does.
    return (inner.match(/"(?:[^"\\]|\\.)*"|[^,]+/g) || []).map(x => unquote(x.trim())).filter(Boolean);
  }
  return unquote(s);
}

export function parseTicketFile(text) {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!m) return { meta: {}, body: text.trim() };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i === -1) continue;
    meta[line.slice(0, i).trim()] = parseValue(line.slice(i + 1));
  }
  return { meta, body: m[2].trim() };
}

export function serializeTicket(meta, body) {
  const lines = Object.entries(meta)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${dumpValue(v)}`);
  return `---\n${lines.join('\n')}\n---\n\n${body.trim()}\n`;
}

// ----------------------------------------------------------------- filesystem

/** Walk up from `cwd` looking for a `.tickets/` directory. */
export function findRoot(cwd = process.cwd()) {
  let dir = path.resolve(cwd);
  for (;;) {
    if (fs.existsSync(path.join(dir, DIR))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

export function requireRoot(cwd = process.cwd()) {
  const root = findRoot(cwd);
  if (!root) throw new Error(`no ${DIR}/ found in ${cwd} or any parent — run \`ticket init\``);
  return root;
}

export function init(cwd = process.cwd(), config) {
  const root = path.resolve(cwd);
  for (const s of STATUSES) {
    fs.mkdirSync(path.join(root, DIR, s), { recursive: true });
    const f = path.join(root, DIR, s, '.gitkeep');
    if (!fs.existsSync(f)) fs.writeFileSync(f, '');
  }
  if (config) writeConfig(root, config);
  return root;
}

// -------------------------------------------------------------------- config

/**
 * Where this repo keeps documents. Not baked in: every repo organises `docs/`
 * differently, and the tool has no business guessing.
 */
export const DEFAULT_CONFIG = {
  version: 1,
  docsRoot: 'docs',
  archiveRoot: 'docs/archive',
};

const CONFIG_FILE = 'config.json';

export function readConfig(root) {
  const file = path.join(root, DIR, CONFIG_FILE);
  if (!fs.existsSync(file)) return { ...DEFAULT_CONFIG };
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    // A hand-mangled config should not take the whole tool down.
    return { ...DEFAULT_CONFIG };
  }
}

export function writeConfig(root, patch) {
  const next = { ...readConfig(root), ...patch };
  fs.mkdirSync(path.join(root, DIR), { recursive: true });
  fs.writeFileSync(path.join(root, DIR, CONFIG_FILE), JSON.stringify(next, null, 2) + '\n');
  return next;
}

function slug(title) {
  return (
    String(title)
      .toLowerCase()
      // keep CJK, letters and digits; everything else becomes a separator
      .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'ticket'
  );
}

function ticketFiles(root) {
  const out = [];
  for (const status of STATUSES) {
    const dir = path.join(root, DIR, status);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (name.endsWith('.md')) out.push({ status, file: path.join(dir, name) });
    }
  }
  return out;
}

function toTicket(root, status, file) {
  const { meta, body } = parseTicketFile(fs.readFileSync(file, 'utf8'));
  return {
    id: meta.id || idOf(file),
    title: meta.title || '(untitled)',
    status,
    priority: meta.priority || 'p2',
    tags: Array.isArray(meta.tags) ? meta.tags : [],
    docs: Array.isArray(meta.docs) ? meta.docs : [],
    refs: Array.isArray(meta.refs) ? meta.refs : [],
    created: meta.created || null,
    closed: meta.closed || null,
    body,
    file: path.relative(root, file),
  };
}

// -------------------------------------------------------------------- queries

/**
 * @param {object} [filter]
 * @param {string|string[]} [filter.status] defaults to open+doing
 * @param {string} [filter.tag]
 * @param {string} [filter.doc]   substring match against `docs`
 * @param {string} [filter.q]     substring match against title/body
 */
export function list(root, filter = {}) {
  const wanted = filter.status === 'all' ? STATUSES : [].concat(filter.status || ['open', 'doing']);
  const tickets = ticketFiles(root)
    .filter(f => wanted.includes(f.status))
    .map(f => toTicket(root, f.status, f.file))
    .filter(t => (filter.tag ? t.tags.includes(filter.tag) : true))
    .filter(t => (filter.doc ? t.docs.some(d => d.includes(filter.doc)) : true))
    .filter(t => {
      if (!filter.q) return true;
      const q = filter.q.toLowerCase();
      return t.title.toLowerCase().includes(q) || t.body.toLowerCase().includes(q);
    });
  // Ids are random, so they carry no order — fall back to creation time.
  tickets.sort(
    (a, b) => a.priority.localeCompare(b.priority) || String(a.created).localeCompare(String(b.created)) || a.id.localeCompare(b.id)
  );
  return tickets;
}

export function get(root, id) {
  const files = ticketFiles(root).map(f => ({ ...f, id: idOf(f.file) }));
  const key = resolveId(files.map(f => f.id), id);
  const hits = files.filter(f => f.id.toLowerCase() === key.toLowerCase());
  if (hits.length > 1) {
    // Only reachable for ids minted by the old sequential scheme, or a
    // hand-edited duplicate. Refuse to guess which one the user meant.
    throw new Error(`duplicate id ${key} in ${hits.map(h => path.relative(root, h.file)).join(' and ')} — rename one`);
  }
  return toTicket(root, hits[0].status, hits[0].file);
}

const idOf = file => /^(T-[0-9a-zA-Z]+)/.exec(path.basename(file))?.[1] || path.basename(file, '.md');

/**
 * Resolve whatever the user typed against the ids that exist.
 *
 * Accepts, in order: an exact id, a zero-padded legacy number (`12` → `T-0012`),
 * or any unique prefix (`k7m` → `T-k7m2qx`), the way git resolves short shas.
 * Ambiguous input is an error, never a guess.
 *
 * @param {string[]} ids
 * @param {string} input
 */
export function resolveId(ids, input) {
  const raw = String(input).trim();
  const key = raw.replace(/^[Tt]-/, '').toLowerCase();
  const lower = ids.map(i => i.toLowerCase());

  const exact = lower.indexOf('t-' + key);
  if (exact !== -1) return ids[exact];

  if (/^\d{1,4}$/.test(key)) {
    const padded = lower.indexOf('t-' + key.padStart(4, '0'));
    if (padded !== -1) return ids[padded];
  }

  const prefixed = ids.filter((_, i) => lower[i].startsWith('t-' + key));
  if (prefixed.length === 1) return prefixed[0];
  if (prefixed.length > 1) throw new Error(`ambiguous id "${raw}" — matches ${prefixed.join(', ')}`);
  throw new Error(`ticket not found: ${raw}`);
}

/**
 * Ids are random, not sequential, so two branches can mint tickets at the same
 * time and still merge cleanly — the whole reason git uses hashes for commits.
 * `created` gives you chronological order when you want it.
 *
 * Alphabet excludes 0/1/i/l/o/u so nothing is ambiguous when read aloud or
 * retyped. 6 chars over 30 symbols is 729M ids: at a thousand tickets the odds
 * of any collision across all branches are under one in a thousand — and a
 * collision is caught loudly by `get()` rather than silently resolved.
 */
const ID_ALPHABET = '23456789abcdefghjkmnpqrstvwxyz';
const ID_LENGTH = 6;

function nextId(root) {
  const taken = new Set(ticketFiles(root).map(f => idOf(f.file).toLowerCase()));
  for (let attempt = 0; attempt < 100; attempt++) {
    let id = 'T-';
    for (let i = 0; i < ID_LENGTH; i++) id += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
    if (!taken.has(id.toLowerCase())) return id;
  }
  throw new Error('could not allocate a free id — is .tickets/ enormous?');
}

// --------------------------------------------------------------------- writes

export function create(root, { title, body = '', docs = [], tags = [], priority = 'p2' }) {
  if (!title || !String(title).trim()) throw new Error('title is required');
  if (!PRIORITIES.includes(priority)) throw new Error(`priority must be one of ${PRIORITIES.join('|')}`);
  init(root);
  const id = nextId(root);
  const meta = {
    id,
    title: String(title).trim(),
    priority,
    tags,
    docs,
    refs: [],
    created: new Date().toISOString(),
  };
  const file = path.join(root, DIR, 'open', `${id}-${slug(title)}.md`);
  fs.writeFileSync(file, serializeTicket(meta, body || DEFAULT_BODY));
  return toTicket(root, 'open', file);
}

const DEFAULT_BODY = `## How

-

## Done when

-
`;

export function setStatus(root, id, status) {
  if (!STATUSES.includes(status)) throw new Error(`status must be one of ${STATUSES.join('|')}`);
  const t = get(root, id);
  const from = path.join(root, t.file);
  const { meta, body } = parseTicketFile(fs.readFileSync(from, 'utf8'));
  if (status === 'closed') meta.closed = new Date().toISOString();
  else delete meta.closed;
  const to = path.join(root, DIR, status, path.basename(from));
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(from, serializeTicket(meta, body));
  if (from !== to) fs.renameSync(from, to);
  return toTicket(root, status, to);
}

/** Append a timestamped note to the body. */
export function addNote(root, id, text) {
  const t = get(root, id);
  const file = path.join(root, t.file);
  const { meta, body } = parseTicketFile(fs.readFileSync(file, 'utf8'));
  const stamped = `${body}\n\n---\n\n_${new Date().toISOString()}_\n\n${text.trim()}`;
  fs.writeFileSync(file, serializeTicket(meta, stamped));
  return toTicket(root, t.status, file);
}

// ----------------------------------------------------------------------- docs

/**
 * A document's status is DERIVED from the tickets that reference it. It is
 * never stored anywhere.
 *
 * Storing it would mean two sources of truth — a `status:` in the document and
 * the real state of its tickets — and those drift. Drifted checklists are the
 * exact problem this tool exists to fix, so it would be a poor thing to
 * reintroduce one level up.
 *
 *   todo     has tickets, none started
 *   doing    at least one ticket in progress
 *   done     every ticket closed  → safe to archive
 *   archived the file already lives under archiveRoot
 *
 * @returns {{doc: string, status: string, total: number, open: number, doing: number, closed: number}[]}
 */
export function docStatuses(root) {
  const { archiveRoot } = readConfig(root);
  const byDoc = new Map();
  for (const t of list(root, { status: 'all' })) {
    for (const doc of t.docs) {
      if (!byDoc.has(doc)) byDoc.set(doc, { doc, open: 0, doing: 0, closed: 0 });
      byDoc.get(doc)[t.status]++;
    }
  }
  return [...byDoc.values()]
    .map(d => {
      const total = d.open + d.doing + d.closed;
      const archived = d.doc === archiveRoot || d.doc.startsWith(archiveRoot.replace(/\/*$/, '/'));
      const status = archived ? 'archived' : d.doing > 0 ? 'doing' : d.open > 0 ? 'todo' : 'done';
      return { ...d, total, status };
    })
    .sort((a, b) => a.doc.localeCompare(b.doc));
}

/** Docs whose tickets are all closed — the ones worth *offering* to archive. */
export function orphanedDocs(root) {
  return docStatuses(root)
    .filter(d => d.status === 'done')
    .map(d => d.doc);
}

/**
 * Move a document into the archive. The only time this tool ever moves a file
 * that is not a ticket.
 *
 * Refuses while any referencing ticket is still open or in progress: one
 * document usually spawns several tickets, and burying four of them to file
 * away the fifth is not a trade anyone would accept knowingly.
 *
 * Rewrites the `docs:` pointer in every ticket that referenced it, because a
 * move that leaves dangling references turns the index into a liability within
 * a month.
 *
 * @returns {{from: string, to: string, updated: string[], danglingLinks: string[]}}
 */
export function archiveDoc(root, docPath, { git = true, force = false } = {}) {
  const { archiveRoot } = readConfig(root);
  const from = path.relative(root, path.resolve(root, docPath)).split(path.sep).join('/');
  const abs = path.join(root, from);
  if (!fs.existsSync(abs)) throw new Error(`no such document: ${from}`);
  if (fs.statSync(abs).isDirectory()) throw new Error(`${from} is a directory — archive documents, not folders`);

  const blocking = force ? [] : list(root, { status: ['open', 'doing'] }).filter(t => t.docs.includes(from));
  if (blocking.length) {
    throw new Error(
      `${from} still has ${blocking.length} unfinished ticket(s):\n` +
        blocking.map(t => `  ${t.id} [${t.status}] ${t.title}`).join('\n') +
        `\nclose them first, or run with --force if the document is obsolete anyway`
    );
  }

  const to = path.posix.join(archiveRoot, path.basename(from));
  if (fs.existsSync(path.join(root, to))) throw new Error(`${to} already exists — rename one of them first`);
  fs.mkdirSync(path.join(root, archiveRoot), { recursive: true });

  // git mv keeps the file's history attached; fall back for non-git trees.
  let moved = false;
  if (git) {
    const r = spawnSync('git', ['mv', from, to], { cwd: root });
    moved = r.status === 0;
  }
  if (!moved) fs.renameSync(abs, path.join(root, to));

  const updated = [];
  for (const t of list(root, { status: 'all' })) {
    if (!t.docs.includes(from)) continue;
    const file = path.join(root, t.file);
    const { meta, body } = parseTicketFile(fs.readFileSync(file, 'utf8'));
    meta.docs = (Array.isArray(meta.docs) ? meta.docs : []).map(d => (d === from ? to : d));
    fs.writeFileSync(file, serializeTicket(meta, body));
    updated.push(t.id);
  }

  return { from, to, updated, danglingLinks: findReferences(root, from) };
}

/**
 * Other documents that still link to a path we just moved.
 *
 * ponytail: reports, does not rewrite. Auto-editing prose is how you end up
 * mangling a code block that happened to contain the path. Scans the top-level
 * directory that docsRoot lives in — widen it if that ever proves too narrow.
 */
export function findReferences(root, target) {
  const { docsRoot } = readConfig(root);
  const scanDir = path.join(root, docsRoot.split('/')[0]);
  if (!fs.existsSync(scanDir)) return [];
  const hits = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.md') && fs.readFileSync(p, 'utf8').includes(path.basename(target))) {
        const rel = path.relative(root, p).split(path.sep).join('/');
        if (rel !== target) hits.push(rel);
      }
    }
  };
  walk(scanDir);
  return hits;
}

/**
 * Create a document under `docsRoot` and return its repo-relative path.
 *
 * Deliberately thin: a heading and three sections. If a plan needs more shape
 * than that, it needs a human, not a generator. Short notes belong in the
 * ticket body — this is for the ones other people will read.
 */
export function createDoc(root, { title, dir, slug: name }) {
  if (!title || !String(title).trim()) throw new Error('title is required');
  const { docsRoot } = readConfig(root);
  const target = (dir || docsRoot).replace(/\/*$/, '');
  const rel = path.posix.join(target, `${name || slug(title)}.md`);
  const abs = path.join(root, rel);
  if (fs.existsSync(abs)) throw new Error(`${rel} already exists`);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(
    abs,
    `# ${String(title).trim()}\n\n> ${new Date().toISOString().slice(0, 10)}\n\n## Why\n\n\n## What\n\n\n## Open questions\n\n\n`
  );
  return rel;
}

/** Delete a ticket outright. For mistakes and duplicates — closing is not this. */
export function remove(root, id) {
  const t = get(root, id);
  fs.unlinkSync(path.join(root, t.file));
  return t;
}
