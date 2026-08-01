/**
 * Drop this at `app/api/tickets/route.ts`. It is the entire server side of a
 * web client.
 *
 * `cwd` is where unticked starts looking for `.tickets/`, walking up from
 * there. Set it when the repo you are tracking is not the app's own directory
 * — e.g. a dashboard running in a container with the repo bind-mounted.
 */
import { createTicketRoute } from 'unticked/adapters/next';

export const { GET, POST } = createTicketRoute({
  cwd: process.env.TICKETS_ROOT || process.cwd(),
  // readOnly: true,   // if this app is reachable by anyone you wouldn't give a shell
});

export const dynamic = 'force-dynamic';
