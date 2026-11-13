import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useOnboard } from "../queries/members";
import { useSession, type World } from "../components/session";
import { Btn, Card, ErrorLine, Field, Loading, PageHead } from "../components/bits";
import { authClient, captureToken } from "../lib/auth";
import { log } from "../lib/log";
import { money } from "../lib/format";
import { cn } from "../lib/utils";

/**
 * /join — one page, three states:
 * 1. signed out  → sign-in / create-account tabs (email + password, or Google)
 * 2. signed in, no passport → passport onboarding
 * 3. has passport → straight to /forge
 */
export default function JoinPage() {
  const [, go] = useLocation();
  const { user, member, loading } = useSession();

  useEffect(() => {
    if (member) {
      log.decide("join", "Passport present; routing to the Draw");
      go(member.role === "admin" ? "/house" : "/forge");
    }
  }, [member, go]);

  if (loading) return <Loading />;
  if (member) return <Loading label="Opening your passport" />;
  return user ? <Onboard email={user.email} /> : <AuthPanel />;
}

function AuthPanel() {
  const { refetchSession } = useRefetch();
  const [tab, setTab] = useState<"signin" | "signup">("signin");
  const [f, setF] = useState({ name: "", email: "", password: "" });
  const [busy, setBusy] = useState<"email" | "google" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy("email");
    log.decide("auth", tab === "signin" ? "Email sign-in requested" : "Account creation requested");
    const res =
      tab === "signin"
        ? await authClient.signIn.email({ email: f.email.trim(), password: f.password }, { onSuccess: captureToken })
        : await authClient.signUp.email({ name: f.name.trim() || f.email.split("@")[0], email: f.email.trim(), password: f.password }, { onSuccess: captureToken });
    setBusy(null);
    if (res.error) {
      log.warn("auth", "Rejected", { status: res.error.status });
      setError(friendly(res.error.message, res.error.status));
      return;
    }
    setF((x) => ({ ...x, password: "" }));
    await refetchSession();
  }

  async function google() {
    setError(null);
    setBusy("google");
    log.decide("auth", "Google sign-in requested");
    const res = await authClient.managedAuth.signIn({ provider: "google" });
    setBusy(null);
    if (res?.error && res.error.code !== "POPUP_CLOSED") {
      log.warn("auth", "Google sign-in failed", { code: res.error.code });
      setError(res.error.message ?? "Google sign-in failed");
      return;
    }
    await refetchSession();
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[1.1fr_1fr]">
      <div>
        <PageHead kicker="Kinship Hub · Account" title={tab === "signin" ? "Welcome back" : "Create an account"}>
          Browsing is open. Backing, pitching, trading and voting need an account, then a passport — one identity across all four clubs.
        </PageHead>
        <Card>
          <div className="mb-5 grid grid-cols-2 gap-1 rounded-[var(--radius)] border border-border p-1" role="tablist">
            {(["signin", "signup"] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => { setTab(t); setError(null); }}
                className={cn("rounded-[var(--radius)] py-2 text-sm font-semibold", tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
              >
                {t === "signin" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>
          <form onSubmit={submit} className="grid gap-4">
            {tab === "signup" && (
              <Field label="Name">
                <input className="k-input" aria-label="Name" autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
              </Field>
            )}
            <Field label="Email">
              <input className="k-input" type="email" required aria-label="Email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
            </Field>
            <Field label="Password" help={tab === "signup" ? "10 characters or more" : undefined}>
              <input
                className="k-input"
                type="password"
                required
                minLength={tab === "signup" ? 10 : 1}
                maxLength={128}
                aria-label="Password"
                autoComplete={tab === "signin" ? "current-password" : "new-password"}
                value={f.password}
                onChange={(e) => setF({ ...f, password: e.target.value })}
              />
            </Field>
            <Btn type="submit" loading={busy === "email"} disabled={!!busy}>
              {tab === "signin" ? "Sign in" : "Create account"}
            </Btn>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </form>
          <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
          </div>
          <Btn variant="outline" className="w-full" loading={busy === "google"} disabled={!!busy} onClick={() => void google()}>
            Continue with Google
          </Btn>
        </Card>
      </div>
      <div className="grid content-start gap-4">
        <div className="k-label">What an account gets you</div>
        <Card>
          <ul className="grid gap-3 text-sm">
            <li><span className="font-semibold">{money(25000)} of simulated club credit.</span> No card, no real money — every balance is a ledger entry.</li>
            <li><span className="font-semibold">Three draws a week</span> at Level 0, with a $10 ceiling per project.</li>
            <li><span className="font-semibold">A private score file</span> only you (and accredited reviewers, with a logged notice to you) can read.</li>
            <li><span className="font-semibold">One vote per proposal</span>, weighted by clout with quadratic dampening.</li>
          </ul>
        </Card>
        <p className="text-xs text-muted-foreground">
          There is no email sender on this build, so there is no verification mail or password-reset link yet. Demo members in the network are display data and cannot be signed into.
        </p>
      </div>
    </div>
  );
}

function Onboard({ email }: { email: string }) {
  const { world, setWorld, signOut } = useSession();
  const onboard = useOnboard();
  const [f, setF] = useState({
    displayName: "",
    handle: "",
    track: "both" as "backer" | "creator" | "both",
    homeBrand: "forge" as "forge" | "orbital" | "sole" | "hub",
    bio: "",
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    log.decide("join", "Passport requested", { homeBrand: f.homeBrand, track: f.track });
    onboard.mutate({ ...f, world, bio: f.bio || undefined });
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHead kicker="Kinship Hub · Passport" title="Get a passport">
        Signed in as <span className="font-semibold">{email}</span>. One identity across all four clubs, starting at Level 0 with {money(25000)} of simulated club credit.
      </PageHead>
      <Card>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Display name">
              <input className="k-input" required minLength={2} maxLength={60} aria-label="Display name" value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} />
            </Field>
            <Field label="Handle" help="3–24 · lowercase, numbers, underscores">
              <input
                className="k-input"
                required
                minLength={3}
                maxLength={24}
                aria-label="Handle"
                value={f.handle}
                onChange={(e) => setF({ ...f, handle: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })}
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Track">
              <select className="k-input" value={f.track} onChange={(e) => setF({ ...f, track: e.target.value as typeof f.track })}>
                <option value="both">Back and pitch</option>
                <option value="backer">Back only</option>
                <option value="creator">Pitch only</option>
              </select>
            </Field>
            <Field label="Home club">
              <select className="k-input" value={f.homeBrand} onChange={(e) => setF({ ...f, homeBrand: e.target.value as typeof f.homeBrand })}>
                <option value="forge">Forge Club</option>
                <option value="orbital">Orbital Works</option>
                <option value="sole">Sole Society</option>
                <option value="hub">Kinship Hub</option>
              </select>
            </Field>
            <Field label="World">
              <select className="k-input" value={world} onChange={(e) => setWorld(e.target.value as World)}>
                <option value="underground">Underground</option>
                <option value="lab">Lab</option>
                <option value="prestige">Prestige</option>
              </select>
            </Field>
          </div>
          <Field label="Bio (optional)">
            <textarea className="k-input" rows={2} maxLength={280} aria-label="Bio" value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })} />
          </Field>
          <p className="text-xs text-muted-foreground">
            Identity checks are simulated: you can request a review from your portfolio later, and only an administrator can approve it. Nothing here checks a real document.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Btn type="submit" loading={onboard.isPending}>Create passport</Btn>
            <Btn type="button" variant="ghost" onClick={() => void signOut()}>Use a different account</Btn>
          </div>
          <ErrorLine error={onboard.error} />
        </form>
      </Card>
    </div>
  );
}

/** After sign-in, refresh the Better Auth session and every cached read. */
function useRefetch() {
  const session = authClient.useSession();
  return {
    refetchSession: async () => {
      await session.refetch?.();
    },
  };
}

function friendly(message: string | undefined, status: number) {
  if (status === 429) return "Too many attempts. Wait a minute and try again.";
  if (status === 401 || /invalid/i.test(message ?? "")) return "That email and password don't match an account.";
  if (/exists|already/i.test(message ?? "")) return "An account with that email already exists — sign in instead.";
  if (/password/i.test(message ?? "") && /short|length|least/i.test(message ?? "")) return "Password must be at least 10 characters.";
  return message ?? "Something went wrong. Try again.";
}
