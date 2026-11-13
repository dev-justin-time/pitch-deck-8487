import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useMe, useSetWorld } from "../queries/members";
import { authClient, clearToken } from "../lib/auth";
import { log } from "../lib/log";

export type World = "underground" | "lab" | "prestige";
const KEY_WORLD = "kinship.world";

type Me = NonNullable<ReturnType<typeof useMe>["data"]>;

type Ctx = {
  /** Signed-in account (Better Auth), or null. */
  user: Me["user"];
  /** The account's passport, or null when signed out or not yet onboarded. */
  member: Me["member"];
  /** Convenience: the passport id, derived from the session — never chosen by the client. */
  memberId: number | null;
  isAdmin: boolean;
  world: World;
  setWorld: (w: World) => void;
  loading: boolean;
  signOut: () => Promise<void>;
};
const SessionCtx = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const auth = authClient.useSession();
  const me = useMe();
  const saveWorld = useSetWorld();
  const [world, setW] = useState<World>(() => (localStorage.getItem(KEY_WORLD) as World) || "underground");
  const lastUser = useRef<string | null | undefined>(undefined);

  const authUserId = auth.data?.user.id ?? null;
  // Whenever the account changes (sign-in, sign-out, switch), drop every cached read so one
  // person's wallet or notices can never render for another.
  useEffect(() => {
    if (auth.isPending) return;
    if (lastUser.current !== undefined && lastUser.current !== authUserId) {
      log.decide("session", "Account changed; caches reset", { signedIn: !!authUserId });
      void qc.resetQueries();
    }
    lastUser.current = authUserId;
  }, [authUserId, auth.isPending, qc]);

  const member = me.data?.member ?? null;
  const user = me.data?.user ?? null;

  // A passport carries a saved world; adopt it once per sign-in.
  const adopted = useRef<number | null>(null);
  useEffect(() => {
    if (member && adopted.current !== member.id) {
      adopted.current = member.id;
      if (member.world && member.world !== world) setW(member.world as World);
    }
    if (!member) adopted.current = null;
  }, [member, world]);

  useEffect(() => {
    document.documentElement.dataset.world = world;
    localStorage.setItem(KEY_WORLD, world);
  }, [world]);

  function setWorld(w: World) {
    log.decide("theme", "Visual world selected", { world: w, saved: !!member });
    setW(w);
    if (member) saveWorld.mutate({ world: w });
  }

  async function signOut() {
    log.decide("session", "Sign-out requested");
    try {
      await authClient.signOut();
    } catch (error) {
      log.warn("session", "Server sign-out failed; clearing local session anyway", error instanceof Error ? error.message : undefined);
    }
    clearToken();
    await auth.refetch?.();
    await qc.resetQueries();
  }

  return (
    <SessionCtx.Provider
      value={{
        user,
        member,
        memberId: member?.id ?? null,
        isAdmin: member?.role === "admin",
        world,
        setWorld,
        loading: auth.isPending || me.isLoading,
        signOut,
      }}
    >
      {children}
    </SessionCtx.Provider>
  );
}

export function useSession() {
  const c = useContext(SessionCtx);
  if (!c) throw new Error("SessionProvider missing");
  return c;
}
