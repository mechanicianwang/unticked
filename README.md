# unticked

**Tickets as markdown files in your repo.** A CLI you run, a JSON contract
anyone can build a client on, and a git hook that closes tickets for you.

Zero dependencies. MIT.

```bash
npx unticked init
npx unticked new "Add quota tests before the next billing change" --priority p1 --docs docs/billing.md
npx unticked ls
```

```
[ ] T-k7m2qx p1 Add quota tests before the next billing change → docs/billing.md
```

---

## Who this is for

Teams that keep a list of things that need doing, and keep forgetting them.

You probably recognise the shape of it. Somebody writes a good plan document
with a checklist at the bottom. The work gets done over the following weeks.
Nobody ever goes back to tick the boxes. Six months later you open the file and
find forty unchecked items, and you cannot tell which ones are still real
without re-reading the whole codebase.

That is the situation this was built for. The shape looks like this in practice
(numbers from a real audit; file names genericised):

| unchecked | checked | file |
|---:|---:|---|
| 285 | **0** | `docs/qa-checklist.md` |
| 72 | **0** | `docs/integrations/third-party-todo.md` |
| 37 | **0** | `docs/plans/feature-rewrite.md` — *the work had actually shipped* |

Zero ticked, every time. The checklists were not wrong, they were **unusable**:
you cannot tell "not done" from "done, never ticked".

unticked fixes the specific thing that causes this — not by giving you a nicer
place to write the list, but by attaching the closing action to something you
already do. You commit code. That closes the ticket.

**It is a good fit if:**

- your work lives in a git repo and you would like the backlog to live there too
- you want to `grep` your todos, diff them, and review them in a PR
- your AI coding agent should be able to see what is left without an API key
- you already have an internal dashboard and want tickets *inside it*, not on
  another tab of another tool

**It is a bad fit if:** you need multi-team permissions, sprint reporting,
non-technical users filing tickets, or anything resembling Jira. Use Jira.

---

## Quickstart

```bash
npm install -g unticked          # or: npx unticked <command>

cd your-repo
ticket init                       # creates .tickets/
ticket new "Fix the login redirect" --priority p0 --tags auth
ticket ls
ticket start k7m                  # → doing   (any unique id prefix works)
ticket close k7m                  # → closed, file moves to .tickets/closed/

ticket hook install               # the part that matters ↓
git commit -m "fix redirect (Closes T-k7m2qx)"   # closes it automatically
```

Commit `.tickets/` along with your code. That is the whole system.

### Linking tickets to the documents they came from

```bash
ticket new "Write the migration" --docs docs/plans/db-migration.md
ticket ls --doc docs/plans/db-migration.md    # everything still open for that doc
ticket docs                                   # docs whose tickets are ALL closed
```

`ticket docs` tells you a document has nothing left outstanding — it will not
archive or delete anything for you. One document usually spawns several
tickets, and closing one must not bury the other four.

---

## Build your own client

This is the part unticked exists for. Other local trackers ship one UI and
that is the UI you get. Here the engine has no UI at all, and the contract is
public and small, so the board can live wherever you already look.

```bash
ticket ls --json    # stable, versioned JSON — every field always present
```

Three ways in:

| you are writing | use | cost |
|---|---|---|
| TUI, editor plugin, CI job, AI agent | shell out to `ticket ... --json` | nothing |
| a Node tool | `import { list, create } from 'unticked'` | nothing |
| a web UI | `createTicketRoute()` from `unticked/adapters/next` | ~20 lines |

```ts
// app/api/tickets/route.ts — the entire server side of a web client
import { createTicketRoute } from 'unticked/adapters/next';
export const { GET, POST } = createTicketRoute({ cwd: process.env.REPO_PATH });
```

It is built on standard `Request`/`Response`, so the same call works in Next.js,
Hono, `Bun.serve` and `Deno.serve`. A browser cannot read `.tickets/` itself —
that server-side file is the one piece of coupling that cannot be removed, and
it has been made as small as it can be.

`examples/nextjs-tab/TicketBoard.tsx` is a complete board in one file: three
columns, search, create, open/close. Copy it, restyle it, or throw it away and
render the JSON your own way.

**Full protocol: [SPEC.md](SPEC.md)** — file layout, frontmatter fields, JSON
guarantees, and what is allowed to change between versions.

---

## Design decisions worth knowing

**The directory is the status.** `.tickets/open/`, `.tickets/doing/`,
`.tickets/closed/`. There is no `status:` field, so there is nothing to drift
out of sync, and `ls .tickets/open` answers "what is left" with no tooling —
which matters when the reader is a shell script or an agent.

**Ids are random, not sequential** — `T-k7m2qx`. Branches never have to
coordinate: two people can each create ten tickets on separate branches, merge,
and nothing collides. Type any unique prefix, like a short git sha:
`ticket close k7m`.

**The CLI is the only writer.** Clients may read the files directly (fast, no
install), but writes go through the CLI or the core module so that id
allocation and frontmatter stay valid. A broken client cannot corrupt the data.

**Suggest, never act.** unticked will not archive your documents, close
tickets it thinks are stale, or garbage-collect anything. Irreversible actions
are yours.

**Zero dependencies, on purpose.** Frontmatter is a
[documented restricted subset](SPEC.md#frontmatter) of YAML rather than a real
parser. If you hand-edit a ticket into block-style YAML it will not round-trip.

---

## Alternatives

Genuinely good tools that solve an overlapping problem. Use one of these if it
fits better — the point of this section is that it often will.

- **[Backlog.md](https://github.com/MrLesk/Backlog.md)** — the most complete of
  these by a distance: kanban, milestones, dependencies, acceptance criteria, a
  polished web UI. Its UI is its own app on its own port; it is not designed to
  be embedded in yours. If you do not need embedding, start here.
- **[tk (wedow/ticket)](https://github.com/wedow/ticket)** — one bash script,
  `.tickets/` markdown, dependency graphs, a plugin system. Excellent CLI. Its
  JSON output (a `jq`-based plugin) omits titles and bodies, so it is not a
  base for UI clients — which is what led to this project.
- **[git-bug](https://github.com/git-bug/git-bug)** — the mature one. Stores
  issues as git objects rather than files, so your working tree stays clean and
  code merges never conflict with issues. The trade-off is that you cannot
  `grep` them.
- **[markdown-ticket](https://github.com/andkirby/markdown-ticket)** — board
  first, multi-project, MCP support, document links.
- **[tissue](https://github.com/smeans/tissue)** — markdown issues with an
  `archive/` folder and a light web view.

A note on the shared caveat you will see raised about this whole category —
that storing tickets as files in the working tree produces merge conflicts.
It is worth being precise. Creating tickets on parallel branches does not
conflict here: one file per ticket, random ids, so both sides merge cleanly.
What can still conflict is two branches editing *the same* ticket, which is
ordinary file-level conflict and resolves the ordinary way. `git-bug`'s
ref-based storage sidesteps even that, at the cost of not being greppable.

---

## License

MIT
