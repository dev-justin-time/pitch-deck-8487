import { useMutation, useQuery } from "@tanstack/react-query";
import { orpc } from "../lib/api";
import { useRefreshAll } from "../hooks/refresh";

export function useHouseLedger(enabled: boolean) {
  return useQuery(orpc.house.ledger.queryOptions({ enabled }));
}
export function useWatchlist(enabled: boolean) {
  return useQuery(orpc.house.watchlist.queryOptions({ enabled }));
}
export function useHouseNotices(enabled: boolean) {
  return useQuery(orpc.house.notices.queryOptions({ enabled }));
}
export function useMyNotices(enabled: boolean) {
  return useQuery(orpc.house.myNotices.queryOptions({ enabled }));
}
export function useFeatures() {
  return useQuery(orpc.house.features.queryOptions());
}
export function useVoteFeature() {
  const refresh = useRefreshAll();
  return useMutation(orpc.house.voteFeature.mutationOptions({ onSuccess: refresh }));
}
export function useIssueGrace() {
  const refresh = useRefreshAll();
  return useMutation(orpc.house.issueGrace.mutationOptions({ onSuccess: refresh }));
}
export function useIssueDefault() {
  const refresh = useRefreshAll();
  return useMutation(orpc.house.issueDefaultNotice.mutationOptions({ onSuccess: refresh }));
}
export function useCureNotice() {
  const refresh = useRefreshAll();
  return useMutation(orpc.house.cureNotice.mutationOptions({ onSuccess: refresh }));
}
export function useForeclose() {
  const refresh = useRefreshAll();
  return useMutation(orpc.house.foreclose.mutationOptions({ onSuccess: refresh }));
}
export function useFundFeature() {
  const refresh = useRefreshAll();
  return useMutation(orpc.house.fundFeature.mutationOptions({ onSuccess: refresh }));
}
export function useDismissNotice() {
  const refresh = useRefreshAll();
  return useMutation(orpc.house.dismissNotice.mutationOptions({ onSuccess: refresh }));
}
