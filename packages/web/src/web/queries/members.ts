import { useMutation, useQuery } from "@tanstack/react-query";
import { orpc } from "../lib/api";
import { useRefreshAll } from "../hooks/refresh";

/** `enabled` flags gate member-only reads on the session so signed-out visitors never fire them. */

export function useMe() {
  return useQuery(orpc.members.me.queryOptions({ retry: 1, staleTime: 30_000 }));
}
export function usePublicMember(memberId: number | null) {
  return useQuery(orpc.members.get.queryOptions({ input: { memberId: memberId ?? 0 }, enabled: !!memberId, retry: false }));
}
export function useMembersList() {
  return useQuery(orpc.members.list.queryOptions());
}
export function useDashboard(enabled: boolean) {
  return useQuery(orpc.members.dashboard.queryOptions({ enabled }));
}
export function useScores(enabled: boolean, targetHandle?: string) {
  return useQuery(orpc.members.scores.queryOptions({ input: { targetHandle }, enabled, retry: false }));
}
export function useWalletHistory(enabled: boolean) {
  return useQuery(orpc.members.walletHistory.queryOptions({ enabled }));
}
export function useLeaderboard() {
  return useQuery(orpc.members.leaderboard.queryOptions());
}
export function useOnboard() {
  const refresh = useRefreshAll();
  return useMutation(orpc.members.onboard.mutationOptions({ onSuccess: refresh }));
}
export function useSetWorld() {
  return useMutation(orpc.members.setWorld.mutationOptions());
}
export function useLevelUp() {
  const refresh = useRefreshAll();
  return useMutation(orpc.members.levelUp.mutationOptions({ onSuccess: refresh }));
}
export function useUnlockOngoing() {
  const refresh = useRefreshAll();
  return useMutation(orpc.members.unlockOngoing.mutationOptions({ onSuccess: refresh }));
}
