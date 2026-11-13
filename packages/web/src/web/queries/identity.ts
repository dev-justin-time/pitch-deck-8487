import { useMutation, useQuery } from "@tanstack/react-query";
import { orpc } from "../lib/api";
import { useRefreshAll } from "../hooks/refresh";

export function useMyIdentity(enabled: boolean) {
  return useQuery(orpc.identity.mine.queryOptions({ enabled }));
}
export function useRequestIdentity() {
  const refresh = useRefreshAll();
  return useMutation(orpc.identity.request.mutationOptions({ onSuccess: refresh }));
}
export function useIdentityQueue(enabled: boolean) {
  return useQuery(orpc.identity.queue.queryOptions({ enabled }));
}
export function useReviewIdentity() {
  const refresh = useRefreshAll();
  return useMutation(orpc.identity.review.mutationOptions({ onSuccess: refresh }));
}
export function useGrantCredit() {
  const refresh = useRefreshAll();
  return useMutation(orpc.identity.grantCredit.mutationOptions({ onSuccess: refresh }));
}
