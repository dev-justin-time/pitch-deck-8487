import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Menu, X } from "lucide-react";
import { cn } from "../lib/utils";
import { money, num } from "../lib/format";
import { useSession, type World } from "./session";

const NAV = [
  { to: "/forge", label: "The Draw" },
  { to: "/projects", label: "Rounds" },
  { to: "/portfolio", label: "Portfolio" },
  { to: "/studio", label: "Studio" },
  { to: "/exchange", label: "Exchange" },
  { to: "/ipdesk", label: "IP Desk" },
  { to: "/hub", label: "Hub" },
];

const WORLDS: { key: World; label: string }[] = [
  { key: "underground", label: "Underground" },
  { key: "lab", label: "Lab" },
  { key: "prestige", label: "Prestige" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [loc] = useLocation();
  const { member, user, world, setWorld, signOut } = useSession();
  const [open, setOpen] = useState(false);
  const nav = member?.role === "admin" ? [...NAV, { to: "/house", label: "House" }] : NAV;

  return (
    <div className="min-h-screen">
      <div className="border-b border-border bg-muted/60 px-4 py-1.5 text-center font-mono text-[11px] tracking-wide text-muted-foreground">
        SIMULATION BUILD — no real money moves, no security is offered or sold. <Link to="/compliance" className="k-link">The path to real</Link>
      </div>
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
          <Link to="/" className="k-display shrink-0 text-2xl">
            Kinship<span className="text-primary">.</span>
          </Link>
          <nav className="hidden flex-1 items-center gap-1 lg:flex">
            {nav.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className={cn(
                  "rounded-[var(--radius)] px-3 py-1.5 text-sm transition-colors hover:text-primary",
                  loc.startsWith(n.to) ? "text-primary" : "text-muted-foreground",
                )}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <select
              aria-label="Visual world"
              value={world}
              onChange={(e) => setWorld(e.target.value as World)}
              className="k-input w-auto py-1.5 text-xs"
            >
              {WORLDS.map((w) => (
                <option key={w.key} value={w.key}>
                  {w.label}
                </option>
              ))}
            </select>
            {member ? (
              <>
                <Link to="/portfolio" className="hidden items-center gap-2 rounded-[var(--radius)] border border-border px-3 py-1.5 text-xs sm:flex">
                  <span className="font-semibold">@{member.handle}</span>
                  <span className="k-num text-primary">{money(member.walletCents)}</span>
                  <span className="k-num text-muted-foreground">{num(member.points)} pts</span>
                </Link>
                <button onClick={() => void signOut()} className="hidden rounded-[var(--radius)] border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground md:block">
                  Sign out
                </button>
              </>
            ) : user ? (
              <Link to="/join" className="rounded-[var(--radius)] bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">
                Finish passport
              </Link>
            ) : (
              <Link to="/join" className="rounded-[var(--radius)] bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">
                Sign in / join
              </Link>
            )}
            <button className="lg:hidden" onClick={() => setOpen(!open)} aria-label="Menu">
              {open ? <X /> : <Menu />}
            </button>
          </div>
        </div>
        {open && (
          <nav className="grid gap-1 border-t border-border px-4 py-3 lg:hidden">
            {nav.map((n) => (
              <Link key={n.to} to={n.to} className="py-1.5 text-sm" onClick={() => setOpen(false)}>
                {n.label}
              </Link>
            ))}
            {user && (
              <button className="py-1.5 text-left text-sm text-muted-foreground" onClick={() => { setOpen(false); void signOut(); }}>
                Sign out
              </button>
            )}
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-7xl px-4 py-10">{children}</main>
      <footer className="border-t border-border">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-10 text-sm text-muted-foreground md:grid-cols-4">
          <div>
            <div className="k-display text-xl text-foreground">Kinship Collective</div>
            <p className="mt-2 text-xs">Four clubs, separately run, one Reserve. Friends helping friends, with the math shown.</p>
          </div>
          <div className="grid gap-1">
            <span className="k-label">Clubs</span>
            <Link to="/hub">Kinship Hub</Link>
            <Link to="/forge">Forge Club</Link>
            <Link to="/orbital">Orbital Works</Link>
            <Link to="/sole">Sole Society</Link>
          </div>
          <div className="grid gap-1">
            <span className="k-label">Your file</span>
            <Link to="/scores">Scores</Link>
            <Link to="/studio">Studio</Link>
            <Link to="/forge/pitch">Pitch something</Link>
          </div>
          <div className="grid gap-1">
            <span className="k-label">Straight talk</span>
            <Link to="/compliance">Compliance roadmap</Link>
            {user && (
              <button className="text-left" onClick={() => void signOut()}>
                Sign out {member ? `@${member.handle}` : user.email}
              </button>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
