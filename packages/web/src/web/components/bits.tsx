import { Loader2 } from "lucide-react";
import { Link } from "wouter";
import { cn } from "../lib/utils";
import { errMsg } from "../lib/format";
import { useSession } from "./session";

export function Btn({
  children,
  variant = "primary",
  loading,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" | "outline"; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-[var(--radius)] px-4 py-2.5 text-sm font-semibold transition-all disabled:opacity-50 disabled:pointer-events-none active:translate-y-px",
        variant === "primary" && "bg-primary text-primary-foreground hover:brightness-110",
        variant === "outline" && "border border-border hover:border-primary hover:text-primary",
        variant === "ghost" && "hover:bg-muted",
        variant === "danger" && "bg-destructive text-white hover:brightness-110",
        className,
      )}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("k-card p-5", className)}>{children}</div>;
}

export function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="k-card p-4">
      <div className="k-label">{label}</div>
      <div className="k-display k-num mt-2 text-3xl">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" /> {label}…
    </div>
  );
}

export function ErrorLine({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="mt-2 text-sm text-destructive">{errMsg(error)}</p>;
}

export function PageHead({ kicker, title, children }: { kicker: string; title: string; children?: React.ReactNode }) {
  return (
    <header className="mb-8">
      <div className="k-label">{kicker}</div>
      <h1 className="k-display mt-2 text-5xl md:text-6xl">{title}</h1>
      {children && <div className="mt-3 max-w-2xl text-muted-foreground">{children}</div>}
    </header>
  );
}

export function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="k-label">{label}</span>
      <div className="mt-1.5">{children}</div>
      {help && <span className="mt-1 block text-xs text-muted-foreground">{help}</span>}
    </label>
  );
}

export function Bar({ value }: { value: number }) {
  return (
    <div className="k-bar">
      <span style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} />
    </div>
  );
}

/** Pages that need a passport render this when nobody is signed in. */
export function NeedPassport({ children }: { children: React.ReactNode }) {
  const { member, user, loading } = useSession();
  if (loading) return <Loading />;
  if (!member)
    return (
      <Card className="mx-auto max-w-lg text-center">
        <div className="k-display text-3xl">{user ? "Finish your passport" : "Sign in required"}</div>
        <p className="mt-2 text-sm text-muted-foreground">
          {user
            ? "You're signed in. Pick a handle and home club to get your passport — it takes thirty seconds."
            : "Browsing is open to everyone. Backing, pitching, trading and voting need an account and a passport."}
        </p>
        <Link to="/join" className="mt-4 inline-block rounded-[var(--radius)] bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground">
          {user ? "Finish passport" : "Sign in or create an account"}
        </Link>
      </Card>
    );
  return <>{children}</>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-[var(--radius)] border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{children}</div>;
}

/** Admin-only screens. The server enforces the same rule; this only avoids a useless round-trip. */
export function NeedAdmin({ children }: { children: React.ReactNode }) {
  const { isAdmin, loading } = useSession();
  if (loading) return <Loading />;
  if (!isAdmin)
    return (
      <Card className="mx-auto max-w-lg text-center">
        <div className="k-display text-3xl">House desk only</div>
        <p className="mt-2 text-sm text-muted-foreground">This area is for the network's administrators. Admin rights are granted from the server, never from the browser.</p>
      </Card>
    );
  return <>{children}</>;
}

/** Fresh key per submit so a double-click or retry replays the first result instead of charging twice. */
export const newKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`;

/** Confirmation line shown after a mutation succeeds. */
export function OkLine({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return <p className="mt-2 text-sm text-primary">{children}</p>;
}

/** Small status pill used across queues and histories. */
export function Pill({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "good" | "warn" | "bad" }) {
  return (
    <span
      className={cn(
        "inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        tone === "muted" && "border-border text-muted-foreground",
        tone === "good" && "border-primary/50 text-primary",
        tone === "warn" && "border-amber-400/50 text-amber-400",
        tone === "bad" && "border-destructive/60 text-destructive",
      )}
    >
      {children}
    </span>
  );
}
