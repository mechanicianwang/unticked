/**
 * One runnable check for the parts that can silently break: the frontmatter
 * round-trip, id allocation, and status-as-directory.
 *
 *   node test/self-check.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as core from '../src/core.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ticketkit-'));
const CLI = path.join(import.meta.dirname, '..', 'bin', 'ticket.js');
const cli = (...args) => execFileSync(process.execPath, [CLI, ...args], { cwd: root, encoding: 'utf8' });

core.init(root);

// --- create ----------------------------------------------------------------
const a = core.create(root, { title: 'first: with a colon, and comma', tags: ['ui'], docs: ['docs/x.md'], priority: 'p0' });
assert.equal(a.id, 'T-0001');
assert.equal(a.status, 'open');
assert.equal(a.title, 'first: with a colon, and comma', 'title with : and , must round-trip');
assert.deepEqual(a.docs, ['docs/x.md']);
assert.ok(fs.existsSync(path.join(root, a.file)), 'file exists at reported path');
assert.ok(a.file.startsWith('.tickets/open/'), 'new tickets live in open/');

const b = core.create(root, { title: '中文标题也要能用', body: 'hello' });
assert.equal(b.id, 'T-0002', 'ids increment');
assert.equal(b.priority, 'p2', 'default priority');
assert.equal(b.body, 'hello');

// --- read ------------------------------------------------------------------
assert.equal(core.list(root).length, 2);
assert.equal(core.list(root)[0].id, 'T-0001', 'p0 sorts before p2');
assert.equal(core.list(root, { tag: 'ui' }).length, 1);
assert.equal(core.list(root, { doc: 'docs/x' }).length, 1);
assert.equal(core.list(root, { q: '中文' }).length, 1);
assert.equal(core.get(root, '1').id, 'T-0001', 'loose id: 1');
assert.equal(core.get(root, 't-1').id, 'T-0001', 'loose id: t-1');
assert.equal(core.get(root, 'T-0001').id, 'T-0001');

// --- status is the directory ----------------------------------------------
const closed = core.setStatus(root, '1', 'closed');
assert.equal(closed.status, 'closed');
assert.ok(closed.file.startsWith('.tickets/closed/'), 'closed tickets move to closed/');
assert.ok(closed.closed, 'closed timestamp is set');
assert.ok(!fs.existsSync(path.join(root, a.file)), 'old path is gone — no duplicate');
assert.equal(core.list(root).length, 1, 'closed tickets drop out of the default list');
assert.equal(core.list(root, { status: 'all' }).length, 2);

const reopened = core.setStatus(root, '1', 'open');
assert.equal(reopened.closed, null, 'reopening clears the closed timestamp');

// --- notes -----------------------------------------------------------------
const noted = core.addNote(root, '2', 'a note');
assert.ok(noted.body.includes('a note'));
assert.ok(noted.body.startsWith('hello'), 'notes append, never overwrite');

// --- orphaned docs are suggestions, not actions -----------------------------
core.setStatus(root, '1', 'closed');
assert.deepEqual(core.orphanedDocs(root), ['docs/x.md']);
core.create(root, { title: 'another one on the same doc', docs: ['docs/x.md'] });
assert.deepEqual(core.orphanedDocs(root), [], 'a doc with any open ticket is not orphaned');

// --- the JSON contract clients depend on ------------------------------------
const out = JSON.parse(cli('ls', '--json'));
assert.equal(out.schemaVersion, core.SCHEMA_VERSION);
assert.ok(Array.isArray(out.tickets));
for (const k of ['id', 'title', 'status', 'priority', 'tags', 'docs', 'created', 'body', 'file']) {
  assert.ok(k in out.tickets[0], `ls --json must include "${k}" — clients render from this`);
}
assert.equal(JSON.parse(cli('show', '2', '--json')).ticket.id, 'T-0002');

fs.rmSync(root, { recursive: true, force: true });
console.log('self-check ok');
