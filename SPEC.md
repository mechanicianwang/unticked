# unticked protocol

Everything a client needs to know. If you implement against this page, your
client keeps working across unticked versions.

There are two contracts: the **files on disk** and the **JSON**. Read whichever
one fits your client. They will not diverge, because the CLI, the HTTP adapter
and the reference UI all go through the same 300-line module.

---

## 1. On disk

```
your-repo/
  .tickets/
    open/    T-0001-fix-the-login-redirect.md
    doing/   T-0004-migrate-r2-bucket.md
    closed/  T-0002-add-quota-tests.md
```

**The directory is the status.** There is no `status:` field, so there is
nothing to drift out of sync, and `ls .tickets/open` answers "what is left"
with no tooling at all — which matters when the thing reading your repo is a
shell script, a coworker, or an AI agent.

Statuses are exactly `open`, `doing`, `closed`. Changing status moves the file;
`git` records it as a rename.

### Filename

`<id>-<slug>.md` — e.g. `T-0012-add-quota-tests.md`.

The id is authoritative; the slug is decoration for humans and for editors that
jump to files by name. Renaming the slug is safe. Renaming the id is not.

### Ids

`T-` followed by 6 random characters from `23456789abcdefghjkmnpqrstvwxyz` —
e.g. `T-k7m2qx`. The alphabet omits `0 1 i l o u` so nothing is ambiguous when
read aloud or retyped.

**Ids are random rather than sequential so that branches never have to
coordinate.** Two people on two branches can each create ten tickets, merge,
and every id is still distinct — the same reason git names commits by hash.
Since each ticket is its own file with a distinct name, the merge itself is
also conflict-free. `created` gives you chronological order when you want it.

Collisions are theoretically possible (729M ids; under one in a thousand at a
thousand tickets) and are caught loudly: two files claiming one id makes `get()`
throw and name both paths, rather than silently picking one.

Clients must resolve user input in this order:

1. exact id, case-insensitive, with or without the `T-` prefix
2. a 1–4 digit number, zero-padded — `12` → `T-0012`, so tickets created by
   the pre-0.2 sequential scheme keep working
3. **any unique prefix**, the way git resolves short shas: `k7m` → `T-k7m2qx`

Ambiguous input must be an error listing the candidates, never a guess.
`resolveId(ids, input)` is exported for clients that want the exact behaviour.

### Frontmatter

```yaml
---
id: T-0012
title: "Add quota tests before the next billing change"
priority: p1
tags: [billing, tests]
docs: [docs/00-todo/engineering-roadmap-2026-06.md]
refs: []
created: 2026-08-01T06:30:13Z
closed: 2026-08-04T11:02:55Z
---

## How
...

## Done when
...
```

| field      | type       | notes |
|------------|------------|-------|
| `id`       | string     | required, matches the filename |
| `title`    | string     | required |
| `priority` | enum       | `p0` `p1` `p2` `p3`, default `p2` |
| `tags`     | string[]   | free-form |
| `docs`     | string[]   | repo-relative paths this ticket came from — **the index feature**: `ticket ls --doc <path>` finds every open item for a document |
| `refs`     | string[]   | free-form external references (commit sha, URL, `gh-123`) |
| `created`  | ISO 8601   | |
| `closed`   | ISO 8601   | present only in `closed/` |

Body is plain markdown. Unknown frontmatter keys are preserved on write but not
returned in JSON — put anything you like there, it will survive.

