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

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'unticked-'));
const CLI = path.join(import.meta.dirname, '..', 'bin', 'ticket.js');
const cli = (...args) => execFileSync(process.execPath, [CLI, ...args], { cwd: root, encoding: 'utf8' });

core.init(root);

// --- create ----------------------------------------------------------------
const a = core.create(root, { title: 'first: with a colon, and comma', tags: ['ui'], docs: ['docs/x.md'], priority: 'p0' });
assert.match(a.id, /^T-[23456789abcdefghjkmnpqrstvwxyz]{6}$/, 'ids are random, from an unambiguous alphabet');
assert.equal(a.status, 'open');
assert.equal(a.title, 'first: with a colon, and comma', 'title with : and , must round-trip');
assert.deepEqual(a.docs, ['docs/x.md']);
assert.ok(fs.existsSync(path.join(root, a.file)), 'file exists at reported path');
assert.ok(a.file.startsWith('.tickets/open/'), 'new tickets live in open/');

const b = core.create(root, { title: '中文标题也要能用', body: 'hello' });
assert.notEqual(b.id, a.id, 'ids are unique');
assert.equal(b.priority, 'p2', 'default priority');
assert.equal(b.body, 'hello');

// --- parallel branches ------------------------------------------------------
// The failure this scheme exists to prevent: two clones, neither aware of the
// other, each creating tickets. Under the old max+1 scheme both sides minted
// the same id and the merge produced two files claiming it.
{
  const mine = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-mine-'));
  const theirs = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-theirs-'));
  core.init(mine);
  core.init(theirs);
  const left = Array.from({ length: 40 }, (_, i) => core.create(mine, { title: `mine ${i}` }).id);
  const right = Array.from({ length: 40 }, (_, i) => core.create(theirs, { title: `theirs ${i}` }).id);
  assert.equal(new Set([...left, ...right]).size, 80, 'no id is minted twice across independent checkouts');

  // Now simulate the merge: drop both sides into one tree, everything still resolves.
  const merged = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-merged-'));
  core.init(merged);
  for (const src of [mine, theirs]) {
    for (const f of fs.readdirSync(path.join(src, '.tickets', 'open'))) {
      fs.copyFileSync(path.join(src, '.tickets', 'open', f), path.join(merged, '.tickets', 'open', f));
    }
  }
  assert.equal(core.list(merged).length, 80, 'a merge of both branches keeps every ticket');
  for (const id of [...left, ...right]) assert.equal(core.get(merged, id).id, id, `${id} still resolves after merge`);
  for (const d of [mine, theirs, merged]) fs.rmSync(d, { recursive: true, force: true });
}

// --- id resolution ----------------------------------------------------------
assert.equal(core.resolveId(['T-k7m2qx', 'T-ab34cd'], 'T-k7m2qx'), 'T-k7m2qx', 'exact');
assert.equal(core.resolveId(['T-k7m2qx', 'T-ab34cd'], 'k7m2qx'), 'T-k7m2qx', 'bare, no prefix');
assert.equal(core.resolveId(['T-k7m2qx', 'T-ab34cd'], 'K7M'), 'T-k7m2qx', 'unique prefix, case-insensitive');
assert.equal(core.resolveId(['T-0012', 'T-ab34cd'], '12'), 'T-0012', 'legacy sequential ids still resolve');
assert.throws(() => core.resolveId(['T-k7m2qx', 'T-k7zzzz'], 'k7'), /ambiguous/, 'ambiguous prefix is an error, not a guess');
assert.throws(() => core.resolveId(['T-k7m2qx'], 'nope'), /not found/);

// --- read ------------------------------------------------------------------
assert.equal(core.list(root).length, 2);
assert.equal(core.list(root)[0].id, a.id, 'p0 sorts before p2');
assert.equal(core.list(root, { tag: 'ui' }).length, 1);
assert.equal(core.list(root, { doc: 'docs/x' }).length, 1);
assert.equal(core.list(root, { q: '中文' }).length, 1);
assert.equal(core.get(root, a.id).id, a.id, 'full id');
assert.equal(core.get(root, a.id.slice(2)).id, a.id, 'without the T- prefix');
assert.equal(core.get(root, a.id.slice(0, 5)).id, a.id, 'short prefix, like a git sha');

// --- status is the directory ----------------------------------------------
const closed = core.setStatus(root, a.id, 'closed');
assert.equal(closed.status, 'closed');
assert.ok(closed.file.startsWith('.tickets/closed/'), 'closed tickets move to closed/');
assert.ok(closed.closed, 'closed timestamp is set');
assert.ok(!fs.existsSync(path.join(root, a.file)), 'old path is gone — no duplicate');
assert.equal(core.list(root).length, 1, 'closed tickets drop out of the default list');
assert.equal(core.list(root, { status: 'all' }).length, 2);

const reopened = core.setStatus(root, a.id, 'open');
assert.equal(reopened.closed, null, 'reopening clears the closed timestamp');

// --- notes -----------------------------------------------------------------
const noted = core.addNote(root, b.id, 'a note');
assert.ok(noted.body.includes('a note'));
assert.ok(noted.body.startsWith('hello'), 'notes append, never overwrite');

