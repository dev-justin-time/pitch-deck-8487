import { createAuthClient } from "better-auth/react";
import { managedAuthClient } from "@runablehq/managed-auth/client";
import { log } from "./log";

/** Same key the managed-auth plugin reads, so email/password and Google share one bearer store. */
const TOKEN_KEY = "runable.managed-auth.token";

export const authClient = createAuthClient({
  baseURL: window.location.origin,
  basePath: "/api/auth",
  plugins: [
    managedAuthClient({
      applicationId: import.meta.env.VITE_APPLICATION_ID,
      issuer: import.meta.env.VITE_RUNABLE_AUTH_ISSUER,
    }),
  ],
});

/**
 * Email sign-in/sign-up return the session bearer in the `set-auth-token` header. The managed
 * plugin only stores tokens from its own exchange, so capture this one into the same slot.
 * The token itself is never logged.
 */
export function captureToken(ctx: { response: Response }) {
  const token = ctx.response.headers.get("set-auth-token");
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
    log.decide("auth", "Session bearer stored");
  } else {
    log.warn("auth", "Sign-in succeeded without a bearer header");
  }
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}
