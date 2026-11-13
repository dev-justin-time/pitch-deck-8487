import type { RouterClient } from "@orpc/server";
import { createApp } from "./__core/app";
import { auth } from "./auth";
import { audit } from "./routes/audit";
import { clout, governance } from "./routes/clout";
import { draw } from "./routes/draw";
import { exchange } from "./routes/exchange";
import { house } from "./routes/house";
import { identity } from "./routes/identity";
import { ipdesk } from "./routes/ipdesk";
import { members } from "./routes/members";
import { network } from "./routes/network";
import { escrow, payouts } from "./routes/payouts";
import { ping } from "./routes/ping";
import { projects } from "./routes/projects";
import { seed } from "./routes/seed";

// API features are oRPC procedures, one file per feature in ./routes/,
// composed into this router — typed end-to-end via the clients
// (web: src/web/lib/api.ts, mobile: lib/api.ts).
// Keep each routes/ file under 500 lines (`bun run lint` enforces this);
// split into more feature files as they grow.
// Patterns and examples: skills/app/references/api.md
export const router = {
  ping,
  members,
  identity,
  audit,
  projects,
  draw,
  exchange,
  ipdesk,
  house,
  clout,
  governance,
  network,
  seed,
  payouts,
  escrow,
};

export type AppRouter = typeof router;
/** Typed client for the router — used by the web and mobile api clients. */
export type AppRouterClient = RouterClient<AppRouter>;

const app = createApp(router);
// Rare plain-HTTP endpoints (webhooks, streaming, the Better Auth handler)
// register here with full paths, e.g. app.post("/api/webhooks/example", ...)
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

export default app;