**Frontmatter is a restricted subset of YAML**, not the whole language:
scalars and single-line flow arrays (`[a, b]`), values containing anything
outside `[\w./@-]` are double-quoted with `\` escaping. This is deliberate — it
keeps unticked at zero dependencies. Hand-editing a ticket into real YAML
(block lists, anchors, multi-line strings) will not round-trip.


### Config

`.tickets/config.json`, written by `ticket init` and editable with
`ticket config`:

```json
{
  "version": 1,
  "docsRoot": "docs",
  "archiveRoot": "docs/archive"
}
```

Every repo organises `docs/` differently, so neither path is baked in. Missing
file means the defaults above.

---

## 1b. Documents

A ticket may point at the documents it came from, via `docs:`. Those documents
have a lifecycle too — but **their status is derived from their tickets and is
never written down anywhere**:

| status | meaning |
|---|---|
| `todo` | has tickets, none started |
| `doing` | at least one ticket in progress |
| `done` | every ticket closed — safe to archive |
| `archived` | the file lives under `archiveRoot` |

Storing a document's status would create a second source of truth that drifts
from the first. Stale checklists are the problem this tool exists to solve; it
would be a poor thing to reintroduce one level up.

**Documents are never moved except to archive.** They stay wherever your repo's
own conventions put them — organised by topic, not by state. `ticket archive`
is the one command that moves a document, and it:

1. refuses while any referencing ticket is still `open` or `doing`, naming
   them (one document usually spawns several tickets; filing away the fifth
   must not bury the other four) — `--force` overrides
2. `git mv`s the file so its history follows it
3. **rewrites the `docs:` pointer in every ticket that referenced it** — a move
   that leaves dangling references turns the index into a liability
4. reports other documents that still mention the old path, and does not touch
   them; auto-editing prose mangles code blocks that happen to contain a path

---

## 2. JSON

Emitted by `ticket ls --json`, `ticket show <id> --json`, and the HTTP adapter.
Identical shape in all three.

```jsonc
{
  "schemaVersion": 1,
  "tickets": [
    {
      "id": "T-0012",
      "title": "Add quota tests before the next billing change",
      "status": "open",              // open | doing | closed
      "priority": "p1",
      "tags": ["billing", "tests"],
      "docs": ["docs/00-todo/engineering-roadmap-2026-06.md"],
      "refs": [],
      "created": "2026-08-01T06:30:13Z",
      "closed": null,
      "body": "## How\n...",
      "file": ".tickets/open/T-0012-add-quota-tests.md"
    }
  ],
  "docs": [                          // every linked doc, status DERIVED
    { "doc": "docs/plans/x.md", "status": "doing",
      "total": 3, "open": 1, "doing": 1, "closed": 1 }
  ],
  "orphanDocs": ["docs/done.md"],    // subset whose tickets are ALL closed
  "config": { "docsRoot": "docs", "archiveRoot": "docs/archive" }
}
```

Guarantees:

- Every field above is always present. Absent values are `null` or `[]`, never
  missing keys — clients never need `?.`
- `file` is repo-relative and points at a file that exists at read time
- Sorted by priority, then id
- New fields may be added within `schemaVersion: 1`. Fields will not be removed
  or change type without a version bump

`docs` and `orphanDocs` are **suggestions, never actions**. Nothing is archived
or deleted as a side effect of closing a ticket — one document usually spawns
several tickets, and closing one of them must not bury the other four.
Archiving is always an explicit `ticket archive` / `action: "archive"` call.

---

## 3. Writing a client

Three ways in, from least to most coupled. Pick one; they can coexist.

### a. Shell out to the CLI — any language, any platform

```bash
ticket ls --json                      # everything open + doing
ticket ls --status all --json
ticket ls --doc docs/seo/plan.md --json
ticket show 12 --json
ticket new "title" --docs a.md --tags seo --priority p1 --body -   # body from stdin
ticket start 12 / ticket close 12 / ticket reopen 12
ticket rm 12 --yes                    # delete outright
ticket docs --json                    # every linked doc + derived status
ticket doc new "title" [--dir path]   # write a doc under docsRoot + link it
ticket archive docs/plans/x.md        # the only move; refuses if work is open
ticket config --docs-root docs/14-tickets
```

This is what an editor plugin, a TUI, a CI job or an AI agent should use.
No install of anything but the CLI, no API surface to keep up with.

### b. Import the core module — Node clients

```js
import { list, create, setStatus, requireRoot } from 'unticked';

const root = requireRoot(process.cwd());   // walks up for .tickets/
const open = list(root, { status: 'open', tag: 'seo' });
```

Same functions the CLI calls. No subprocess.

### c. Built-in board — `ticket ui`

For humans who just want to look: `ticket ui` starts a localhost server that
serves a static board and the same JSON API. Default bind is `127.0.0.1:3847`.
The board auto-refreshes while the tab is visible. Optional flags:
`--port`, `--host`, `--root`, `--read-only`, `--poll <ms>`, `--no-open`.

This is optional chrome around the file store. The CLI and adapters keep working
if you never run it.

### d. HTTP adapter — embed in your own app

A browser cannot read `.tickets/`, so a web client needs one server-side file.
This is the only unavoidable coupling, and it is about twenty lines:

```ts
// app/api/tickets/route.ts
import { createTicketRoute } from 'unticked/adapters/next';
export const { GET, POST } = createTicketRoute({ cwd: process.env.REPO_PATH });
```

Built on standard `Request`/`Response`, so the same call works in Next.js App
Router, Hono, `Bun.serve`, `Deno.serve` — anything Fetch-shaped running on a
machine that has the repo on disk.

```
GET  ?status=all&tag=x&doc=y&q=z    → { schemaVersion, tickets, docs }
GET  ?id=T-0012                     → { schemaVersion, ticket }
POST { action: "create",  title, body?, docs?, tags?, priority? }
POST { action: "status",  id, status }
POST { action: "note",    id, text }
POST { action: "remove",  id }                 // delete; closing is not this
POST { action: "archive", doc, force? }        // move doc + repoint tickets
```

Pass `{ readOnly: true }` if the host app is reachable by anyone you would not
hand a shell to — the adapter runs with whatever filesystem permissions your
server has.

Then render it however you like. `examples/nextjs-tab/TicketBoard.tsx` is a
working board in one file; copy it and restyle, or ignore it entirely.

---

## 4. Closing the loop

The reason markdown checklists rot is not that they are markdown. It is that
nothing makes you go back and tick the box.

```bash
ticket hook install
```

Installs a `post-commit` hook. Then:

```bash
git commit -m "add quota tests (Closes T-12)"
```

closes `T-k7m2qx` — moves the file to `.tickets/closed/`, stamps `closed:`. You
never have to remember, because the trigger is attached to something you were
going to do anyway.

Matches `closes|fixes|resolves` followed by `T-<id>`, case-insensitive, any
number of them per commit. The `T-` is required, so ordinary prose ("closes the
last gap") never triggers it. The hook never fails your commit.
