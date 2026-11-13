// Entry point referenced by index.html — completes a returning managed (Google) sign-in
// before the template bootstrap in __main.tsx renders routes.
import { authClient } from "./lib/auth";

try {
  await authClient.managedAuth.handleRedirect();
} catch (error) {
  console.warn("[kinship:auth] Managed redirect could not be completed", error instanceof Error ? error.message : error);
}
await import("./__main");
