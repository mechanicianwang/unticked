/**
 * ticketkit core — read/write tickets stored as markdown files.
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

export function init(cwd = process.cwd()) {
  const root = path.resolve(cwd);
  for (const s of STATUSES) fs.mkdirSync(path.join(root, DIR, s), { recursive: true });
  const keep = path.join(root, DIR, 'closed', '.gitkeep');
  for (const s of STATUSES) {
    const f = path.join(root, DIR, s, '.gitkeep');
    if (!fs.existsSync(f)) fs.writeFileSync(f, '');
  }
  void keep;
  return root;
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

const DEFAULT_BODY = `## 怎么做 / How

-

## 怎么算做完 / Done when

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

/**
 * Docs that are referenced only by tickets which are now closed.
 * Used to *suggest* archiving — never to archive automatically, because one
 * doc usually spawns many tickets and closing one must not bury the rest.
 */
export function orphanedDocs(root) {
  const openDocs = new Set(list(root, { status: ['open', 'doing'] }).flatMap(t => t.docs));
  const closedDocs = new Set(list(root, { status: ['closed'] }).flatMap(t => t.docs));
  return [...closedDocs].filter(d => !openDocs.has(d));
}