// --- orphaned docs are suggestions, not actions -----------------------------
core.setStatus(root, a.id, 'closed');
assert.deepEqual(core.orphanedDocs(root), ['docs/x.md']);
core.create(root, { title: 'another one on the same doc', docs: ['docs/x.md'] });
assert.deepEqual(core.orphanedDocs(root), [], 'a doc with any open ticket is not orphaned');

// --- config -----------------------------------------------------------------
assert.equal(core.readConfig(root).docsRoot, 'docs', 'default docsRoot');
core.writeConfig(root, { docsRoot: 'docs/14-tickets', archiveRoot: 'docs/archive' });
assert.equal(core.readConfig(root).docsRoot, 'docs/14-tickets', 'config persists');

// --- doc status is derived, never stored ------------------------------------
{
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-docs-'));
  core.init(r, { docsRoot: 'docs/14-tickets', archiveRoot: 'docs/archive' });
  fs.mkdirSync(path.join(r, 'docs/14-tickets'), { recursive: true });
  const doc = 'docs/14-tickets/plan.md';
  fs.writeFileSync(path.join(r, doc), '# plan\n');

  const t1 = core.create(r, { title: 'one', docs: [doc] });
  const t2 = core.create(r, { title: 'two', docs: [doc] });
  const statusOf = () => core.docStatuses(r).find(d => d.doc === doc).status;

  assert.equal(statusOf(), 'todo', 'has tickets, none started');
  core.setStatus(r, t1.id, 'doing');
  assert.equal(statusOf(), 'doing', 'one in progress');
  core.setStatus(r, t1.id, 'closed');
  assert.equal(statusOf(), 'todo', 'still one open ticket left');
  core.setStatus(r, t2.id, 'closed');
  assert.equal(statusOf(), 'done', 'all closed');
  assert.deepEqual(core.orphanedDocs(r), [doc]);

  // The whole point: closing ONE ticket must never bury a doc that has others.
  core.setStatus(r, t2.id, 'open');
  assert.throws(() => core.archiveDoc(r, doc, { git: false }), /unfinished ticket/, 'archive refuses while a ticket is open');
  assert.ok(fs.existsSync(path.join(r, doc)), 'refused archive left the file alone');
  assert.throws(() => core.archiveDoc(r, doc, { git: false }), new RegExp(t2.id), 'and names the blocking ticket');

  // Forced archive, then: the pointers must follow the file.
  core.setStatus(r, t2.id, 'closed');
  const res = core.archiveDoc(r, doc, { git: false });
  assert.equal(res.to, 'docs/archive/plan.md');
  assert.ok(!fs.existsSync(path.join(r, doc)), 'moved out of the old path');
  assert.ok(fs.existsSync(path.join(r, res.to)), 'landed in the archive');
  assert.equal(res.updated.length, 2, 'both tickets repointed');
  for (const t of core.list(r, { status: 'all' })) {
    assert.deepEqual(t.docs, [res.to], `${t.id} points at the new path — a move that leaves dangling refs is worse than no move`);
  }
  assert.equal(core.docStatuses(r)[0].status, 'archived', 'living under archiveRoot reads as archived');
  assert.deepEqual(core.orphanedDocs(r), [], 'archived docs stop being suggested');

  // Dangling links elsewhere are reported, not rewritten.
  fs.writeFileSync(path.join(r, 'docs/14-tickets/other.md'), 'see [plan](./plan.md)\n');
  fs.writeFileSync(path.join(r, 'docs/14-tickets/p2.md'), '# p2\n');
  const t3 = core.create(r, { title: 'three', docs: ['docs/14-tickets/p2.md'] });
  core.setStatus(r, t3.id, 'closed');
  const res2 = core.archiveDoc(r, 'docs/14-tickets/p2.md', { git: false });
  assert.ok(Array.isArray(res2.danglingLinks));

  // doc new
  const made = core.createDoc(r, { title: '新方案 A' });
  assert.ok(made.startsWith('docs/14-tickets/'), 'lands under the configured docsRoot');
  assert.ok(fs.existsSync(path.join(r, made)));
  assert.throws(() => core.createDoc(r, { title: '新方案 A' }), /already exists/, 'never silently overwrites a doc');

  // rm is not close
  const doomed = core.create(r, { title: 'delete me' });
  const before = core.list(r, { status: 'all' }).length;
  core.remove(r, doomed.id);
  assert.equal(core.list(r, { status: 'all' }).length, before - 1);
  assert.ok(!fs.existsSync(path.join(r, doomed.file)));
  assert.throws(() => core.get(r, doomed.id), /not found/);

  fs.rmSync(r, { recursive: true, force: true });
}

// --- the JSON contract clients depend on ------------------------------------
const out = JSON.parse(cli('ls', '--json'));
assert.equal(out.schemaVersion, core.SCHEMA_VERSION);
assert.ok(Array.isArray(out.tickets));
for (const k of ['id', 'title', 'status', 'priority', 'tags', 'docs', 'created', 'body', 'file']) {
  assert.ok(k in out.tickets[0], `ls --json must include "${k}" — clients render from this`);
}
assert.equal(JSON.parse(cli('show', b.id, '--json')).ticket.id, b.id);

fs.rmSync(root, { recursive: true, force: true });
console.log('self-check ok');
