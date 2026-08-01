# ticketkit protocol

Everything a client needs to know. If you implement against this page, your
client keeps working across ticketkit versions.

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

`T-NNNN`, zero-padded to 4, allocated as `max + 1` across all three
directories. Clients must accept the loose forms `12`, `t-12`, `T-0012` from
users and normalize them.

> Two branches creating tickets in parallel can allocate the same id. That is
> an accepted limitation for a single repo or a small team — see the note in
> `core.js` for the upgrade path.

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

## 怎么做 / How
...

## 怎么算做完 / Done when
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
keeps ticketkit at zero dependencies. Hand-editing a ticket into real YAML
(block lists, anchors, multi-line strings) will not round-trip.

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
      "body": "## 怎么做 / How\n...",
      "file": ".tickets/open/T-0012-add-quota-tests.md"
    }
  ],
  "docs": ["docs/some-doc.md"]       // docs whose tickets are ALL closed
}
```

Guarantees:

- Every field above is always present. Absent values are `null` or `[]`, never
  missing keys — clients never need `?.`
- `file` is repo-relative and points at a file that exists at read time
- Sorted by priority, then id
- New fields may be added within `schemaVersion: 1`. Fields will not be removed
  or change type without a version bump

The `docs` array at the top level is a **suggestion, never an action**.
ticketkit will not archive or delete a document for you: one document usually
spawns several tickets, and closing one of them must not bury the other four.

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
```

This is what an editor plugin, a TUI, a CI job or an AI agent should use.
No install of anything but the CLI, no API surface to keep up with.

### b. Import the core module — Node clients

```js
import { list, create, setStatus, requireRoot } from 'ticketkit';

const root = requireRoot(process.cwd());   // walks up for .tickets/
const open = list(root, { status: 'open', tag: 'seo' });
```

Same functions the CLI calls. No subprocess.

### c. HTTP adapter — web clients

A browser cannot read `.tickets/`, so a web client needs one server-side file.
This is the only unavoidable coupling, and it is about twenty lines:

```ts
// app/api/tickets/route.ts
import { createTicketRoute } from 'ticketkit/adapters/next';
export const { GET, POST } = createTicketRoute({ cwd: process.env.REPO_PATH });
```

Built on standard `Request`/`Response`, so the same call works in Next.js App
Router, Hono, `Bun.serve`, `Deno.serve` — anything Fetch-shaped running on a
machine that has the repo on disk.

```
GET  ?status=all&tag=x&doc=y&q=z    → { schemaVersion, tickets, docs }
GET  ?id=T-0012                     → { schemaVersion, ticket }
POST { action: "create", title, body?, docs?, tags?, priority? }
POST { action: "status", id, status }
POST { action: "note",   id, text }
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

closes `T-12` — moves the file to `.tickets/closed/`, stamps `closed:`. You
never have to remember, because the trigger is attached to something you were
going to do anyway.

Matches `closes|fixes|resolves` + an id, case-insensitive, any number per
commit. The hook never fails your commit.
